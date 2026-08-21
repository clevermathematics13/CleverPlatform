import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import {
  SEGMENTATION_MODEL,
  SEGMENTATION_SYSTEM_PROMPT,
  MAX_BATCH_PAGES,
  buildSegmentationUserPrompt,
  validateSegmentationResponse,
} from "@/lib/ai-grading";
import { NA_SCAN_BUCKET, loadInvitedRoster, matchSegmentsToInvitedRoster } from "@/lib/na-scanning";

export const maxDuration = 300;

/**
 * GET /api/na-review/batch?packetVersionId=...
 * Lists batch uploads for this packet version, most recent first.
 *
 * POST /api/na-review/batch
 * Body: { packetVersionId: string, storagePath: string, fileName?: string }
 *
 * Stage 1 of the NA scan pipeline: the client uploads the raw batch PDF
 * directly to Supabase Storage BEFORE calling this route — same reasoning
 * as the Tests batch-grading pipeline this is modelled on: a class set of
 * scans can run into the hundreds of megabytes, far past what a serverless
 * function's JSON request body can carry. This route receives only the
 * storage path, downloads it server-side, and runs ONE segmentation pass: a
 * single vision call proposing which pages belong to which student, by
 * reading each student's cover page.
 *
 * It does NOT identify pages against the packet's anchor layout (that's a
 * separate stage, run per-student after the teacher confirms the mapping
 * this route proposes) and does NOT split the PDF or write any
 * na_packet_scans rows — see POST .../batch/[batchId]/split for that.
 *
 * The proposed mapping is persisted to na_scan_batches.proposed_segments so
 * the confirm/split step has something durable to reconcile against; it is
 * never used to write na_packet_scans directly — only a teacher-confirmed
 * mapping (confirmed_segments, written by the split route) does that.
 *
 * Roster matching here is against invited_students, not students/profiles:
 * the current 9A roster has been invited but nobody has logged in yet, so
 * there are no profiles rows to match against. Some packets (Grade 9) live
 * on a virtual "track" course with no roster of its own; loadInvitedRoster
 * resolves that through track_courses and pools every real member class.
 * See lib/na-scanning.ts.
 */

export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const packetVersionId = request.nextUrl.searchParams.get("packetVersionId");
  if (!packetVersionId) {
    return NextResponse.json({ error: "packetVersionId query param is required" }, { status: 400 });
  }

  const { data: batches, error } = await supabase
    .from("na_scan_batches")
    .select(
      "id, packet_version_id, course_id, status, source_filename, page_count, proposed_segments, confirmed_segments, unassigned_pages, error_message, created_at, segmented_at, split_at"
    )
    .eq("packet_version_id", packetVersionId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batches: batches ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: { packetVersionId?: unknown; storagePath?: unknown; fileName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const packetVersionId = typeof body.packetVersionId === "string" ? body.packetVersionId.trim() : "";
  const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
  if (!packetVersionId) {
    return NextResponse.json({ error: "packetVersionId is required" }, { status: 400 });
  }
  if (!storagePath) {
    return NextResponse.json({ error: "storagePath is required" }, { status: 400 });
  }
  // The client must have uploaded under na-batches/ — guards against
  // pointing this route at an unrelated object in the same bucket.
  if (!storagePath.startsWith("na-batches/")) {
    return NextResponse.json(
      { error: 'storagePath must be under "na-batches/" — upload via the batch flow, not directly' },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
      { status: 500 }
    );
  }

  // -- Load the packet version and its course -------------------------------
  const { data: packetVersion, error: pvErr } = await supabase
    .from("na_packet_versions")
    .select("id, version_label, page_count, nuanced_analysis_id, nuanced_analyses(course_id, title)")
    .eq("id", packetVersionId)
    .maybeSingle();
  if (pvErr) return NextResponse.json({ error: pvErr.message }, { status: 500 });
  if (!packetVersion) return NextResponse.json({ error: "Packet version not found" }, { status: 404 });

  const naRow = Array.isArray(packetVersion.nuanced_analyses)
    ? packetVersion.nuanced_analyses[0]
    : packetVersion.nuanced_analyses;
  const courseId = (naRow as { course_id: string | null } | null)?.course_id ?? null;

  // -- Download the uploaded batch PDF ---------------------------------------
  const { data: file, error: dlErr } = await supabase.storage.from(NA_SCAN_BUCKET).download(storagePath);
  if (dlErr || !file) {
    return NextResponse.json(
      { error: `Could not read the uploaded scan: ${dlErr?.message ?? "not found"}` },
      { status: 404 }
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    return NextResponse.json({ error: "Uploaded file is not a PDF" }, { status: 400 });
  }

  let pageCount: number;
  try {
    const pdfDoc = await PDFDocument.load(buffer, { updateMetadata: false });
    pageCount = pdfDoc.getPageCount();
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the PDF's page count: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  if (pageCount > MAX_BATCH_PAGES) {
    return NextResponse.json(
      {
        error: `This scan has ${pageCount} pages; a single batch is limited to ${MAX_BATCH_PAGES} pages (Anthropic's PDF document limit). Split the scan into two batches and upload each separately.`,
      },
      { status: 400 }
    );
  }

  const fileName =
    typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "batch-scan.pdf";

  // -- Open the batch row ------------------------------------------------------
  const { data: batch, error: insertErr } = await supabase
    .from("na_scan_batches")
    .insert({
      packet_version_id: packetVersionId,
      course_id: courseId,
      uploaded_by: user.id,
      status: "segmenting",
      source_filename: fileName,
      source_storage_path: storagePath,
      page_count: pageCount,
    })
    .select("id")
    .single();

  if (insertErr || !batch) {
    return NextResponse.json(
      { error: `Could not create batch record: ${insertErr?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  const failBatch = async (message: string, status = 500) => {
    await supabase.from("na_scan_batches").update({ status: "failed", error_message: message }).eq("id", batch.id);
    return NextResponse.json({ error: message, batchId: batch.id }, { status });
  };

  // -- Segment ------------------------------------------------------------------
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let responseText: string;
  try {
    const message = await anthropic.messages.create({
      model: SEGMENTATION_MODEL,
      max_tokens: 8192,
      system: SEGMENTATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
            },
            { type: "text", text: buildSegmentationUserPrompt(pageCount) },
          ],
        },
      ],
    });
    responseText = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  } catch (e) {
    return failBatch(`Segmentation request failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!responseText.trim()) return failBatch("Model returned an empty segmentation response");

  const validation = validateSegmentationResponse(responseText, pageCount);
  if (!validation.ok) return failBatch(validation.error, 502);

  // -- Match against the invited-student roster ------------------------------
  // courseId may be a virtual track course (e.g. Grade 9 Extended) with no
  // roster of its own -- loadInvitedRoster resolves that via track_courses
  // and pools every real member class automatically.
  const rosterResolution = courseId
    ? await loadInvitedRoster(supabase, courseId)
    : { roster: [], sourceCourseIds: [], isTrack: false };
  const proposedSegments = matchSegmentsToInvitedRoster(validation.response.students, rosterResolution.roster);

  const unassignedPages = [
    ...new Set([
      ...validation.response.unassignedPages,
      ...validation.warnings.flatMap((w) => {
        const m = w.match(/^Page\(s\) (.+) were not mentioned/);
        return m ? m[1].split(", ").map(Number) : [];
      }),
    ]),
  ].sort((a, b) => a - b);

  const { error: updateErr } = await supabase
    .from("na_scan_batches")
    .update({
      status: "segmented",
      proposed_segments: proposedSegments,
      unassigned_pages: unassignedPages,
      segmented_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  if (updateErr) return failBatch(`Could not save segmentation: ${updateErr.message}`);

  return NextResponse.json({
    batchId: batch.id,
    pageCount,
    segments: proposedSegments,
    unassignedPages,
    warnings: validation.warnings,
    rosterSize: rosterResolution.roster.length,
    rosterIsTrack: rosterResolution.isTrack,
    rosterSourceCourseIds: rosterResolution.sourceCourseIds,
  });
}
