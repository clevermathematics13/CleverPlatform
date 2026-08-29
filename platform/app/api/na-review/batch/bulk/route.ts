import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export const maxDuration = 30;

const MAX_BULK_UPLOADS = 50;

interface BulkUploadItem {
  storagePath: string;
  fileName: string;
}

/**
 * POST /api/na-review/batch/bulk
 * Body: { packetVersionId: string, uploads: { storagePath: string, fileName?: string }[] }
 *
 * Bulk-create endpoint for the multi-file upload flow. Every file has
 * already been uploaded directly to Supabase Storage by the client (same
 * "na-batches/..." convention the single-file flow uses) before this route
 * is called. Unlike POST /api/na-review/batch, this route does NOT run
 * stage 1 (segmentation) inline -- it only validates and bulk-inserts N
 * na_scan_batches rows with status: 'queued', so it stays fast (pure DB
 * writes, no Anthropic call, no PDF read) regardless of how many files were
 * selected. The bulk-upload worker (platform/worker/) picks up 'queued'
 * rows asynchronously and drives them through the rest of the pipeline --
 * see platform/worker/README.md for what that requires to actually run.
 *
 * Each queued row is otherwise a completely normal na_scan_batches row --
 * "Recent batches" lists it, and if the worker never runs (not yet
 * deployed, or deliberately paused), it just sits at 'queued' visibly
 * rather than silently vanishing.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: { packetVersionId?: unknown; uploads?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const packetVersionId = typeof body.packetVersionId === "string" ? body.packetVersionId.trim() : "";
  if (!packetVersionId) {
    return NextResponse.json({ error: "packetVersionId is required" }, { status: 400 });
  }

  if (!Array.isArray(body.uploads) || body.uploads.length === 0) {
    return NextResponse.json({ error: "uploads must be a non-empty array" }, { status: 400 });
  }
  if (body.uploads.length > MAX_BULK_UPLOADS) {
    return NextResponse.json(
      { error: `A single bulk upload is limited to ${MAX_BULK_UPLOADS} files -- got ${body.uploads.length}.` },
      { status: 400 }
    );
  }

  const uploads: BulkUploadItem[] = [];
  for (const raw of body.uploads as Record<string, unknown>[]) {
    const storagePath = typeof raw.storagePath === "string" ? raw.storagePath.trim() : "";
    const fileName = typeof raw.fileName === "string" && raw.fileName.trim() ? raw.fileName.trim() : "batch-scan.pdf";
    if (!storagePath) {
      return NextResponse.json({ error: "Every upload needs a storagePath" }, { status: 400 });
    }
    if (!storagePath.startsWith("na-batches/")) {
      return NextResponse.json(
        { error: 'Every storagePath must be under "na-batches/" — upload via the batch flow, not directly' },
        { status: 400 }
      );
    }
    uploads.push({ storagePath, fileName });
  }

  // -- Load the packet version and its course, same resolution the single-
  //    upload route uses, so a bulk-queued row looks identical to one
  //    created the normal way once the worker gets to it.
  const { data: packetVersion, error: pvErr } = await supabase
    .from("na_packet_versions")
    .select("id, nuanced_analyses(course_id)")
    .eq("id", packetVersionId)
    .maybeSingle();
  if (pvErr) return NextResponse.json({ error: pvErr.message }, { status: 500 });
  if (!packetVersion) return NextResponse.json({ error: "Packet version not found" }, { status: 404 });

  const naRow = Array.isArray(packetVersion.nuanced_analyses)
    ? packetVersion.nuanced_analyses[0]
    : packetVersion.nuanced_analyses;
  const courseId = (naRow as { course_id: string | null } | null)?.course_id ?? null;

  const { data: created, error: insertErr } = await supabase
    .from("na_scan_batches")
    .insert(
      uploads.map((u) => ({
        packet_version_id: packetVersionId,
        course_id: courseId,
        uploaded_by: user.id,
        status: "queued",
        source_filename: u.fileName,
        source_storage_path: u.storagePath,
      }))
    )
    .select("id");

  if (insertErr) {
    return NextResponse.json({ error: `Could not queue uploads: ${insertErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    queuedCount: created?.length ?? 0,
    batchIds: (created ?? []).map((b) => b.id as string),
  });
}
