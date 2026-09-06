import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";
import { formatGradingSubject } from "@/lib/grading-subject";
import { fractionBoxToPoints, noExpansionCaps, normalizeFractionBox } from "@/lib/evidence-crops";
import { cropRegions, cvServiceEndpoint } from "@/lib/cv-crop-service";

export const maxDuration = 60;

/**
 * POST /api/tests/[id]/ai-grade/results/[resultId]/evidence-box
 * Body: { page: number (1-indexed), x0, y0, x1, y1 } -- fractions of that page
 *
 * Re-cuts one part's evidence crop from a region the TEACHER drew on the
 * scanned page, replacing the one the grading model located.
 *
 * Why this exists: the model reports its evidenceBox as fractions of a page it
 * is never told the dimensions of, and it turns out to synthesise a plausible
 * layout rather than measure one -- on a 41-part paper checked in full, 22 of
 * the 33 crops did not contain the work they were captioned as evidence for,
 * consistently landing above it (often squarely on the previous part). The
 * crop machinery itself is exact: every one of those 33 crops reproduces
 * byte-for-byte from its recorded box, so the coordinates were the only thing
 * wrong. This route lets a teacher supply correct ones for a part they care
 * about, at no Anthropic cost -- the "regenerate this crop" action the
 * evidence_box migration anticipated.
 *
 * DOES NOT TOUCH THE MARK. suggested_marks, mark_breakdown, accepted and the
 * student's Clev's Marks row are all untouched here, and no model is called.
 * That is not incidental: crops are cut after grading has already finished
 * and are never fed back into a grading call, so a wrong crop never produced a
 * wrong mark and a corrected crop must not produce a different one either.
 * Correcting a misread of the student's WORK is a different action with
 * different consequences -- that is the regrade route next door, which
 * deliberately clears `accepted` because it does change the mark's basis.
 *
 * The new PNG is written to its own storage key rather than over the original.
 * The model-located crop is what the teacher reviewed the suggested mark
 * against, so overwriting it would erase the evidence for a decision that has
 * already been made and, where the part was accepted, already reached a
 * student's marks.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; resultId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { id: testId, resultId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalized = normalizeFractionBox(body);
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const box = normalized.box;

  const { data: result, error: resultErr } = await supabase
    .from("ai_grade_results")
    .select("id, run_id, test_item_id")
    .eq("id", resultId)
    .maybeSingle();
  if (resultErr) return NextResponse.json({ error: resultErr.message }, { status: 500 });
  if (!result) return NextResponse.json({ error: "Result not found" }, { status: 404 });

  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, student_id, invited_student_id, source_storage_path")
    .eq("id", result.run_id)
    .maybeSingle();
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  if (!run || run.test_id !== testId) {
    return NextResponse.json({ error: "This result does not belong to the specified assessment" }, { status: 400 });
  }
  if (!run.source_storage_path) {
    return NextResponse.json({ error: "No source scan on file for this run" }, { status: 404 });
  }

  const subjectId = formatGradingSubject(run);
  if (!subjectId) {
    return NextResponse.json({ error: "This run has no student on it to file the crop under" }, { status: 422 });
  }

  if (!cvServiceEndpoint("/crop")) {
    return NextResponse.json({ error: "Cropping is not configured on this deployment" }, { status: 503 });
  }

  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(run.source_storage_path);
  if (dlErr || !pdfFile) {
    return NextResponse.json({ error: dlErr?.message ?? "Could not read the source scan" }, { status: 500 });
  }
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  let pageCount: number;
  let widthPt: number;
  let heightPt: number;
  try {
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
    pageCount = pdfDoc.getPageCount();
    const page = pdfDoc.getPages()[box.page - 1];
    if (!page) {
      return NextResponse.json(
        { error: `Page ${box.page} is out of range for this ${pageCount}-page scan` },
        { status: 422 }
      );
    }
    widthPt = page.getWidth();
    heightPt = page.getHeight();
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the source scan: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const points = fractionBoxToPoints(box, { widthPt, heightPt });

  const cropped = await cropRegions({
    pdfBase64,
    expectedPageCount: pageCount,
    regions: [
      {
        qid: result.test_item_id,
        pageIndex: box.page - 1,
        ...points,
        // Suppress adaptive growth: the teacher has already decided where this
        // part's work ends. See noExpansionCaps.
        ...noExpansionCaps(points),
      },
    ],
  });
  if (!cropped.ok) return NextResponse.json({ error: cropped.error }, { status: 502 });

  const crop = cropped.value.find((c) => c.qid === result.test_item_id);
  if (!crop?.imageBase64) {
    return NextResponse.json({ error: "The crop service returned no image for that region" }, { status: 502 });
  }
  const cropBuffer = Buffer.from(crop.imageBase64, "base64");

  // Sits alongside the run's model-located crops rather than replacing one.
  // `Date.now()` keeps successive corrections of the same part distinct, so a
  // teacher who redraws twice can still see what the first attempt captured.
  const storagePath =
    `${testId}/${subjectId}/evidence/${run.id}/${result.test_item_id}--teacher-${Date.now()}.png`;
  const { error: uploadErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .upload(storagePath, cropBuffer, { contentType: "image/png", upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: `Could not store the new crop: ${uploadErr.message}` }, { status: 500 });
  }

  const { error: updateErr } = await supabase
    .from("ai_grade_results")
    .update({ evidence_image_path: storagePath, evidence_box: box, evidence_box_source: "teacher" })
    .eq("id", resultId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { data: signed } = await supabase.storage.from(SCAN_BUCKET).createSignedUrl(storagePath, 3600);

  return NextResponse.json({
    ok: true,
    evidence_box: box,
    evidence_box_source: "teacher",
    evidence_image_path: storagePath,
    evidence_image_url: signed?.signedUrl ?? null,
  });
}
