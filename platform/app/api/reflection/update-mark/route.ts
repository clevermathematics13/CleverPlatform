import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";

/**
 * POST /api/reflection/update-mark
 * Teacher adjusts a student's mark for a single test item.
 * Writes to student_marks and logs the change in mark_changes.
 *
 * studentId is the opaque subject id the reflection dashboard renders --
 * a profiles.id, or "invited-<id>" for a roster student who has never signed
 * in (parseGradingSubject). Both are writable: student_marks and
 * mark_changes each take either identity, so a teacher can correct a mark
 * for a class where nobody has an account yet.
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

  const subject = parseGradingSubject(studentId);
  const identity =
    subject.kind === "invited"
      ? { student_id: null, invited_student_id: subject.id }
      : { student_id: subject.id, invited_student_id: null };
  const conflictTarget =
    subject.kind === "invited" ? "test_item_id,invited_student_id" : "test_item_id,student_id";
  const identityColumn = subject.kind === "invited" ? "invited_student_id" : "student_id";

  // Get current mark for audit log
  const { data: existing } = await supabase
    .from("student_marks")
    .select("marks_awarded")
    .eq("test_item_id", testItemId)
    .eq(identityColumn, subject.id)
    .maybeSingle();

  const oldMarks = existing?.marks_awarded ?? null;

  // Upsert the mark
  const { error: upsertError } = await supabase
    .from("student_marks")
    .upsert(
      {
        test_item_id: testItemId,
        ...identity,
        marks_awarded: clamped,
      },
      { onConflict: conflictTarget }
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
    ...identity,
    changed_by: user.id,
    old_marks: oldMarks,
    new_marks: clamped,
    reason: reason ?? null,
  });

  return NextResponse.json({ success: true, marks_awarded: clamped });
}
