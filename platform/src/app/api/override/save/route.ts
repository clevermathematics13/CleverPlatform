import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/override/save
 * Uses a one-time token to save teacher-overridden self-assessment scores.
 * This adjusts the student's self-scores (student_self_scores), NOT the
 * teacher's marks in student_marks.
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
  const { token, studentId, testId, scores } = body;

  if (!token || !studentId || !testId || !Array.isArray(scores)) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Validate and consume the one-time token
  const { data: tokenRecord, error: tokenError } = await supabase
    .from("override_tokens")
    .select("*")
    .eq("token", token)
    .eq("teacher_id", user.id)
    .eq("student_id", studentId)
    .eq("test_id", testId)
    .eq("used", false)
    .single();

  if (tokenError || !tokenRecord) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 403 }
    );
  }

  // Check expiry
  if (new Date(tokenRecord.expires_at) < new Date()) {
    return NextResponse.json({ error: "Token expired" }, { status: 403 });
  }

  // Mark token as used
  await supabase
    .from("override_tokens")
    .update({ used: true })
    .eq("id", tokenRecord.id);

  // Validate test items belong to this test
  const { data: validItems } = await supabase
    .from("test_items")
    .select("id, max_marks")
    .eq("test_id", testId);

  const validItemMap = new Map(
    (validItems ?? []).map((i) => [i.id, i.max_marks])
  );

  // Upsert self-scores (this writes to student_self_scores, not student_marks)
  for (const score of scores) {
    const { test_item_id, self_marks } = score as {
      test_item_id: string;
      self_marks: number;
    };

    // Verify the item belongs to the test
    const maxMarks = validItemMap.get(test_item_id);
    if (maxMarks === undefined) continue;

    // Clamp value
    const clampedMarks = Math.max(0, Math.min(self_marks, maxMarks));

    const { error: upsertError } = await supabase
      .from("student_self_scores")
      .upsert(
        {
          test_item_id,
          student_id: studentId,
          self_marks: clampedMarks,
          submitted_at: new Date().toISOString(),
          override_by: user.id,
          override_at: new Date().toISOString(),
        },
        { onConflict: "test_item_id,student_id" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: "Failed to save scores" },
        { status: 500 }
      );
    }
  }

  // Log the override
  await supabase.from("debug_log").insert({
    user_id: user.id,
    action: "override_self_scores",
    details: {
      student_id: studentId,
      test_id: testId,
      scores_count: scores.length,
    },
  });

  return NextResponse.json({ success: true });
}
