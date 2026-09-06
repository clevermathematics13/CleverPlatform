import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";
import { logMarkChanges, markKey, readPriorMarks } from "@/lib/mark-audit";

const AUDIT_REASON = "Gradebook edit";

export async function POST(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { testItemId, studentId, marksAwarded } =
    body as Record<string, unknown>;

  if (
    typeof testItemId !== "string" ||
    typeof studentId !== "string" ||
    !testItemId.trim() ||
    !studentId.trim()
  ) {
    return NextResponse.json(
      { error: "testItemId and studentId are required strings" },
      { status: 400 }
    );
  }

  // studentId is the opaque subject id every AI-grade endpoint also
  // understands -- usually a real profiles.id, but "invited-<id>" for a
  // roster entry that has never logged in (see parseGradingSubject).
  const subject = parseGradingSubject(studentId);

  // Read what is there now, before either branch overwrites it -- a mark
  // that is about to be replaced or deleted is the only place the old value
  // still exists.
  const prior = await readPriorMarks(supabase, [{ testItemId, subject }]);
  const oldMarks = prior.get(markKey(testItemId, subject)) ?? null;

  // Delete mark (clear the cell)
  if (marksAwarded === null || marksAwarded === undefined) {
    let del = supabase.from("student_marks").delete().eq("test_item_id", testItemId);
    del = subject.kind === "invited" ? del.eq("invited_student_id", subject.id) : del.eq("student_id", subject.id);
    const { error } = await del;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    // Logged as new_marks null: a cleared cell is not a score of 0.
    await logMarkChanges(
      supabase,
      [{ testItemId, subject, oldMarks, newMarks: null }],
      user.id,
      AUDIT_REASON
    );
    return NextResponse.json({ ok: true });
  }

  const marks = parseInt(String(marksAwarded), 10);
  if (isNaN(marks) || marks < 0) {
    return NextResponse.json(
      { error: "marksAwarded must be a non-negative integer" },
      { status: 400 }
    );
  }

  // UPSERT — RLS will deny if the teacher doesn't own the test
  const { error } = await supabase.from("student_marks").upsert(
    {
      test_item_id: testItemId,
      student_id: subject.kind === "profile" ? subject.id : null,
      invited_student_id: subject.kind === "invited" ? subject.id : null,
      marks_awarded: marks,
    },
    { onConflict: subject.kind === "invited" ? "test_item_id,invited_student_id" : "test_item_id,student_id" }
  );

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await logMarkChanges(
    supabase,
    [{ testItemId, subject, oldMarks, newMarks: marks }],
    user.id,
    AUDIT_REASON
  );

  return NextResponse.json({ ok: true });
}
