import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { TEST_DETAIL_SELECT } from "@/lib/test-detail";
import { fetchAllRows } from "@/lib/na-scanning";
import { markExportsStale } from "@/lib/self-assessment-export";

/** An emptied text field means "no value", not an empty string. */
function blankToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

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

  // Shared with the AI-grade page's first render (lib/test-detail.ts).
  const { data, error } = await supabase
    .from("tests")
    .select(TEST_DETAIL_SELECT)
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
  const {
    name, short_name, test_date, exam_time, release_at, total_marks, course_id,
    hidden, hidden_from_gradebook, require_self_assessment,
    paper_url, mark_scheme_url,
  } = body;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  // Blank means "no short name", not an empty one: assessmentShortName falls
  // back to abbreviating the full name, which is better than a filename with
  // an empty middle.
  if (short_name !== undefined) {
    updates.short_name = typeof short_name === "string" && short_name.trim() !== "" ? short_name.trim() : null;
  }
  if (test_date !== undefined) updates.test_date = test_date;
  if (exam_time !== undefined) updates.exam_time = exam_time;
  if (release_at !== undefined) updates.release_at = release_at;
  if (total_marks !== undefined) updates.total_marks = total_marks;
  if (course_id !== undefined) updates.course_id = course_id;
  if (hidden !== undefined) updates.hidden = hidden;
  if (hidden_from_gradebook !== undefined) updates.hidden_from_gradebook = hidden_from_gradebook;
  if (require_self_assessment !== undefined) updates.require_self_assessment = require_self_assessment;
  // boundary_set_id is deliberately not accepted here any more. Each
  // assessment has its own boundaries, decided on the grade-boundaries page
  // with a stated reason (POST .../boundaries/decide); pointing a test at a
  // shared preset from this form would bypass both.
  if (paper_url !== undefined) updates.paper_url = blankToNull(paper_url);
  if (mark_scheme_url !== undefined) updates.mark_scheme_url = blankToNull(mark_scheme_url);

  // Levels are marks over total_marks, so a new total moves every level on
  // the stored PowerSchool files even though no mark changed.
  let previousTotal: number | null | undefined;
  if (updates.total_marks !== undefined) {
    const { data: before } = await supabase.from("tests").select("total_marks").eq("id", id).maybeSingle();
    previousTotal = (before?.total_marks as number | null | undefined) ?? null;
  }

  const { data, error } = await supabase
    .from("tests")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (previousTotal !== undefined && previousTotal !== (data?.total_marks ?? null)) {
    await markExportsStale({ testId: id });
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
    .select("id, teacher_id, name, course_id, test_date, exam_time, release_at, total_marks, hidden, paper_url, mark_scheme_url, boundary_set_id")
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

  // Paged: one assessment for a 50-student track is ~1,800 marks and as many
  // self-scores, past PostgREST's silent 1000-row cap, and an archive that
  // quietly keeps the first 1000 is worse than none. invited_student_id is
  // kept so marks of students who never signed in stay attributable.
  let markRows: unknown[] = [];
  let selfRows: unknown[] = [];
  if (itemIds.length > 0) {
    try {
      [markRows, selfRows] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("student_marks")
            .select("id, test_item_id, student_id, invited_student_id, marks_awarded, created_at")
            .in("test_item_id", itemIds)
            .order("id", { ascending: true })
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase
            .from("student_self_scores")
            .select("id, test_item_id, student_id, self_marks, submitted_at")
            .in("test_item_id", itemIds)
            .order("id", { ascending: true })
            .range(from, to)
        ),
      ]);
    } catch (e) {
      return NextResponse.json(
        { error: `Could not archive the marks: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 }
      );
    }
  }

  // The assessment's grade boundaries and the decisions behind them go with
  // it: its own set is deleted with the test (grade_boundary_sets.test_id
  // cascades), so without this the archive could not say what its levels were.
  const [{ data: bandRows }, { data: decisionRows }, { data: guidanceRows }] = await Promise.all([
    testRow.boundary_set_id
      ? supabase.from("grade_boundaries").select("grade, min_proportion").eq("set_id", testRow.boundary_set_id)
      : Promise.resolve({ data: [] }),
    supabase
      .from("test_boundary_decisions")
      .select("decided_at, decided_by, source, statement, total_marks, boundaries, suggestion_id")
      .eq("test_id", id)
      .order("decided_at", { ascending: true }),
    supabase.from("boundary_guidance").select("note, created_at, archived_at").eq("test_id", id),
  ]);

  const archivePayload = {
    test: testRow,
    items: testItems ?? [],
    marks: markRows,
    selfScores: selfRows,
    gradeBoundaries: {
      bands: bandRows ?? [],
      decisions: decisionRows ?? [],
      guidance: guidanceRows ?? [],
    },
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
