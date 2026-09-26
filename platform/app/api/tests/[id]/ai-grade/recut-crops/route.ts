import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { applyRunRecut, planRunRecut } from "@/lib/evidence-recut";

export const maxDuration = 300;

/**
 * POST /api/tests/[id]/ai-grade/recut-crops
 * Body: { runId: string }
 *
 * Re-cuts one student's evidence crops from the best geometry the paper has:
 * its locked layout when there is one, otherwise the marker's own boxes
 * bounded at the next part (lib/evidence-recut.ts decides; this route only
 * carries the request). Idempotent -- a crop that is already what a re-cut
 * would produce is left alone and counted as unchanged, so the button can be
 * pressed twice without making anything worse.
 *
 * WHY A ROUTE AND NOT JUST THE SCRIPT. scripts/recut-evidence-crops.ts does
 * the same thing for a whole assessment, and is the right tool for a backfill.
 * But it needs a terminal, a checkout and the service-role key, and the person
 * who sees a wrong crop is a teacher in the middle of marking. A correction
 * they cannot apply themselves is not much of a correction, so the same repair
 * is here, scoped to the student whose work is on screen.
 *
 * WHAT IT DOES NOT TOUCH. suggested_marks, mark_breakdown, accepted and the
 * student's ClevMarks row are untouched, no model is called, and a region
 * drawn by a teacher is never re-cut. Crops are cut after grading has finished
 * and never re-enter it: a wrong crop never produced a wrong mark, and a
 * corrected one must not produce a different one.
 *
 * This replaced /widen-crops ("Fix crops") on 23 Sep 2026, which dropped every
 * marker-located crop's bottom edge by a further 0.15 of the page on each
 * press -- on top of the 0.15 the grading run already applied -- and so ran
 * crops into the next question the harder it was used.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  let body: { runId?: unknown };
  try {
    body = (await request.json()) as { runId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const planned = await planRunRecut(supabase, testId, runId);
  if (!planned.ok) return NextResponse.json({ error: planned.error }, { status: planned.status });
  const { plan } = planned;

  const { recut, failures } = await applyRunRecut(supabase, testId, plan);

  return NextResponse.json({
    ok: true,
    mode: plan.mode,
    recut,
    unchanged: plan.unchanged,
    skipped: plan.skipped,
    warnings: plan.warnings,
    ...(failures.length > 0 ? { error: failures[0] } : {}),
  });
}
