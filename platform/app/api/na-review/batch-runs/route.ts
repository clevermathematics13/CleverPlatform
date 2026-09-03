import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// A run is considered abandoned (not actively resuming, just never got a
// terminal PATCH -- a crashed tab, a teacher who gave up) once it's gone
// this long without a progress update. Auto-marked "stale" rather than
// deleted, per the notes on this feature: keep every run for audit/
// debugging, never delete.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

interface BatchRunRow {
  id: string;
  batch_id: string;
  packet_version_id: string;
  teacher_id: string | null;
  stage: string;
  total_students: number;
  students_done: number;
  student_ids_pending: string[];
  status: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

function toClientShape(r: BatchRunRow) {
  return {
    id: r.id,
    batchId: r.batch_id,
    packetVersionId: r.packet_version_id,
    stage: r.stage,
    totalStudents: r.total_students,
    studentsDone: r.students_done,
    studentIdsPending: r.student_ids_pending,
    status: r.status,
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
  };
}

/**
 * GET /api/na-review/batch-runs?batchId=... — poll for a run on this batch
 * (used on page load to check for one to resume). Without batchId, lists
 * every active/paused run across all batches, for the "Active Batch Runs"
 * page.
 *
 * POST /api/na-review/batch-runs — create a run before an automatic
 * crop+assess pass starts. Idempotent against an existing active/paused
 * run for the same batch (returns that one instead of creating a
 * duplicate) so calling this at the top of autoCropAndAssessAll, whether
 * this is a fresh start or a resume after reload, always lands on the same
 * row instead of forking the ledger.
 */
export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  // Lazy sweep on read rather than a separate cron -- see STALE_AFTER_MS.
  const cutoffIso = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  await supabase
    .from("na_batch_runs")
    .update({ status: "stale", finished_at: new Date().toISOString() })
    .in("status", ["active", "paused"])
    .lt("updated_at", cutoffIso);

  const batchId = request.nextUrl.searchParams.get("batchId");

  if (batchId) {
    const { data, error } = await supabase
      .from("na_batch_runs")
      .select(
        "id, batch_id, packet_version_id, teacher_id, stage, total_students, students_done, student_ids_pending, status, started_at, updated_at, finished_at"
      )
      .eq("batch_id", batchId)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ runs: (data ?? []).map((r) => toClientShape(r as BatchRunRow)) });
  }

  // No batchId -- the "Active Batch Runs" listing, enriched with enough
  // batch/packet context to show a human-readable row without a second
  // round trip per run.
  const { data, error } = await supabase
    .from("na_batch_runs")
    .select(
      "id, batch_id, packet_version_id, teacher_id, stage, total_students, students_done, student_ids_pending, status, started_at, updated_at, finished_at, na_scan_batches(source_filename, page_count), na_packet_versions(version_label, nuanced_analyses(title))"
    )
    .in("status", ["active", "paused"])
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const runs = (data ?? []).map((row) => {
    const batch = Array.isArray(row.na_scan_batches) ? row.na_scan_batches[0] : row.na_scan_batches;
    const version = Array.isArray(row.na_packet_versions) ? row.na_packet_versions[0] : row.na_packet_versions;
    const naRow = version ? (Array.isArray(version.nuanced_analyses) ? version.nuanced_analyses[0] : version.nuanced_analyses) : null;
    return {
      ...toClientShape(row as BatchRunRow),
      sourceFilename: batch?.source_filename ?? null,
      pageCount: batch?.page_count ?? null,
      versionLabel: version?.version_label ?? null,
      packetTitle: naRow?.title ?? null,
    };
  });

  return NextResponse.json({ runs });
}

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: { batchId?: unknown; studentIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.filter((s): s is string => typeof s === "string") : [];
  if (!batchId) return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  if (studentIds.length === 0) return NextResponse.json({ error: "studentIds must be a non-empty array" }, { status: 400 });

  // An active/paused run for this batch already exists -- return it rather
  // than inserting a duplicate (the unique index would reject the insert
  // anyway; this avoids the round trip to find that out).
  const { data: existing, error: existingErr } = await supabase
    .from("na_batch_runs")
    .select(
      "id, batch_id, packet_version_id, teacher_id, stage, total_students, students_done, student_ids_pending, status, started_at, updated_at, finished_at"
    )
    .eq("batch_id", batchId)
    .in("status", ["active", "paused"])
    .maybeSingle();
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  if (existing) {
    return NextResponse.json({ runId: existing.id, createdAt: existing.started_at, run: toClientShape(existing as BatchRunRow), resumed: true });
  }

  const { data: batch, error: batchErr } = await supabase
    .from("na_scan_batches")
    .select("id, packet_version_id")
    .eq("id", batchId)
    .maybeSingle();
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const { data: created, error: insertErr } = await supabase
    .from("na_batch_runs")
    .insert({
      batch_id: batchId,
      packet_version_id: batch.packet_version_id,
      teacher_id: user.id,
      stage: "cropping",
      total_students: studentIds.length,
      students_done: 0,
      student_ids_pending: studentIds,
      status: "active",
    })
    .select(
      "id, batch_id, packet_version_id, teacher_id, stage, total_students, students_done, student_ids_pending, status, started_at, updated_at, finished_at"
    )
    .single();
  if (insertErr || !created) {
    // A concurrent request could have raced this one past the existence
    // check above and hit the unique index -- fall back to reading back
    // whatever run now exists for this batch instead of surfacing a 500
    // for what is, from the caller's point of view, a successful resume.
    const { data: raceWinner } = await supabase
      .from("na_batch_runs")
      .select(
        "id, batch_id, packet_version_id, teacher_id, stage, total_students, students_done, student_ids_pending, status, started_at, updated_at, finished_at"
      )
      .eq("batch_id", batchId)
      .in("status", ["active", "paused"])
      .maybeSingle();
    if (raceWinner) {
      return NextResponse.json({ runId: raceWinner.id, createdAt: raceWinner.started_at, run: toClientShape(raceWinner as BatchRunRow), resumed: true });
    }
    return NextResponse.json({ error: `Could not create batch run: ${insertErr?.message ?? "unknown error"}` }, { status: 500 });
  }

  return NextResponse.json({ runId: created.id, createdAt: created.started_at, run: toClientShape(created as BatchRunRow) });
}
