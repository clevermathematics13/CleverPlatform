import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * POST /api/tests/[id]/ai-grade/accept
 * Body: { runId: string, items: { testItemId: string, marks: number }[] }
 *
 * Promotes reviewed AI suggestions into student_marks — the only path by which
 * an AI suggestion becomes a real mark. Every write is logged to mark_changes
 * with an explicit reason so the audit trail distinguishes AI-assisted marks
 * from marks the teacher entered directly.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: testId } = await params;

  let body: { runId?: string; items?: { testItemId: string; marks: number }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = body.runId;
  const incoming = body.items ?? [];

  if (!runId || incoming.length === 0) {
    return NextResponse.json(
      { error: "runId and a non-empty items array are required" },
      { status: 400 }
    );
  }

  const { data: run } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, student_id, status")
    .eq("id", runId)
    .maybeSingle();

  if (!run || run.test_id !== testId) {
    return NextResponse.json(
      { error: "Grading run not found for this test" },
      { status: 404 }
    );
  }

  const studentId = run.student_id as string;
  const itemIds = incoming.map((i) => i.testItemId);

  // Validate every item belongs to this test and clamp to its maximum.
  const { data: testItems } = await supabase
    .from("test_items")
    .select("id, max_marks")
    .eq("test_id", testId)
    .in("id", itemIds);

  const maxById = new Map(
    (testItems ?? []).map((t) => [t.id as string, t.max_marks as number])
  );

  const { data: existingMarks } = await supabase
    .from("student_marks")
    .select("test_item_id, marks_awarded")
    .eq("student_id", studentId)
    .in("test_item_id", itemIds);

  const oldById = new Map(
    (existingMarks ?? []).map((m) => [
      m.test_item_id as string,
      m.marks_awarded as number,
    ])
  );

  const accepted: string[] = [];
  const rejected: { testItemId: string; reason: string }[] = [];

  for (const item of incoming) {
    const max = maxById.get(item.testItemId);
    if (max === undefined) {
      rejected.push({ testItemId: item.testItemId, reason: "Not an item of this test" });
      continue;
    }

    const marks = Math.max(0, Math.min(Math.round(Number(item.marks)), max));
    if (!Number.isFinite(marks)) {
      rejected.push({ testItemId: item.testItemId, reason: "Invalid mark value" });
      continue;
    }

    const { error: upsertError } = await supabase.from("student_marks").upsert(
      {
        test_item_id: item.testItemId,
        student_id: studentId,
        marks_awarded: marks,
      },
      { onConflict: "test_item_id,student_id" }
    );

    if (upsertError) {
      rejected.push({ testItemId: item.testItemId, reason: upsertError.message });
      continue;
    }

    await supabase.from("mark_changes").insert({
      test_item_id: item.testItemId,
      student_id: studentId,
      changed_by: user.id,
      old_marks: oldById.get(item.testItemId) ?? null,
      new_marks: marks,
      reason: `AI-assisted grading, reviewed and accepted (run ${runId})`,
    });

    await supabase
      .from("ai_grade_results")
      .update({
        accepted: true,
        accepted_at: new Date().toISOString(),
        accepted_by: user.id,
        suggested_marks: marks,
      })
      .eq("run_id", runId)
      .eq("test_item_id", item.testItemId);

    accepted.push(item.testItemId);
  }

  return NextResponse.json({
    accepted: accepted.length,
    rejected,
    studentId,
  });
}
