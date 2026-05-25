import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * GET  /api/tests/[id]  — fetch test with its items
 * PATCH /api/tests/[id] — update test metadata
 * DELETE /api/tests/[id] — delete test and its items
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await params;

  const { data, error } = await supabase
    .from("tests")
    .select(`
      id, name, test_date, exam_time, release_at, total_marks, course_id, hidden,
      courses(name),
      test_items(id, question_number, part_label, max_marks, subtopic_codes, sort_order)
    `)
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await params;

  const body = await request.json();
  const { name, test_date, exam_time, release_at, total_marks, course_id, hidden } = body;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (test_date !== undefined) updates.test_date = test_date;
  if (exam_time !== undefined) updates.exam_time = exam_time;
  if (release_at !== undefined) updates.release_at = release_at;
  if (total_marks !== undefined) updates.total_marks = total_marks;
  if (course_id !== undefined) updates.course_id = course_id;
  if (hidden !== undefined) updates.hidden = hidden;

  const { data, error } = await supabase
    .from("tests")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id } = await params;

  const { data: testRow, error: testError } = await supabase
    .from("tests")
    .select("id, teacher_id, name, course_id, test_date, exam_time, release_at, total_marks, hidden, paper_url, mark_scheme_url")
    .eq("id", id)
    .single();

  if (testError || !testRow) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  const { data: testItems } = await supabase
    .from("test_items")
    .select("id, test_id, question_number, ib_question_code, part_label, max_marks, subtopic_codes, sort_order")
    .eq("test_id", id)
    .order("sort_order", { ascending: true });

  const itemIds = (testItems ?? []).map((it) => it.id);

  const [{ data: markRows }, { data: selfRows }] = itemIds.length
    ? await Promise.all([
        supabase
          .from("student_marks")
          .select("id, test_item_id, student_id, marks_awarded, created_at")
          .in("test_item_id", itemIds),
        supabase
          .from("student_self_scores")
          .select("id, test_item_id, student_id, self_marks, submitted_at")
          .in("test_item_id", itemIds),
      ])
    : [{ data: [] }, { data: [] }];

  const archivePayload = {
    test: testRow,
    items: testItems ?? [],
    marks: markRows ?? [],
    selfScores: selfRows ?? [],
  };

  const { error: archiveError } = await supabase
    .from("archived_tests")
    .insert({
      teacher_id: testRow.teacher_id,
      original_test_id: testRow.id,
      deleted_by: user.id,
      test_name: testRow.name,
      course_id: testRow.course_id,
      test_date: testRow.test_date,
      exam_time: testRow.exam_time,
      release_at: testRow.release_at,
      total_marks: testRow.total_marks,
      hidden: testRow.hidden,
      paper_url: testRow.paper_url,
      mark_scheme_url: testRow.mark_scheme_url,
      archived_payload: archivePayload,
    });

  if (archiveError) {
    return NextResponse.json({ error: archiveError.message }, { status: 500 });
  }

  // test_items + marks cascade-delete with the test via FK
  const { error } = await supabase.from("tests").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
