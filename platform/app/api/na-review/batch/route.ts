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
import {
  NA_SCAN_BUCKET,
  loadInvitedRoster,
  matchSegmentsToInvitedRoster,
  planChunkBoundaries,
  COVER_PAGE_CHECK_MODEL,
  COVER_PAGE_CHECK_SYSTEM_PROMPT,
  buildCoverPageCheckUserPrompt,
  validateCoverPageCheck,
} from "@/lib/na-scanning";

export const maxDuration = 300;

/**
 * GET /api/na-review/batch?packetVersionId=...
 * Lists batch uploads for this packet version, most recent first.
 *
 * POST /api/na-review/batch
 * Body: { packetVersionId: string, storagePath: string, fileName?: string }
 *
 * Stage 1 of the NA scan pipeline. The client uploads the raw batch PDF
 * directly to Supabase Storage BEFORE calling this route, then passes the
 * storage path here.
 *
 * Two outcomes depending on size:
 *
 * SMALL BATCH (<= MAX_BATCH_PAGES, from lib/ai-grading.ts — Anthropic's
 * 100-page PDF document block limit): runs segmentation immediately, same
 * as before. Response has `chunked: false` and the usual segments/
 * warnings/rosterSize fields.
 *
 * OVERSIZED BATCH: does NOT run segmentation itself. Instead it pre-splits
 * the source PDF into several smaller chunk PDFs, each guaranteed to
 * contain only whole student packets (never a packet torn across two
 * chunks) — see lib/na-scanning.ts's planChunkBoundaries, which confirms
 * every cut point against a real cover page via a cheap single-page vision
 * call before committing to it, rather than trusting page-count arithmetic
 * blindly. Each chunk becomes its own na_scan_batches row with
 * parent_batch_id pointing back to this upload, uploaded to storage and
 * ready to segment — but this route does NOT run segmentation on each
 * chunk inline, since 3+ sequential full segmentation calls plus the
 * boundary checks could plausibly exceed this function's own time budget.
 * The client is expected to call this same route again — passing the
 * chunk's own storagePath — to run segmentation on it; that storagePath
 * already lives under na-batches/ and is already under MAX_BATCH_PAGES, so
 * it takes the small-batch path below automatically. No separate route was
 * needed for this. Response has `chunked: true` and a `chunks` array
 * instead of segments.
 *
 * Roster matching (for the small-batch path) is against invited_students,
 * not students/profiles, and resolves virtual track courses (e.g. Grade 9
 * Extended) through track_courses. See lib/na-scanning.ts.
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
      "id, packet_version_id, course_id, status, source_filename, page_count, proposed_segments, confirmed_segments, unassigned_pages, error_message, created_at, segmented_at, split_at, parent_batch_id, chunk_index, chunk_count"
    )
    .eq("packet_version_id", packetVersionId)
    .order("created_at", { ascending: false })
    .limit(40);

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
  const packetPageCount = (packetVersion.page_count as number | null) ?? null;

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

  let sourceDoc: PDFDocument;
  let pageCount: number;
  try {
    sourceDoc = await PDFDocument.load(buffer, { updateMetadata: false });
    pageCount = sourceDoc.getPageCount();
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the PDF's page count: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  const fileName =
    typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "batch-scan.pdf";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ===========================================================================
  // OVERSIZED PATH: pre-split into chunk batches, no segmentation here.
  // ===========================================================================
  if (pageCount > MAX_BATCH_PAGES) {
    if (!packetPageCount || packetPageCount <= 0) {
      return NextResponse.json(
        {
          error: `This scan has ${pageCount} pages (over the ${MAX_BATCH_PAGES}-page limit), but this packet version has no known page_count to plan a split against. Set the packet version's page count first, or split the scan manually.`,
        },
        { status: 400 }
      );
    }

    // -- Create the parent row -----------------------------------------------
    const { data: parentBatch, error: parentErr } = await supabase
      .from("na_scan_batches")
      .insert({
        packet_version_id: packetVersionId,
        course_id: courseId,
        uploaded_by: user.id,
        status: "presplitting",
        source_filename: fileName,
        source_storage_path: storagePath,
        page_count: pageCount,
      })
      .select("id")
      .single();

    if (parentErr || !parentBatch) {
      return NextResponse.json(
        { error: `Could not create parent batch record: ${parentErr?.message ?? "unknown error"}` },
        { status: 500 }
      );
    }

    const failParent = async (message: string, status = 500) => {
      await supabase
        .from("na_scan_batches")
        .update({ status: "failed", error_message: message })
        .eq("id", parentBatch.id);
      return NextResponse.json({ error: message, batchId: parentBatch.id }, { status });
    };

    // -- Plan chunk boundaries, confirming each cut against a real cover page --
    const checkIsCoverPage = async (page: number): Promise<boolean> => {
      try {
        const singlePageDoc = await PDFDocument.create();
        const [copied] = await singlePageDoc.copyPages(sourceDoc, [page - 1]);
        singlePageDoc.addPage(copied);
        const singlePageBytes = await singlePageDoc.save();

        const message = await anthropic.messages.create({
          model: COVER_PAGE_CHECK_MODEL,
          max_tokens: 512,
          system: COVER_PAGE_CHECK_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: Buffer.from(singlePageBytes).toString("base64"),
                  },
                },
                { type: "text", text: buildCoverPageCheckUserPrompt() },
              ],
            },
          ],
        });
        const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
        const validated = validateCoverPageCheck(text);
        return validated.ok && validated.result.isCoverPage;
      } catch {
        // A failed check is treated as "not a cover page" -- planChunkBoundaries
        // will keep searching the window and fall back to the estimate with a
        // warning rather than this route throwing outright.
        return false;
      }
    };

    let plan: { chunks: { startPage: number; endPage: number }[]; warnings: string[] };
    try {
      plan = await planChunkBoundaries(pageCount, packetPageCount, MAX_BATCH_PAGES, checkIsCoverPage);
    } catch (e) {
      return failParent(`Could not plan chunk boundaries: ${e instanceof Error ? e.message : String(e)}`);
    }

    // -- Split the source PDF at the confirmed boundaries and create child rows --
    const chunkResults: {
      batchId: string;
      chunkIndex: number;
      startPage: number;
      endPage: number;
      pageCount: number;
      storagePath: string;
    }[] = [];

    for (let i = 0; i < plan.chunks.length; i++) {
      const { startPage, endPage } = plan.chunks[i];
      const chunkPageIndices = Array.from({ length: endPage - startPage + 1 }, (_, k) => startPage - 1 + k);

      const chunkDoc = await PDFDocument.create();
      const copiedPages = await chunkDoc.copyPages(sourceDoc, chunkPageIndices);
      for (const p of copiedPages) chunkDoc.addPage(p);
      const chunkBytes = Buffer.from(await chunkDoc.save());

      const chunkPath = `na-batches/${parentBatch.id}/chunk-${i + 1}-${Date.now()}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from(NA_SCAN_BUCKET)
        .upload(chunkPath, chunkBytes, { contentType: "application/pdf", upsert: true });
      if (uploadErr) {
        return failParent(`Could not upload chunk ${i + 1}: ${uploadErr.message}`);
      }

      const { data: childBatch, error: childErr } = await supabase
        .from("na_scan_batches")
        .insert({
          packet_version_id: packetVersionId,
          course_id: courseId,
          uploaded_by: user.id,
          status: "uploaded",
          source_filename: `${fileName} (chunk ${i + 1} of ${plan.chunks.length}, pages ${startPage}-${endPage})`,
          source_storage_path: chunkPath,
          page_count: chunkPageIndices.length,
          parent_batch_id: parentBatch.id,
          chunk_index: i + 1,
          chunk_count: plan.chunks.length,
        })
        .select("id")
        .single();

      if (childErr || !childBatch) {
        return failParent(`Could not create chunk ${i + 1} batch record: ${childErr?.message ?? "unknown error"}`);
      }

      chunkResults.push({
        batchId: childBatch.id,
        chunkIndex: i + 1,
        startPage,
        endPage,
        pageCount: chunkPageIndices.length,
        storagePath: chunkPath,
      });
    }

    await supabase
      .from("na_scan_batches")
      .update({ status: "chunked" })
      .eq("id", parentBatch.id);

    return NextResponse.json({
      chunked: true,
      parentBatchId: parentBatch.id,
      pageCount,
      packetPageCount,
      chunks: chunkResults,
      warnings: plan.warnings,
    });
  }

  // ===========================================================================
  // SMALL BATCH PATH: unchanged from before -- segment immediately.
  // ===========================================================================
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
    chunked: false,
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
