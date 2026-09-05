import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  NA_SCAN_BUCKET,
  loadInvitedRoster,
  matchSegmentsToInvitedRoster,
  scanCoverPages,
  COVER_PAGE_CHECK_MODEL,
  COVER_PAGE_CHECK_SYSTEM_PROMPT,
  buildCoverPageCheckUserPrompt,
  validateCoverPageCheck,
  type CoverPageCheck,
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
 * directly to Supabase Storage BEFORE calling this route (a class set of
 * scans runs to hundreds of megabytes, far past what a serverless
 * function's request body can carry), then passes the storage path here.
 *
 * Segmentation works by checking only candidate COVER pages rather than
 * sending the whole document to the model — see scanCoverPages in
 * lib/na-scanning.ts for the reasoning and the measured savings. Two
 * consequences worth knowing when reading this route:
 *
 *   1. Cost. On a 20-student class this sends ~20 pages to the model
 *      instead of ~520, on Haiku rather than Opus. Roughly $0.03 per
 *      batch instead of $6.02.
 *
 *   2. No size limits apply. Every request carries exactly ONE page, so
 *      neither Anthropic's 100-page PDF document limit nor its 32MB
 *      request size limit can be reached, whatever the upload's size or
 *      scan resolution. An earlier version of this route pre-split
 *      oversized uploads into chunk batches to work around those limits;
 *      that machinery is gone because the limits are no longer reachable.
 *
 * This route does NOT split the PDF or write any na_packet_scans rows —
 * it only proposes a page-to-student mapping, persisted to
 * na_scan_batches.proposed_segments. Only a teacher-confirmed mapping
 * (via POST .../batch/[batchId]/split) ever creates packet scans.
 *
 * Roster matching is against invited_students, not students/profiles (the
 * current Grade 9 roster has been invited but nobody has logged in yet, so
 * there are no profiles rows), and resolves virtual track courses like
 * Grade 9 Extended through track_courses.
 *
 * Roster grounding: the roster is now loaded BEFORE segmentation (it used
 * to be loaded after, purely to fuzzy-match whatever name the model already
 * guessed). Every cover-page check now receives the class's real name list
 * in its prompt, so the model does constrained recognition against a known
 * set of names instead of open-vocabulary handwriting OCR — this is what
 * actually fixes bad reads, since fuzzy-matching after the fact can only
 * work with whatever string the model already committed to. When a check
 * returns a confident rosterMatch, that exact roster name is used directly
 * (matchedInvitedId set straight from the roster row, bypassing fuzzy
 * matching entirely); matchSegmentsToInvitedRoster's fuzzy pass remains as
 * the fallback for names the model couldn't confidently place against the
 * roster itself.
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

  // The packet's page count is what makes cover-page-only scanning possible
  // -- it's the stride used to predict where the next packet begins. Without
  // it there's nothing to search around.
  if (!packetPageCount || packetPageCount <= 0) {
    return NextResponse.json(
      {
        error:
          "This packet version has no recorded page count, which is needed to locate where each student's packet begins. Set the packet version's page count first.",
      },
      { status: 400 }
    );
  }

  // -- Load the roster BEFORE segmentation -----------------------------------
  // courseId may be a virtual track course (e.g. Grade 9 Extended) with no
  // roster of its own -- loadInvitedRoster resolves that via track_courses
  // and pools every real member class automatically. Loaded up front now so
  // every cover-page check can be grounded against the real name list
  // rather than reading names blind and fuzzy-matching afterward.
  const rosterResolution = courseId
    ? await loadInvitedRoster(supabase, courseId)
    : { roster: [], sourceCourseIds: [], sourceCourseNames: {}, isTrack: false };
  const rosterNames = rosterResolution.roster.map((r) => r.fullName);
  const rosterByName = new Map(rosterResolution.roster.map((r) => [r.fullName, r]));

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

  // -- Segment by checking candidate cover pages only -------------------------
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Extracts a single page as its own one-page PDF and asks whether it's a
  // cover page (and if so, whose). One page per request is what keeps this
  // clear of Anthropic's document-size and page-count limits entirely. The
  // roster name list is baked into the prompt (see buildCoverPageCheckUserPrompt)
  // so the model is doing constrained recognition against the real class
  // roster rather than open-vocabulary handwriting OCR.
  const checkPage = async (page: number): Promise<CoverPageCheck> => {
    const notCover: CoverPageCheck = {
      isCoverPage: false,
      studentName: null,
      rosterMatch: null,
      confidence: "low",
      note: "",
    };
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
              { type: "text", text: buildCoverPageCheckUserPrompt(rosterNames) },
            ],
          },
        ],
      });
      await recordUsage(supabase, {
        pipeline: "na_cover_page",
        model: COVER_PAGE_CHECK_MODEL,
        usage: message.usage,
        ref: { type: "na_scan_batch", id: batch.id },
      });
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      const validated = validateCoverPageCheck(text);
      return validated.ok ? validated.result : notCover;
    } catch {
      // A failed check reads as "not a cover page": scanCoverPages keeps
      // searching its window and falls back to the expected boundary with a
      // warning, which is a better outcome than aborting the whole batch
      // over one bad page.
      return notCover;
    }
  };

  let scan: Awaited<ReturnType<typeof scanCoverPages>>;
  try {
    scan = await scanCoverPages(pageCount, packetPageCount, checkPage);
  } catch (e) {
    return failBatch(`Cover-page scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (scan.segments.length === 0) {
    return failBatch("No student packets could be identified in this scan.", 502);
  }

  // -- Resolve against the roster ---------------------------------------------
  // scanCoverPages already preferred rosterMatch as the segment label when a
  // check confirmed one (see labelFor in lib/na-scanning.ts), so most
  // segments here already carry an exact roster name string. Use that
  // directly (exact map lookup, no fuzzy scoring needed or wanted) and only
  // fall back to fuzzy matching for segments the model couldn't confidently
  // place against the roster itself.
  const proposedSegments = matchSegmentsToInvitedRoster(scan.segments, rosterResolution.roster).map(
    (seg) => {
      const exact = rosterByName.get(seg.label);
      if (exact) {
        return {
          ...seg,
          matchedInvitedId: exact.invitedId,
          matchedStudentName: exact.fullName,
          matchedProfileId: exact.profileId,
        };
      }
      return seg;
    }
  );

  const { error: updateErr } = await supabase
    .from("na_scan_batches")
    .update({
      status: "segmented",
      proposed_segments: proposedSegments,
      unassigned_pages: [],
      segmented_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  if (updateErr) return failBatch(`Could not save segmentation: ${updateErr.message}`);

  return NextResponse.json({
    chunked: false,
    batchId: batch.id,
    pageCount,
    packetPageCount,
    segments: proposedSegments,
    // Cover-page scanning assigns every page to exactly one student by
    // construction (each runs from its cover to the page before the next),
    // so there is never an unassigned page to report. Kept in the response
    // shape so the client doesn't need a special case.
    unassignedPages: [],
    warnings: scan.warnings,
    pagesChecked: scan.pagesChecked,
    rosterSize: rosterResolution.roster.length,
    rosterIsTrack: rosterResolution.isTrack,
    rosterSourceCourseIds: rosterResolution.sourceCourseIds,
  });
}
