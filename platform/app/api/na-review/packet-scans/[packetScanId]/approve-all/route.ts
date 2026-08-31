import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { isUngradedAnchor, type AnchorContext } from "@/lib/na-assessment";

/**
 * POST /api/na-review/packet-scans/[packetScanId]/approve-all
 *
 * Accepts the AI draft as the teacher's final call for every remaining
 * gradable crop on one student's packet scan -- the per-student
 * counterpart to the per-anchor /api/na-review/bulk-accept, and the step
 * that makes .../release possible without clicking through 39 questions
 * one at a time.
 *
 * Deliberately conservative about what it will touch:
 * - Already-approved rows are left exactly as they are, so a teacher's
 *   earlier manual override (final_* set by hand, teacher_edited=true) is
 *   never overwritten by the AI draft it was correcting.
 * - Rows with no ai_verdict have no draft to accept.
 * - Rows carrying an ai_validation_error are skipped even when they do
 *   have a verdict. bulk-accept assumes validation failure implies no
 *   verdict; that is not actually true of every row in production, so
 *   this checks the error column directly rather than inferring it.
 * - Ungradable anchors (isUngradedAnchor -- pure "thinking space" with no
 *   marks and no answer key) are ignored entirely, matching what both the
 *   results summary and the release gate count.
 *
 * Skipped rows are reported back rather than swallowed: the scan stays
 * un-releasable until the teacher resolves them by hand, which is the
 * intended outcome, so the UI needs to be able to say why.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packetScanId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { packetScanId } = await params;

  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, packet_version_id")
    .eq("id", packetScanId)
    .single();
  if (scanErr || !scan) {
    return NextResponse.json({ error: scanErr?.message ?? "Packet scan not found" }, { status: 404 });
  }

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id, qid, marks_available, question_answer, answer_sketch, open_rubric")
    .eq("packet_version_id", scan.packet_version_id);
  if (anchorErr) return NextResponse.json({ error: anchorErr.message }, { status: 500 });

  const gradableAnchorIds = new Set(
    (anchorRows ?? [])
      .filter(
        (a) =>
          !isUngradedAnchor({
            qid: a.qid,
            baseQid: a.qid,
            marksAvailable: a.marks_available,
            commandTerm: null,
            answerSketch: a.answer_sketch,
            openRubric: a.open_rubric,
            misconceptionContext: null,
            questionAnswer: a.question_answer,
          } satisfies AnchorContext)
      )
      .map((a) => a.id)
  );

  type FeedbackShape = {
    id: string;
    ai_verdict: string | null;
    ai_marks_awarded: number | null;
    ai_margin_comment: string | null;
    ai_next_step: string | null;
    ai_validation_error: string | null;
    approved_at: string | null;
  };
  type CropRow = {
    id: string;
    anchor_id: string;
    na_feedback: FeedbackShape | FeedbackShape[] | null;
  };

  const { data: cropRows, error: cropErr } = await supabase
    .from("na_response_crops")
    .select(
      `id, anchor_id,
       na_feedback(id, ai_verdict, ai_marks_awarded, ai_margin_comment, ai_next_step, ai_validation_error, approved_at)`
    )
    .eq("packet_scan_id", packetScanId);
  if (cropErr) return NextResponse.json({ error: cropErr.message }, { status: 500 });

  const gradableCrops = ((cropRows ?? []) as unknown as CropRow[]).filter((c) =>
    gradableAnchorIds.has(c.anchor_id)
  );

  const toAccept: { feedbackId: string; verdict: string; marks: number; comment: string; next: string }[] = [];
  let alreadyApproved = 0;
  let notAssessed = 0;
  let validationErrors = 0;

  for (const crop of gradableCrops) {
    const fb = Array.isArray(crop.na_feedback) ? crop.na_feedback[0] : crop.na_feedback;
    if (!fb) {
      notAssessed += 1;
      continue;
    }
    if (fb.approved_at) {
      alreadyApproved += 1;
      continue;
    }
    if (fb.ai_validation_error) {
      validationErrors += 1;
      continue;
    }
    if (!fb.ai_verdict) {
      notAssessed += 1;
      continue;
    }
    toAccept.push({
      feedbackId: fb.id,
      verdict: fb.ai_verdict,
      marks: fb.ai_marks_awarded ?? 0,
      comment: fb.ai_margin_comment ?? "",
      next: fb.ai_next_step ?? "",
    });
  }

  const nowIso = new Date().toISOString();
  // Supabase JS has no bulk-update-with-different-values call, so these go
  // out concurrently rather than sequentially -- same approach as
  // bulk-accept, which this route otherwise mirrors.
  const results = await Promise.allSettled(
    toAccept.map((item) =>
      supabase
        .from("na_feedback")
        .update({
          final_verdict: item.verdict,
          final_marks_awarded: item.marks,
          final_margin_comment: item.comment,
          final_next_step: item.next,
          teacher_edited: false,
          approved_by: user.id,
          approved_at: nowIso,
        })
        .eq("id", item.feedbackId)
        .is("approved_at", null)
    )
  );

  const failed = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({
    ok: true,
    approved: toAccept.length - failed,
    failed,
    alreadyApproved,
    skipped: { notAssessed, validationErrors },
    totalGradable: gradableCrops.length,
  });
}
