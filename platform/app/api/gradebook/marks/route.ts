import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  // Delete mark (clear the cell)
  if (marksAwarded === null || marksAwarded === undefined) {
    const { error } = await supabase
      .from("student_marks")
      .delete()
      .eq("test_item_id", testItemId)
      .eq("student_id", studentId);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
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
      student_id: studentId,
      marks_awarded: marks,
    },
    { onConflict: "test_item_id,student_id" }
  );

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
