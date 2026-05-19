import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * POST /api/reflection/update-mark
 * Teacher adjusts a student's mark for a single test item.
 * Writes to student_marks and logs the change in mark_changes.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const body = await request.json();
  const { testItemId, studentId, newMarks, reason } = body as {
    testItemId: string;
    studentId: string;
    newMarks: number;
    reason?: string;
  };

  if (!testItemId || !studentId || newMarks === undefined) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Validate the test item exists and get max_marks
  const { data: testItem } = await supabase
    .from("test_items")
    .select("id, max_marks")
    .eq("id", testItemId)
    .single();

  if (!testItem) {
    return NextResponse.json(
      { error: "Test item not found" },
      { status: 404 }
    );
  }

  const clamped = Math.max(0, Math.min(Math.round(newMarks), testItem.max_marks));

  // Get current mark for audit log
  const { data: existing } = await supabase
    .from("student_marks")
    .select("marks_awarded")
    .eq("test_item_id", testItemId)
    .eq("student_id", studentId)
    .maybeSingle();

  const oldMarks = existing?.marks_awarded ?? null;

  // Upsert the mark
  const { error: upsertError } = await supabase
    .from("student_marks")
    .upsert(
      {
        test_item_id: testItemId,
        student_id: studentId,
        marks_awarded: clamped,
      },
      { onConflict: "test_item_id,student_id" }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: "Failed to update mark" },
      { status: 500 }
    );
  }

  // Log the change
  await supabase.from("mark_changes").insert({
    test_item_id: testItemId,
    student_id: studentId,
    changed_by: user.id,
    old_marks: oldMarks,
    new_marks: clamped,
    reason: reason ?? null,
  });

  return NextResponse.json({ success: true, marks_awarded: clamped });
}
