import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";

type MarkEntry = {
  testItemId: string;
  studentId: string;
  marksAwarded: number | null;
};

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

  const { marks } = body as { marks?: unknown };
  if (!Array.isArray(marks) || marks.length === 0) {
    return NextResponse.json(
      { error: "marks must be a non-empty array" },
      { status: 400 }
    );
  }

  for (const entry of marks) {
    const e = entry as Record<string, unknown>;
    if (typeof e.testItemId !== "string" || typeof e.studentId !== "string") {
      return NextResponse.json(
        { error: "Each entry needs testItemId and studentId strings" },
        { status: 400 }
      );
    }
  }

  const entries = marks as MarkEntry[];

  // studentId is the opaque subject id every AI-grade endpoint also
  // understands -- usually a real profiles.id, but "invited-<id>" for a
  // roster entry that has never logged in (see parseGradingSubject). Split
  // into two groups since each identity kind needs its own upsert conflict
  // target (test_item_id,student_id vs test_item_id,invited_student_id).
  const withMarks = entries.filter((e) => e.marksAwarded !== null && e.marksAwarded !== undefined);
  const profileUpserts = withMarks
    .filter((e) => parseGradingSubject(e.studentId).kind === "profile")
    .map((e) => ({
      test_item_id: e.testItemId,
      student_id: e.studentId,
      invited_student_id: null,
      marks_awarded: e.marksAwarded as number,
    }));
  const invitedUpserts = withMarks
    .filter((e) => parseGradingSubject(e.studentId).kind === "invited")
    .map((e) => ({
      test_item_id: e.testItemId,
      student_id: null,
      invited_student_id: parseGradingSubject(e.studentId).id,
      marks_awarded: e.marksAwarded as number,
    }));

  const deletes = entries.filter(
    (e) => e.marksAwarded === null || e.marksAwarded === undefined
  );

  if (profileUpserts.length > 0) {
    const { error } = await supabase
      .from("student_marks")
      .upsert(profileUpserts, { onConflict: "test_item_id,student_id" });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (invitedUpserts.length > 0) {
    const { error } = await supabase
      .from("student_marks")
      .upsert(invitedUpserts, { onConflict: "test_item_id,invited_student_id" });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const e of deletes) {
    const subject = parseGradingSubject(e.studentId);
    let del = supabase.from("student_marks").delete().eq("test_item_id", e.testItemId);
    del = subject.kind === "invited" ? del.eq("invited_student_id", subject.id) : del.eq("student_id", subject.id);
    const { error } = await del;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
