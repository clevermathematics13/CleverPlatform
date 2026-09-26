import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";
import { markExportsStale } from "@/lib/self-assessment-export";
import {
  COULD_NOT_CHECK_SELF_ASSESSMENT,
  COULD_NOT_READ_CLEVMARK,
  isProtectedDecrease,
  protectedRefusalMessage,
} from "@/lib/protected-marks";
import { loadMarkProtection } from "@/lib/protected-marks-service";

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
 *
 * A ClevMark is never lowered once the student has self-assessed the test
 * (lib/protected-marks.ts): that answers 409 with the value kept in
 * `keptMarks`. The dashboard calling this ships in the student bundle, so
 * every message here stays free of "AI".
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
  // Only ever fills the matching identity in, never nulls the other one. On
  // an insert the omitted column defaults to null anyway; on an update it is
  // preserved, so correcting a mark for a student who has since signed in
  // does not strip the invited_student_id that auto_enroll_from_invitations
  // leaves alongside their new student_id.
  const identity =
    subject.kind === "invited"
      ? { invited_student_id: subject.id }
      : { student_id: subject.id };
  const conflictTarget =
    subject.kind === "invited" ? "test_item_id,invited_student_id" : "test_item_id,student_id";
  const identityColumn = subject.kind === "invited" ? "invited_student_id" : "student_id";

  // Get current mark for audit log and the protection check
  const { data: existing, error: existingError } = await supabase
    .from("student_marks")
    .select("marks_awarded")
    .eq("test_item_id", testItemId)
    .eq(identityColumn, subject.id)
    .maybeSingle();

  const oldMarks: number | null = existing?.marks_awarded ?? null;

  // Refused before anything is written; if the check cannot be made, nothing
  // is written either. Invited-only students cannot have self-assessed.
  let selfAssessed = false;
  if (subject.kind === "profile") {
    try {
      const protection = await loadMarkProtection(supabase, [{ testItemId, studentId: subject.id }]);
      selfAssessed = protection.isSelfAssessed(subject.id, testItemId);
    } catch {
      return NextResponse.json({ error: COULD_NOT_CHECK_SELF_ASSESSMENT }, { status: 503 });
    }
  }
  if (selfAssessed && existingError) {
    return NextResponse.json({ error: COULD_NOT_READ_CLEVMARK }, { status: 503 });
  }
  const kept = (value: number) =>
    NextResponse.json(
      { error: protectedRefusalMessage({ kept: value, requested: clamped }), keptMarks: value },
      { status: 409 }
    );
  if (isProtectedDecrease({ existing: oldMarks, requested: clamped, selfAssessed })) {
    return kept(oldMarks!);
  }

  // Upsert the mark
  const { data: written, error: upsertError } = await supabase
    .from("student_marks")
    .upsert(
      {
        test_item_id: testItemId,
        ...identity,
        marks_awarded: clamped,
      },
      { onConflict: conflictTarget }
    )
    .select("marks_awarded")
    .maybeSingle();

  if (upsertError) {
    return NextResponse.json(
      { error: "Failed to update mark" },
      { status: 500 }
    );
  }

  // The database keeps a protected ClevMark rather than failing the write (the
  // student_marks_protect_self_assessed trigger), so a value that came back
  // different was kept: nothing changed, so nothing is logged.
  if (typeof written?.marks_awarded === "number" && written.marks_awarded !== clamped) {
    return kept(written.marks_awarded);
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

  // The levels in the stored PowerSchool export just changed.
  await markExportsStale({ testItemIds: [testItemId] });

  return NextResponse.json({ success: true, marks_awarded: clamped });
}
