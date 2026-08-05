import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

const TEST_FIELDS =
  "id, teacher_id, student_name, student_name_source, student_name_confidence, student_name_notes, printed_grade_level, grade_level, grade_level_source, grade_level_confidence, grade_level_notes, file_name, status, error_message, created_at, completed_at";

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
    .select(TEST_FIELDS)
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

// PATCH /api/placement/[id] — correct details read off the front page (the
// student name and/or grade level), e.g. when the handwriting was misread.
// Body: { studentName?: string, gradeLevel?: number }
//
// Note: gradeLevel here is the EFFECTIVE placement grade (already adjusted),
// i.e. what the teacher sees and expects to correct — not the printed value.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as {
    studentName?: string;
    gradeLevel?: number | string | null;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { data: test, error: fetchErr } = await supabase
    .from("placement_tests")
    .select("id, teacher_id")
    .eq("id", id)
    .single();

  if (fetchErr || !test) {
    return NextResponse.json({ error: "Placement test not found" }, { status: 404 });
  }
  if (test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};

  if (body.studentName !== undefined) {
    const studentName = body.studentName?.trim();
    if (!studentName) {
      return NextResponse.json({ error: "studentName cannot be empty" }, { status: 400 });
    }
    // A teacher-entered value is authoritative: clear the extraction
    // confidence flag so it stops showing as needing review.
    updates.student_name = studentName;
    updates.student_name_source = "manual";
    updates.student_name_confidence = null;
    updates.student_name_notes = null;
  }

  if (body.gradeLevel !== undefined) {
    const raw = body.gradeLevel;
    const parsed =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? parseInt(raw.trim(), 10)
        : null;

    if (parsed === null || !Number.isFinite(parsed) || parsed < 1 || parsed > 13) {
      return NextResponse.json(
        { error: "gradeLevel must be a whole number between 1 and 13" },
        { status: 400 }
      );
    }
    updates.grade_level = parsed;
    updates.grade_level_source = "manual";
    updates.grade_level_confidence = null;
    updates.grade_level_notes = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from("placement_tests")
    .update(updates)
    .eq("id", id)
    .select(TEST_FIELDS)
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ placementTest: updated });
}
