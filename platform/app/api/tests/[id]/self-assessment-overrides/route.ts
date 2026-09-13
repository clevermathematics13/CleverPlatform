import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  diffOverrides,
  type OverrideMap,
  type OverrideValue,
} from "@/lib/self-assessment-override-diff";

/**
 * PUT /api/tests/[id]/self-assessment-overrides
 * Body: { overrides: { [courseId]: boolean | null } }
 *
 * Per-class exceptions to `tests.require_self_assessment`, which is the gate
 * on a student seeing Clev's Marks before they have self-graded. The flag
 * lives on the test and a test is sat by its whole track family, so without
 * this the only way to release one class of 20 was to release all four,
 * roughly 69 students.
 *
 * `null` means "follow the test": the row is deleted rather than written with
 * some value, because there is no row value that means "no opinion".
 *
 * Deliberately its own route rather than more keys on PATCH /api/tests/[id].
 * That one maps its body onto columns of `tests`; these are rows in another
 * table with their own delete semantics, and folding them in would mean a
 * field that is sometimes a column and sometimes a row.
 *
 * The writes are not a transaction, and the ordering is chosen accordingly:
 * deletes first, then upserts. Both directions leave a coherent state if the
 * second half fails -- a class that should have been released stays gated,
 * never the reverse. Releasing marks that should not have been released is
 * the failure that cannot be taken back.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const body = (await request.json().catch(() => null)) as { overrides?: unknown } | null;
  if (!body || typeof body.overrides !== "object" || body.overrides === null) {
    return NextResponse.json({ error: "overrides must be an object" }, { status: 400 });
  }

  const next: OverrideMap = {};
  for (const [courseId, value] of Object.entries(body.overrides as Record<string, unknown>)) {
    if (value !== null && typeof value !== "boolean") {
      return NextResponse.json(
        { error: `overrides.${courseId} must be true, false or null` },
        { status: 400 }
      );
    }
    next[courseId] = value as OverrideValue;
  }

  const { data: test } = await supabase
    .from("tests")
    .select("id")
    .eq("id", testId)
    .maybeSingle();
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  const { data: existing, error: readError } = await supabase
    .from("test_course_self_assessment")
    .select("course_id, require_self_assessment")
    .eq("test_id", testId);
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current: OverrideMap = {};
  for (const row of existing ?? []) {
    current[row.course_id as string] = row.require_self_assessment as boolean;
  }

  const { upserts, deletes } = diffOverrides(current, next);

  if (deletes.length > 0) {
    const { error } = await supabase
      .from("test_course_self_assessment")
      .delete()
      .eq("test_id", testId)
      .in("course_id", deletes);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (upserts.length > 0) {
    const { error } = await supabase.from("test_course_self_assessment").upsert(
      upserts.map((u) => ({
        test_id: testId,
        course_id: u.courseId,
        require_self_assessment: u.requireSelfAssessment,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "test_id,course_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: saved } = await supabase
    .from("test_course_self_assessment")
    .select("course_id, require_self_assessment")
    .eq("test_id", testId);

  const overrides: OverrideMap = {};
  for (const row of saved ?? []) {
    overrides[row.course_id as string] = row.require_self_assessment as boolean;
  }

  return NextResponse.json({ overrides, written: upserts.length, removed: deletes.length });
}
