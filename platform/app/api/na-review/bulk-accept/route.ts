import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// POST /api/na-review/bulk-accept
// Body: { anchorId, confidenceThreshold }
// Accepts the AI draft as final for every crop under this anchor whose
// ai_confidence is at or above the threshold and which has not already
// been approved. Never touches rows below threshold or already-reviewed
// rows -- this is additive, not a reset.
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = (await request.json()) as {
    anchorId: string;
    confidenceThreshold: number;
  };
  const { anchorId, confidenceThreshold } = body;

  if (!anchorId || confidenceThreshold === undefined) {
    return NextResponse.json(
      { error: "anchorId and confidenceThreshold are required" },
      { status: 400 }
    );
  }

  // find crops under this anchor with an AI draft at/above threshold and
  // not yet approved
  const { data: candidates, error: fetchErr } = await supabase
    .from("na_response_crops")
    .select("id, na_feedback(id, ai_verdict, ai_marks_awarded, ai_margin_comment, ai_next_step, ai_confidence, approved_at)")
    .eq("anchor_id", anchorId);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const toAccept: { feedbackId: string; verdict: string; marks: number; comment: string; next: string }[] = [];
  for (const crop of candidates ?? []) {
    const fb = Array.isArray(crop.na_feedback) ? crop.na_feedback[0] : crop.na_feedback;
    if (!fb || fb.approved_at) continue;
    if (fb.ai_confidence === null || fb.ai_confidence < confidenceThreshold) continue;
    if (!fb.ai_verdict) continue; // validation-failed rows have no ai_verdict, never bulk-accept these
    toAccept.push({
      feedbackId: fb.id,
      verdict: fb.ai_verdict,
      marks: fb.ai_marks_awarded ?? 0,
      comment: fb.ai_margin_comment ?? "",
      next: fb.ai_next_step ?? "",
    });
  }

  if (toAccept.length === 0) {
    return NextResponse.json({ ok: true, accepted: 0 });
  }

  const nowIso = new Date().toISOString();
  // Supabase JS doesn't support a single bulk-update-with-different-values
  // call; issue them concurrently rather than sequentially awaiting each
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
    )
  );

  const failures = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({
    ok: true,
    accepted: toAccept.length - failures,
    failed: failures,
  });
}
