import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { callGradeStudentWork } from "@/lib/msa-grader";

/**
 * POST /api/grader/grade
 *
 * Teacher-only endpoint. Triggers the MSA Grader GAS pipeline for a
 * specific student's Drive file, then upserts the returned marks into
 * `student_marks` with auto_graded = true.
 *
 * Body: { testId, studentId, driveFileId, examId }
 *   testId      – UUID of the test (used to look up test_items)
 *   studentId   – profile_id of the student
 *   driveFileId – Google Drive ID of the student's PDF/image
 *   examId      – Drive folder or question doc ID for the markscheme
 */
export async function POST(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { testId, studentId, driveFileId, examId } = body as Record<string, unknown>;

  if (
    typeof testId !== "string" || !testId.trim() ||
    typeof studentId !== "string" || !studentId.trim() ||
    typeof driveFileId !== "string" || !driveFileId.trim()
  ) {
    return NextResponse.json(
      { error: "testId, studentId, and driveFileId are required strings" },
      { status: 400 }
    );
  }

  // 1. Call the GAS grading pipeline
  let graderResult;
  try {
    graderResult = await callGradeStudentWork(
      driveFileId,
      typeof examId === "string" ? examId : testId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Grader error: ${message}` }, { status: 502 });
  }

  // 2. Load the test_items for this test so we can match by question/part
  const { data: testItems, error: tiErr } = await supabase
    .from("test_items")
    .select("id, question_number, part_label")
    .eq("test_id", testId);

  if (tiErr) {
    return NextResponse.json({ error: tiErr.message }, { status: 500 });
  }

  // 3. Build upsert rows, matching GAS mark entries to test_items
  const upsertRows: Array<{
    test_item_id: string;
    student_id: string;
    marks_awarded: number;
    auto_graded: boolean;
  }> = [];

  for (const mark of graderResult.marks) {
    const item = testItems?.find(
      (ti) =>
        ti.question_number === mark.questionNumber &&
        (ti.part_label ?? "") === (mark.partLabel ?? "")
    );
    if (!item) continue; // No matching item — skip silently

    upsertRows.push({
      test_item_id: item.id,
      student_id: studentId,
      marks_awarded: mark.score,
      auto_graded: true,
    });
  }

  if (upsertRows.length === 0) {
    return NextResponse.json(
      { ok: true, marksWritten: 0, warning: "No matching test items found for returned marks" }
    );
  }

  // 4. Upsert into student_marks
  const { error: upsertErr } = await supabase
    .from("student_marks")
    .upsert(upsertRows, { onConflict: "test_item_id,student_id" });

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, marksWritten: upsertRows.length });
}
