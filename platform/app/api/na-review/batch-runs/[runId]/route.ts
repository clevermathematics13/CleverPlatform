import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

const STAGES = new Set(["cropping", "assessing"]);
const STATUSES = new Set(["active", "paused", "completed", "failed", "stale"]);
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * PATCH /api/na-review/batch-runs/[runId] — progress update from the
 * client's automatic crop+assess driver, called after each student
 * finishes (or on completion/error to close the run out). Every field is
 * optional; only what's provided is written, so a caller can send just
 * `{studentsDone, studentIdsPending}` after one student without having to
 * re-state the rest of the run.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { runId } = await params;

  let body: {
    stage?: unknown;
    studentsDone?: unknown;
    studentIdsPending?: unknown;
    status?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.stage !== undefined) {
    if (typeof body.stage !== "string" || !STAGES.has(body.stage)) {
      return NextResponse.json({ error: `stage must be one of: ${[...STAGES].join(", ")}` }, { status: 400 });
    }
    patch.stage = body.stage;
  }

  if (body.studentsDone !== undefined) {
    if (typeof body.studentsDone !== "number" || !Number.isFinite(body.studentsDone) || body.studentsDone < 0) {
      return NextResponse.json({ error: "studentsDone must be a non-negative number" }, { status: 400 });
    }
    patch.students_done = Math.floor(body.studentsDone);
  }

  if (body.studentIdsPending !== undefined) {
    if (!Array.isArray(body.studentIdsPending) || !body.studentIdsPending.every((s) => typeof s === "string")) {
      return NextResponse.json({ error: "studentIdsPending must be an array of strings" }, { status: 400 });
    }
    patch.student_ids_pending = body.studentIdsPending;
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !STATUSES.has(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}` }, { status: 400 });
    }
    patch.status = body.status;
    if (TERMINAL_STATUSES.has(body.status)) patch.finished_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No recognized fields to update" }, { status: 400 });
  }

  const { data: updatedRun, error } = await supabase
    .from("na_batch_runs")
    .update(patch)
    .eq("id", runId)
    .select(
      "id, batch_id, packet_version_id, stage, total_students, students_done, student_ids_pending, status, started_at, updated_at, finished_at"
    )
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updatedRun) return NextResponse.json({ error: "Batch run not found" }, { status: 404 });

  return NextResponse.json({
    success: true,
    updatedRun: {
      id: updatedRun.id,
      batchId: updatedRun.batch_id,
      packetVersionId: updatedRun.packet_version_id,
      stage: updatedRun.stage,
      totalStudents: updatedRun.total_students,
      studentsDone: updatedRun.students_done,
      studentIdsPending: updatedRun.student_ids_pending,
      status: updatedRun.status,
      startedAt: updatedRun.started_at,
      updatedAt: updatedRun.updated_at,
      finishedAt: updatedRun.finished_at,
    },
  });
}
