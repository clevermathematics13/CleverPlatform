import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// GET /api/placement/[id] — fetch a placement test with its questions, marks,
// and (if generated) recommendation.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id } = await params;

  const { data: test, error: testErr } = await supabase
    .from("placement_tests")
    .select(
      "id, teacher_id, student_name, course_id, file_name, status, error_message, created_at, completed_at, courses:course_id(name)"
    )
    .eq("id", id)
    .single();

  if (testErr || !test) {
    return NextResponse.json({ error: "Placement test not found" }, { status: 404 });
  }
  if (test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: questions, error: qErr } = await supabase
    .from("placement_test_questions")
    .select(
      "id, question_number, page_numbers, inferred_question_latex, inferred_markscheme_latex, inferred_max_marks, inferred_level_hint, sort_order"
    )
    .eq("placement_test_id", id)
    .order("sort_order", { ascending: true });

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const questionIds = (questions ?? []).map((q) => q.id);
  let marksByQuestion: Record<string, unknown> = {};
  if (questionIds.length > 0) {
    const { data: marks, error: mErr } = await supabase
      .from("placement_test_marks")
      .select(
        "id, placement_test_question_id, marks_awarded, max_marks, confidence, confidence_notes, student_work_transcription, created_at"
      )
      .in("placement_test_question_id", questionIds);
    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 });
    }
    marksByQuestion = Object.fromEntries((marks ?? []).map((m) => [m.placement_test_question_id, m]));
  }

  const { data: recommendation } = await supabase
    .from("placement_recommendations")
    .select(
      "id, recommended_curriculum, recommended_level, recommended_label, overall_percentage, reasoning, subtopic_breakdown, low_confidence_count, created_at"
    )
    .eq("placement_test_id", id)
    .maybeSingle();

  const questionsWithMarks = (questions ?? []).map((q) => ({
    ...q,
    mark: marksByQuestion[q.id] ?? null,
  }));

  return NextResponse.json({
    placementTest: test,
    questions: questionsWithMarks,
    recommendation: recommendation ?? null,
  });
}
