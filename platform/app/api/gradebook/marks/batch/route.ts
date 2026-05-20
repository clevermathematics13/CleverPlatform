import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

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

  const upserts = entries
    .filter((e) => e.marksAwarded !== null && e.marksAwarded !== undefined)
    .map((e) => ({
      test_item_id: e.testItemId,
      student_id: e.studentId,
      marks_awarded: e.marksAwarded as number,
    }));

  const deletes = entries.filter(
    (e) => e.marksAwarded === null || e.marksAwarded === undefined
  );

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("student_marks")
      .upsert(upserts, { onConflict: "test_item_id,student_id" });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const e of deletes) {
    const { error } = await supabase
      .from("student_marks")
      .delete()
      .eq("test_item_id", e.testItemId)
      .eq("student_id", e.studentId);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
