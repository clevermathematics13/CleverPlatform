import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";
import { canCopySourceWhole } from "@/lib/batch-split";

// Hobby-plan serverless functions cap at 300s. Grading a full class
// sequentially in one request (as an earlier version of this route did)
// can exceed that for anything beyond a handful of students, so this route
// does the FAST part only — split the batch PDF and create one queued
// ai_grade_runs row per student — and returns immediately. Actual grading
// happens as separate calls to the existing single-student
// POST /api/tests/[id]/ai-grade route (reuseExistingScan: true), one per
// student, made by the client after this route returns. That keeps every
// grading call inside its own 300s budget regardless of class size.
//
// Even so, this route timed out at its earlier 120s limit 25 times between
// 17 Aug and 5 Sep 2026 -- never because of pdf-lib (rebuilding a 12MB
// part takes ~100ms) but because "grade all parts" fired every part of a
// class-sized upload at once, and 26 concurrent invocations each pulling
// 12-18MB out of Storage and pushing it back in starved one another. Two
// changes address that: the client now runs parts through a small pool,
// and a part that is one student's whole booklet (the common case for a
// chunked upload) is copied inside Storage rather than rebuilt here. The
// budget is raised to the platform cap for the rebuild path that remains.
export const maxDuration = 300;

interface ConfirmedSegment {
  label: string;
  pages: number[];
  matchedStudentId: string | null;
}

/**
 * POST /api/tests/[id]/ai-grade/batch/[batchId]/split
 * Body: { segments: { label: string, pages: number[], studentId: string }[] }
 *
 * Applies the teacher's CONFIRMED page-to-student mapping (which may differ
 * from the model's proposal — every segment here needs an explicit studentId,
 * there is no roster auto-match fallback at this step) and splits the batch
 * PDF into one PDF per student via pdf-lib, uploading each to the same
 * exam-scans bucket single-student scans already use. Returns the storage
 * path per student; the caller then triggers grading for each one via the
 * existing single-student route. This route never calls the model and never
 * writes to ai_grade_runs or ai_grade_results itself.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId, batchId } = await params;

  let body: { segments?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json({ error: "segments must be a non-empty array" }, { status: 400 });
  }

  const segments: { label: string; pages: number[]; studentId: string }[] = [];
  for (const raw of body.segments as Record<string, unknown>[]) {
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const studentId = typeof raw.studentId === "string" ? raw.studentId.trim() : "";
    const pages = Array.isArray(raw.pages)
      ? raw.pages.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1)
      : [];
    if (!label || !studentId || pages.length === 0) {
      return NextResponse.json(
        { error: "Every segment needs a label, a studentId, and at least one page" },
        { status: 400 }
      );
    }
    segments.push({ label, pages: [...new Set(pages)].sort((a, b) => a - b), studentId });
  }

  const studentIds = segments.map((s) => s.studentId);
  const duplicateStudent = studentIds.find((id, i) => studentIds.indexOf(id) !== i);
  if (duplicateStudent) {
    return NextResponse.json(
      { error: "The same student is assigned to more than one segment — merge their pages into one segment" },
      { status: 400 }
    );
  }

  // -- Load the batch and the source PDF -------------------------------------
  const { data: batch, error: batchErr } = await supabase
    .from("ai_grade_batches")
    .select("id, test_id, status, source_storage_path, page_count, blank_pages")
    .eq("id", batchId)
    .maybeSingle();

  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (batch.test_id !== testId) {
    return NextResponse.json({ error: "This batch does not belong to the specified assessment" }, { status: 400 });
  }
  // A batch that is already "split" is NOT rejected: this route used to
  // 409 in that case, which meant a split whose response was lost to a
  // gateway timeout (the row had been updated, the client never heard)
  // could only be retried by re-uploading the scan. Splitting again just
  // writes fresh per-student PDFs; grading them again is an ordinary
  // re-mark, which the grading route already handles.

  const pageCount = batch.page_count ?? 0;
  const outOfRange = segments.flatMap((s) => s.pages.filter((p) => p > pageCount));
  if (outOfRange.length > 0) {
    return NextResponse.json(
      { error: `Page(s) ${[...new Set(outOfRange)].join(", ")} are beyond this batch's ${pageCount} pages` },
      { status: 400 }
    );
  }

  const blankPages = (batch.blank_pages as number[] | null) ?? [];

  // The source PDF is only downloaded and parsed if some segment actually
  // needs pages cut out of it. A segment that claims the whole source (bar
  // confirmed-blank pages) is served by a Storage-side copy instead -- see
  // canCopySourceWhole for why that is the common case and why it matters.
  let sourceDoc: PDFDocument | null = null;
  const loadSourceDoc = async (): Promise<PDFDocument> => {
    if (sourceDoc) return sourceDoc;
    const { data: sourceFile, error: dlErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .download(batch.source_storage_path);
    if (dlErr || !sourceFile) {
      throw new Error(`Could not read the batch scan: ${dlErr?.message ?? "not found"}`);
    }
    const sourceBuffer = Buffer.from(await sourceFile.arrayBuffer());
    try {
      sourceDoc = await PDFDocument.load(sourceBuffer, { updateMetadata: false });
    } catch (e) {
      throw new Error(`Could not open the batch PDF: ${e instanceof Error ? e.message : String(e)}`);
    }
    return sourceDoc;
  };

  const results: {
    studentId: string;
    label: string;
    status: "split" | "failed";
    storagePath?: string;
    error?: string;
  }[] = [];

  for (const segment of segments) {
    try {
      const splitPath = `${testId}/${segment.studentId}/${Date.now()}-batch-${batchId}.pdf`;

      if (canCopySourceWhole(segment.pages, pageCount, blankPages)) {
        const { error: copyErr } = await supabase.storage
          .from(SCAN_BUCKET)
          .copy(batch.source_storage_path, splitPath);
        if (copyErr) throw new Error(`Could not store split scan: ${copyErr.message}`);
        results.push({
          studentId: segment.studentId,
          label: segment.label,
          status: "split",
          storagePath: splitPath,
        });
        continue;
      }

      const source = await loadSourceDoc();
      const splitDoc = await PDFDocument.create();
      const copiedPages = await splitDoc.copyPages(
        source,
        segment.pages.map((p) => p - 1)
      );
      for (const page of copiedPages) splitDoc.addPage(page);
      const splitBytes = Buffer.from(await splitDoc.save());

      const { error: uploadErr } = await supabase.storage
        .from(SCAN_BUCKET)
        .upload(splitPath, splitBytes, { contentType: "application/pdf", upsert: true });
      if (uploadErr) throw new Error(`Could not store split scan: ${uploadErr.message}`);

      results.push({
        studentId: segment.studentId,
        label: segment.label,
        status: "split",
        storagePath: splitPath,
      });
    } catch (e) {
      results.push({
        studentId: segment.studentId,
        label: segment.label,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const confirmedSegments: ConfirmedSegment[] = segments.map((s) => ({
    label: s.label,
    pages: s.pages,
    matchedStudentId: s.studentId,
  }));

  await supabase
    .from("ai_grade_batches")
    .update({
      status: "split",
      confirmed_segments: confirmedSegments,
      split_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  return NextResponse.json({
    batchId,
    results,
    splitCount: results.filter((r) => r.status === "split").length,
    failedCount: results.filter((r) => r.status === "failed").length,
  });
}
