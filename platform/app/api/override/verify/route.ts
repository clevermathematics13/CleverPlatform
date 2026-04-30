import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";

/**
 * POST /api/override/verify
 * Verifies teacher password and issues a one-time override token.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Verify the user is a teacher
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { password, studentId, testId } = body;

  if (!password || !studentId || !testId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Timing-safe password comparison
  const expected = process.env.TEACHER_OVERRIDE_PASSWORD ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "Override password not configured" },
      { status: 500 }
    );
  }

  const passwordBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(expected);

  if (
    passwordBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(passwordBuffer, expectedBuffer)
  ) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Create one-time token
  const token = randomUUID();
  const { error: tokenError } = await supabase
    .from("override_tokens")
    .insert({
      token,
      teacher_id: user.id,
      student_id: studentId,
      test_id: testId,
    });

  if (tokenError) {
    return NextResponse.json(
      { error: "Failed to create token" },
      { status: 500 }
    );
  }

  // Fetch the student's current self-scores and test items
  const { data: items } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  const itemIds = (items ?? []).map((i) => i.id);

  const { data: selfScores } = await supabase
    .from("student_self_scores")
    .select("test_item_id, self_marks")
    .eq("student_id", studentId)
    .in("test_item_id", itemIds);

  const selfMap = new Map(
    (selfScores ?? []).map((s) => [s.test_item_id, s.self_marks])
  );

  const responseItems = (items ?? []).map((item) => ({
    test_item_id: item.id,
    question_number: item.question_number,
    part_label: item.part_label,
    max_marks: item.max_marks,
    self_marks: selfMap.get(item.id) ?? 0,
  }));

  return NextResponse.json({ token, items: responseItems });
}
