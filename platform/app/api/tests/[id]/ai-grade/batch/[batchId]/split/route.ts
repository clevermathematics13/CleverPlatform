import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import {
  GRADING_MODEL,
  GRADING_SYSTEM_PROMPT,
  SCAN_BUCKET,
  assembleMarkScheme,
  buildGradingUserPrompt,
  unitLabel,
  validateGradeResponse,
  type GradingUnit,
} from "@/lib/ai-grading";

export const maxDuration = 800;

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
 * there is no roster auto-match fallback at this step): splits the batch PDF
 * into one PDF per student via pdf-lib, uploads each to the same exam-scans
 * bucket single-student scans already use, and grades each one using EXACTLY
 * the same assembleMarkScheme / prompt / validateGradeResponse pipeline as
 * POST /api/tests/[id]/ai-grade. This route does not duplicate that grading
 * logic's design — a batch student's ai_grade_runs / ai_grade_results rows
 * are indistinguishable from a directly-uploaded single-student scan's,
 * except for source_storage_path pointing at the split-out batch page range.
 *
 * Grades sequentially (not in parallel) to stay well inside Anthropic rate
 * limits for a class-sized batch; each student's failure is isolated and
 * does not stop the rest of the batch.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
      { status: 500 }
    );
  }

  // -- Load the batch and the source PDF -------------------------------------
  const { data: batch, error: batchErr } = await supabase
    .from("ai_grade_batches")
    .select("id, test_id, status, source_storage_path, page_count")
    .eq("id", batchId)
    .maybeSingle();

  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (batch.test_id !== testId) {
    return NextResponse.json({ error: "This batch does not belong to the specified assessment" }, { status: 400 });
  }
  if (batch.status === "split") {
    return NextResponse.json(
      { error: "This batch has already been split and graded. Re-upload to grade again." },
      { status: 409 }
    );
  }

  const pageCount = batch.page_count ?? 0;
  const outOfRange = segments.flatMap((s) => s.pages.filter((p) => p > pageCount));
  if (outOfRange.length > 0) {
    return NextResponse.json(
      { error: `Page(s) ${[...new Set(outOfRange)].join(", ")} are beyond this batch's ${pageCount} pages` },
      { status: 400 }
    );
  }

  const { data: sourceFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(batch.source_storage_path);
  if (dlErr || !sourceFile) {
    return NextResponse.json(
      { error: `Could not read the batch scan: ${dlErr?.message ?? "not found"}` },
      { status: 500 }
    );
  }
  const sourceBuffer = Buffer.from(await sourceFile.arrayBuffer());

  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(sourceBuffer, { updateMetadata: false });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not open the batch PDF: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  await supabase.from("ai_grade_batches").update({ status: "segmenting" }).eq("id", batchId);

  // -- Mark scheme, once for the whole batch (identical to the single-student route) --
  let units: GradingUnit[];
  let assemblyWarnings: string[];
  try {
    const assembled = await assembleMarkScheme(supabase, testId);
    units = assembled.units;
    assemblyWarnings = assembled.warnings;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Mark scheme assembly failed" },
      { status: 500 }
    );
  }
  const gradeable = units.filter((u) => u.markschemeSource !== "none");
  if (gradeable.length === 0) {
    return NextResponse.json(
      {
        error:
          "No mark scheme text is stored for any part of this assessment. Extract the mark scheme LaTeX in the PPQ Bank first.",
        warnings: assemblyWarnings,
      },
      { status: 422 }
    );
  }

  const { data: test } = await supabase.from("tests").select("name").eq("id", testId).maybeSingle();

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results: {
    studentId: string;
    label: string;
    runId: string | null;
    status: "complete" | "failed";
    error?: string;
    suggestedTotal?: number;
    maxTotal?: number;
    partsGraded?: number;
  }[] = [];

  // Sequential by design — see maxDuration note above.
  for (const segment of segments) {
    const runInsert = {
      test_id: testId,
      student_id: segment.studentId,
      created_by: user.id,
      status: "running" as const,
      model: GRADING_MODEL,
      source_storage_path: null as string | null,
    };

    try {
      // -- Split out this student's pages into their own PDF -----------------
      const splitDoc = await PDFDocument.create();
      const copiedPages = await splitDoc.copyPages(
        sourceDoc,
        segment.pages.map((p) => p - 1)
      );
      for (const page of copiedPages) splitDoc.addPage(page);
      const splitBytes = Buffer.from(await splitDoc.save());

      const splitPath = `${testId}/${segment.studentId}/${Date.now()}-batch-${batchId}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from(SCAN_BUCKET)
        .upload(splitPath, splitBytes, { contentType: "application/pdf", upsert: true });
      if (uploadErr) throw new Error(`Could not store split scan: ${uploadErr.message}`);

      runInsert.source_storage_path = splitPath;

      const { data: run, error: runErr } = await supabase
        .from("ai_grade_runs")
        .insert(runInsert)
        .select("id")
        .single();
      if (runErr || !run) throw new Error(`Could not create grading run: ${runErr?.message ?? "unknown"}`);

      const failRun = async (message: string) => {
        await supabase
          .from("ai_grade_runs")
          .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
          .eq("id", run.id);
        results.push({ studentId: segment.studentId, label: segment.label, runId: run.id, status: "failed", error: message });
      };

      // -- Grade, identically to the single-student route ---------------------
      const message = await anthropic.messages.create({
        model: GRADING_MODEL,
        max_tokens: 16384,
        system: GRADING_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: splitBytes.toString("base64") },
              },
              {
                type: "text",
                text: buildGradingUserPrompt(gradeable, {
                  studentName: segment.label,
                  testName: test?.name,
                }),
              },
            ],
          },
        ],
      });

      const responseText = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      if (!responseText.trim()) {
        await failRun("Model returned an empty response");
        continue;
      }

      const validation = validateGradeResponse(responseText, gradeable);
      if (!validation.ok) {
        await failRun(validation.error);
        continue;
      }

      const { grades, warnings } = validation.outcome;
      const rows = grades.map((g) => ({
        run_id: run.id,
        test_item_id: g.unit.testItemId,
        suggested_marks: g.clampedMarks,
        max_marks: g.unit.maxMarks,
        confidence: g.confidence,
        markscheme_source: g.unit.markschemeSource,
        work_found: g.item.workFound,
        reasoning: g.item.reasoning,
        evidence: g.item.evidence,
        mark_breakdown: g.item.markBreakdown,
      }));

      const { error: insertErr } = await supabase.from("ai_grade_results").insert(rows);
      if (insertErr) {
        await failRun(`Could not save results: ${insertErr.message}`);
        continue;
      }

      const suggestedTotal = grades.reduce((s, g) => s + g.clampedMarks, 0);
      const maxTotal = gradeable.reduce((s, u) => s + u.maxMarks, 0);
      const needsReview = grades
        .filter((g) => g.confidence === "low" || !g.item.workFound)
        .map((g) => unitLabel(g.unit));

      const coverage = {
        partsInAssessment: units.length,
        partsGraded: grades.length,
        partsWithoutMarkscheme: units.length - gradeable.length,
        suggestedTotal,
        maxTotal,
        needsReview,
        warnings: [...assemblyWarnings, ...warnings],
        fromBatch: batchId,
      };

      await supabase
        .from("ai_grade_runs")
        .update({ status: "complete", completed_at: new Date().toISOString(), coverage })
        .eq("id", run.id);

      results.push({
        studentId: segment.studentId,
        label: segment.label,
        runId: run.id,
        status: "complete",
        suggestedTotal,
        maxTotal,
        partsGraded: grades.length,
      });
    } catch (e) {
      results.push({
        studentId: segment.studentId,
        label: segment.label,
        runId: null,
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
    completedCount: results.filter((r) => r.status === "complete").length,
    failedCount: results.filter((r) => r.status === "failed").length,
  });
}
