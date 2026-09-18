import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";
import { formatGradingSubject } from "@/lib/grading-subject";
import {
  fractionBoxToPoints,
  widenStoredModelBox,
  type EvidenceBox,
} from "@/lib/evidence-crops";
import { cropRegions, cvServiceEndpoint } from "@/lib/cv-crop-service";

export const maxDuration = 300;

/**
 * POST /api/tests/[id]/ai-grade/widen-crops
 * Body: { runId: string }
 *
 * Re-cuts every model-located crop on one student's run with its bottom edge
 * dropped by MODEL_DOWNWARD_BIAS, so the crop reaches the handwriting instead
 * of stopping at the printed prompt above it.
 *
 * WHY A ROUTE AND NOT JUST THE SCRIPT. scripts/recut-evidence-crops.ts does
 * the same thing for a whole assessment, and is the right tool for a backfill.
 * But it needs a terminal, a checkout and the service-role key, and the person
 * who sees a wrong crop is a teacher in the middle of marking. A correction
 * they cannot apply themselves is not much of a correction, so the same repair
 * is here, scoped to the student whose work is on screen.
 *
 * WHAT IT DOES NOT TOUCH. suggested_marks, mark_breakdown, accepted and the
 * student's Clev's Marks row are untouched, and no model is called. Crops are
 * cut after grading has finished and never re-enter it: a wrong crop never
 * produced a wrong mark, and a corrected one must not produce a different one.
 * Only rows whose box the MARKER guessed are touched -- a region drawn by a
 * teacher or cut from a locked paper layout is a decision or a measurement,
 * and neither is this function's to overwrite.
 *
 * Each new PNG gets its own storage key rather than replacing the original,
 * because the original is what the teacher reviewed the suggested mark
 * against, and a mark already accepted was made against that picture.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  let body: { runId?: unknown };
  try {
    body = (await request.json()) as { runId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  if (!cvServiceEndpoint("/crop")) {
    return NextResponse.json({ error: "Cropping is not configured on this deployment" }, { status: 503 });
  }

  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, student_id, invited_student_id, source_storage_path")
    .eq("id", runId)
    .maybeSingle();
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  if (!run || run.test_id !== testId) {
    return NextResponse.json({ error: "That run does not belong to this assessment" }, { status: 400 });
  }
  if (!run.source_storage_path) {
    return NextResponse.json({ error: "No source scan on file for this run" }, { status: 404 });
  }
  const subjectId = formatGradingSubject(run);
  if (!subjectId) {
    return NextResponse.json({ error: "This run has no student on it to file crops under" }, { status: 422 });
  }

  const { data: results, error: resultsErr } = await supabase
    .from("ai_grade_results")
    .select("id, test_item_id, evidence_box, evidence_box_source")
    .eq("run_id", runId);
  if (resultsErr) return NextResponse.json({ error: resultsErr.message }, { status: 500 });

  // A null source is a row graded before the column existed, which is a model
  // box by construction -- there was no other kind then.
  const candidates = (results ?? []).filter(
    (r) => (r.evidence_box_source ?? "model") === "model" && r.evidence_box
  );
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, widened: 0, skipped: 0, message: "No marker-located crops to widen on this student." });
  }

  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(run.source_storage_path);
  if (dlErr || !pdfFile) {
    return NextResponse.json({ error: dlErr?.message ?? "Could not read the source scan" }, { status: 500 });
  }
  const pdfBytes = Buffer.from(await pdfFile.arrayBuffer());
  const pdfBase64 = pdfBytes.toString("base64");

  let pageCount = 0;
  const pageSizes: { widthPt: number; heightPt: number }[] = [];
  try {
    const doc = await PDFDocument.load(pdfBytes);
    pageCount = doc.getPageCount();
    for (const p of doc.getPages()) pageSizes.push({ widthPt: p.getWidth(), heightPt: p.getHeight() });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the source scan: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const boxByResult = new Map<string, EvidenceBox>();
  const regions: { qid: string; pageIndex: number; x0Pt: number; y0Pt: number; x1Pt: number; y1Pt: number }[] = [];
  let skipped = 0;
  for (const result of candidates) {
    const stored = result.evidence_box as EvidenceBox;
    const widened = widenStoredModelBox(stored);
    const pageIndex = stored.page - 1;
    const size = pageSizes[pageIndex];
    if (!widened || !size) {
      skipped++;
      continue;
    }
    boxByResult.set(result.id as string, widened);
    regions.push({ qid: result.id as string, pageIndex, ...fractionBoxToPoints(widened, size) });
  }
  if (regions.length === 0) {
    return NextResponse.json({ ok: true, widened: 0, skipped, message: "Nothing on this student could be widened." });
  }

  // One call for the whole student: the service takes the set, and a request
  // per part would turn a class into an afternoon.
  const cropped = await cropRegions({ pdfBase64, expectedPageCount: pageCount, regions });
  if (!cropped.ok) return NextResponse.json({ error: cropped.error }, { status: 502 });

  const stamp = Date.now();
  let widened = 0;
  const failures: string[] = [];
  for (const crop of cropped.value) {
    const box = boxByResult.get(crop.qid);
    const result = candidates.find((r) => r.id === crop.qid);
    if (!crop.imageBase64 || !box || !result) {
      skipped++;
      continue;
    }
    const storagePath = `${testId}/${subjectId}/evidence/${run.id}/${result.test_item_id}--widened-${stamp}.png`;
    const { error: uploadErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .upload(storagePath, Buffer.from(crop.imageBase64, "base64"), {
        contentType: "image/png",
        upsert: false,
      });
    if (uploadErr) {
      failures.push(uploadErr.message);
      continue;
    }
    const { error: updateErr } = await supabase
      .from("ai_grade_results")
      // Still 'model': a widened guess is a guess, and the review table must
      // keep saying so.
      .update({ evidence_image_path: storagePath, evidence_box: box, evidence_box_source: "model" })
      .eq("id", result.id);
    if (updateErr) failures.push(updateErr.message);
    else widened++;
  }

  return NextResponse.json({
    ok: true,
    widened,
    skipped,
    ...(failures.length > 0 ? { error: failures[0] } : {}),
  });
}
