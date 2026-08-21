import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// POST /api/na-review/save
// Body: { cropId, verdict, marksAwarded, marginComment, nextStep, edited }
// Writes the teacher's final decision onto na_feedback and marks it
// approved. `edited` should be true only when the teacher actually
// changed something from the AI draft -- an unmodified accept keeps
// teacher_edited=false so later analysis can distinguish "AI was right"
// from "teacher corrected this."
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = (await request.json()) as {
    cropId: string;
    verdict: "correct" | "partial" | "incorrect" | "unclear";
    marksAwarded: number;
    marginComment: string;
    nextStep: string;
    edited: boolean;
  };

  const { cropId, verdict, marksAwarded, marginComment, nextStep, edited } = body;

  if (!cropId || !verdict || marksAwarded === undefined) {
    return NextResponse.json(
      { error: "cropId, verdict, and marksAwarded are required" },
      { status: 400 }
    );
  }

  const validVerdicts = ["correct", "partial", "incorrect", "unclear"];
  if (!validVerdicts.includes(verdict)) {
    return NextResponse.json({ error: "Invalid verdict" }, { status: 400 });
  }

  // na_feedback rows are created by the assessment worker (one per crop);
  // this route only ever updates an existing row, never creates one, so a
  // missing row means the crop hasn't been assessed yet -- surface that
  // clearly rather than silently no-op'ing
  const { data: existing, error: fetchErr } = await supabase
    .from("na_feedback")
    .select("id, crop_id")
    .eq("crop_id", cropId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) {
    return NextResponse.json(
      { error: "No feedback row exists for this crop yet -- it may not have been assessed" },
      { status: 404 }
    );
  }

  const { error: updateErr } = await supabase
    .from("na_feedback")
    .update({
      final_verdict: verdict,
      final_marks_awarded: marksAwarded,
      final_margin_comment: marginComment,
      final_next_step: nextStep,
      teacher_edited: edited,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
