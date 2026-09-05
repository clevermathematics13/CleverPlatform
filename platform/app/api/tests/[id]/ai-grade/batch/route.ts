import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  SCAN_BUCKET,
  SEGMENTATION_MODEL,
  SEGMENTATION_SYSTEM_PROMPT,
  SegmentationResponseSchema,
  MAX_SCAN_BYTES,
  INVITED_SUBJECT_PREFIX,
  buildSegmentationUserPrompt,
  validateSegmentationResponse,
  matchSegmentsToRoster,
  type RosterEntry,
} from "@/lib/ai-grading";
import {
  COVER_PAGE_CHECK_MODEL,
  COVER_PAGE_CHECK_SYSTEM_PROMPT,
  buildCoverPageCheckUserPrompt,
  loadInvitedRoster,
  validateCoverPageCheck,
} from "@/lib/na-scanning";
import { chunkFileName, needsChunking, planBatchChunks } from "@/lib/batch-chunking";

export const maxDuration = 300;

/**
 * GET /api/tests/[id]/ai-grade/batch
 * Lists batch uploads for this assessment, most recent first — for the
 * "Batch upload" tab to show prior batches and their segmentation status.
 *
 * POST /api/tests/[id]/ai-grade/batch
 * Body: { storagePath: string, fileName?: string }
 *
 * The client uploads the raw PDF directly to Supabase Storage (bucket
 * "exam-scans", path "batches/<uuid>/<fileName>") BEFORE calling this route —
 * a batch scan can run to hundreds of megabytes, far past what a serverless
 * function's request body can carry as JSON. This route receives only the
 * storage path, downloads it server-side, and runs one segmentation pass:
 * a single vision call over the whole document proposing which pages belong
 * to which student. It does not grade anything and does not split the PDF —
 * see POST .../batch/[batchId]/split for that, which runs only after the
 * teacher confirms the mapping this route proposes.
 *
 * Oversized uploads. That single whole-document call is bounded by
 * Anthropic's 100-page document limit and 32MB request limit, and a full
 * class of a Grade 9 formative assessment breaks the page limit easily.
 * Rather than rejecting such an upload, this route cuts it into parts
 * (lib/batch-chunking.ts): each hard boundary is pulled back to the nearest
 * cover page, found with the NA pipeline's cheap single-page Haiku check, so
 * no student's script straddles a part. Each part is written back to
 * Storage next to the original and the response lists them
 * ({ chunked: true, chunks: [...] }); the client then POSTs each part's
 * storagePath to this same route, so every part is segmented, reviewed,
 * split and graded as an ordinary batch. No database row is written for
 * the parent upload — its parts carry "(part i of n, pages a-b)" in their
 * file_name, which is all the linkage the review UI needs.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  // 100, not 20: a class set arrives as three files cut into 27 parts, and
  // the Batch upload tab restores every unfinished part from this list
  // after a page reload (lib/batch-restore.ts). A limit that only covered
  // the newest few would silently drop the rest.
  const { data: batches, error } = await supabase
    .from("ai_grade_batches")
    .select(
      "id, test_id, status, source_storage_path, file_name, page_count, proposed_segments, confirmed_segments, unassigned_pages, blank_pages, error, created_at, segmented_at, split_at"
    )
    .eq("test_id", testId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // How many students from each batch have a completed grading run. The
  // split route names every per-student scan "...-batch-<batchId>.pdf", so
  // the run's source path is the link. Lets the tab tell a batch that was
  // split and graded (finished) from one that was split and then lost to a
  // gateway timeout before grading started (still needs doing).
  const { data: runs } = await supabase
    .from("ai_grade_runs")
    .select("source_storage_path")
    .eq("test_id", testId)
    .eq("status", "complete")
    .like("source_storage_path", "%-batch-%.pdf");
  const gradedRunsByBatch = new Map<string, number>();
  for (const r of runs ?? []) {
    const m = /-batch-([0-9a-f-]{36})\.pdf$/.exec(r.source_storage_path ?? "");
    if (m) gradedRunsByBatch.set(m[1], (gradedRunsByBatch.get(m[1]) ?? 0) + 1);
  }

  return NextResponse.json({
    batches: (batches ?? []).map((b) => ({ ...b, graded_runs: gradedRunsByBatch.get(b.id as string) ?? 0 })),
  });
}

/**
 * Cut an upload that is too large for one segmentation call into parts,
 * each stored as its own PDF next to the original. See the route comment
 * and lib/batch-chunking.ts for why the cuts land on cover pages.
 */
async function chunkOversizedUpload(args: {
  supabase: SupabaseClient;
  anthropic: Anthropic;
  sourceDoc: PDFDocument;
  buffer: Buffer;
  pageCount: number;
  storagePath: string;
  fileName: string;
  rosterNames: string[];
}) {
  const { supabase, anthropic, sourceDoc, buffer, pageCount, storagePath, fileName, rosterNames } = args;

  // One page as its own PDF, so the check is never near either limit
  // whatever the upload's size or scan resolution -- the same trick the
  // NA batch route uses for its whole segmentation.
  const singlePagePdf = async (page: number): Promise<string> => {
    const doc = await PDFDocument.create();
    const [copied] = await doc.copyPages(sourceDoc, [page - 1]);
    doc.addPage(copied);
    return Buffer.from(await doc.save()).toString("base64");
  };

  const isCoverPage = async (page: number): Promise<boolean> => {
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
              source: { type: "base64", media_type: "application/pdf", data: await singlePagePdf(page) },
            },
            { type: "text", text: buildCoverPageCheckUserPrompt(rosterNames) },
          ],
        },
      ],
    });
    // No batch row exists yet for the parent upload (its parts get their
    // own rows when they are segmented), so the usage has no ref.
    await recordUsage(supabase, {
      pipeline: "ai_grade_chunk_cover",
      model: COVER_PAGE_CHECK_MODEL,
      usage: message.usage,
    });
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const validated = validateCoverPageCheck(text);
    return validated.ok && validated.result.isCoverPage;
  };

  const plan = await planBatchChunks({ pageCount, byteLength: buffer.length, isCoverPage });

  const folder = storagePath.slice(0, storagePath.lastIndexOf("/"));
  const chunks: {
    index: number;
    count: number;
    storagePath: string;
    fileName: string;
    firstPage: number;
    lastPage: number;
    pageCount: number;
    cleanCutAfter: boolean;
  }[] = [];

  for (const chunk of plan.chunks) {
    const doc = await PDFDocument.create();
    // Fixed metadata dates so re-uploading the same scan produces
    // byte-identical parts, which lets the per-part sha256 dedupe below
    // skip the expensive Opus call the second time round.
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    const indices = Array.from({ length: chunk.pageCount }, (_, i) => chunk.firstPage - 1 + i);
    const copied = await doc.copyPages(sourceDoc, indices);
    for (const page of copied) doc.addPage(page);
    const bytes = Buffer.from(await doc.save());

    if (bytes.length > MAX_SCAN_BYTES) {
      return NextResponse.json(
        {
          error: `Part ${chunk.index + 1} (pages ${chunk.firstPage}-${chunk.lastPage}) is still ${(bytes.length / 1024 / 1024).toFixed(1)}MB after splitting, past the 32MB request limit. Rescan at a lower resolution (or in grayscale/black-and-white) and upload again.`,
        },
        { status: 400 }
      );
    }

    const chunkPath = `${folder}/part-${chunk.index + 1}-of-${plan.chunks.length}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .upload(chunkPath, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) {
      return NextResponse.json(
        { error: `Could not store part ${chunk.index + 1} of the scan: ${uploadErr.message}` },
        { status: 500 }
      );
    }

    chunks.push({
      index: chunk.index,
      count: plan.chunks.length,
      storagePath: chunkPath,
      fileName: chunkFileName(fileName, chunk, plan.chunks.length),
      firstPage: chunk.firstPage,
      lastPage: chunk.lastPage,
      pageCount: chunk.pageCount,
      cleanCutAfter: chunk.cleanCutAfter,
    });
  }

  return NextResponse.json({
    chunked: true,
    pageCount,
    chunks,
    warnings: plan.warnings,
    pagesChecked: plan.pagesChecked,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: testId } = await params;

  let body: { storagePath?: unknown; fileName?: unknown; forceResegment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
  if (!storagePath) {
    return NextResponse.json({ error: "storagePath is required" }, { status: 400 });
  }
  // The client must have uploaded under batches/ — guards against pointing
  // this route at an unrelated object in the same bucket.
  if (!storagePath.startsWith("batches/")) {
    return NextResponse.json(
      { error: 'storagePath must be under "batches/" — upload via the batch flow, not directly' },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
      { status: 500 }
    );
  }

  const { data: test, error: testErr } = await supabase
    .from("tests")
    .select("id, name, course_id")
    .eq("id", testId)
    .maybeSingle();
  if (testErr) return NextResponse.json({ error: testErr.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });

  // -- Download the uploaded batch PDF ---------------------------------------
  const { data: file, error: dlErr } = await supabase.storage.from(SCAN_BUCKET).download(storagePath);
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
  if (pageCount < 1) {
    return NextResponse.json({ error: "The uploaded PDF has no pages" }, { status: 400 });
  }

  const fileName =
    typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "batch-scan.pdf";

  // -- Load the class roster ---------------------------------------------------
  // Sourced from invited_students, not the students table directly: a class
  // imported via Google Classroom (or added with a manual invite) has a
  // pending invited_students row for every student well before any of them
  // have logged in, while a students enrollment row only exists once they
  // have (see auto_enroll_from_invitations). Every currently-enrolled
  // student still has an invited_students row too (both import paths write
  // one), so this covers exactly the same roster plus the not-yet-registered
  // students the old students-only query silently excluded. Mirrors the NA
  // scanning pipeline's own roster source (lib/na-scanning.ts) — including
  // its virtual "track course" pooling for grouped classes, and, because a
  // test sits on one class (9G) while the scanned pile mixes every class in
  // the track (9A, 9C, 9G), the sibling classes of that track too. Must
  // match the roster /api/students serves the dropdown, or a name matched
  // here would have no option to land on.
  //
  // Loaded before segmentation because the oversized-upload path also
  // hands the name list to its cover-page checks (constrained recognition
  // against real names beats open-vocabulary handwriting OCR).
  let roster: RosterEntry[] = [];
  if (test.course_id) {
    const { roster: invitedRoster } = await loadInvitedRoster(supabase, test.course_id, {
      includeTrackSiblings: true,
    });
    roster = invitedRoster
      .map((r) => ({
        // Registered students resolve straight to their real profile id, so
        // a returning student's batch scan is written the ordinary way.
        // Not-yet-registered students get the composite subject id instead
        // — see parseGradingSubject.
        profileId: r.profileId ?? `${INVITED_SUBJECT_PREFIX}${r.invitedId}`,
        displayName: r.fullName,
      }))
      .filter((r): r is RosterEntry => !!r.displayName);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // -- Too big for one segmentation call: cut into parts ----------------------
  if (needsChunking(pageCount, buffer.length)) {
    if (pageCount === 1) {
      // A single page can't be cut any smaller; only a rescan helps.
      return NextResponse.json(
        {
          error: `This scan is ${(buffer.length / 1024 / 1024).toFixed(1)}MB for a single page; Anthropic's API caps a request at 32MB. Rescan at a lower resolution (or in grayscale/black-and-white).`,
        },
        { status: 400 }
      );
    }
    try {
      return await chunkOversizedUpload({
        supabase,
        anthropic,
        sourceDoc,
        buffer,
        pageCount,
        storagePath,
        fileName,
        rosterNames: roster.map((r) => r.displayName),
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Could not split this ${pageCount}-page scan into parts: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 }
      );
    }
  }

  // -- Reuse an identical earlier upload's segmentation -----------------------
  // The same batch PDF gets uploaded more than once in practice (one class
  // scan was uploaded 14 times while the grading flow was being worked out),
  // and every upload used to pay for a fresh whole-document Opus call --
  // by far the most expensive single request in the app. Byte-identical
  // file, same test: the page-to-student mapping cannot differ, so copy the
  // earlier proposal onto the new batch row and skip the model. The teacher
  // still confirms the mapping before anything is split or graded, exactly
  // as for a fresh proposal. forceResegment: true opts out.
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  if (body.forceResegment !== true) {
    const { data: prior } = await supabase
      .from("ai_grade_batches")
      .select("id, proposed_segments, unassigned_pages, blank_pages")
      .eq("test_id", testId)
      .eq("source_sha256", sourceSha256)
      .in("status", ["segmented", "split"])
      .not("proposed_segments", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prior) {
      const unassignedPages = (prior.unassigned_pages as number[] | null) ?? [];
      const blankPages = (prior.blank_pages as number[] | null) ?? [];
      const { data: reused, error: reuseErr } = await supabase
        .from("ai_grade_batches")
        .insert({
          test_id: testId,
          created_by: user.id,
          status: "segmented",
          source_storage_path: storagePath,
          file_name: fileName,
          page_count: pageCount,
          source_sha256: sourceSha256,
          proposed_segments: prior.proposed_segments,
          unassigned_pages: unassignedPages,
          blank_pages: blankPages,
          segmented_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (reuseErr || !reused) {
        return NextResponse.json(
          { error: `Could not create batch record: ${reuseErr?.message ?? "unknown error"}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        batchId: reused.id,
        pageCount,
        segments: prior.proposed_segments,
        unassignedPages,
        blankPages,
        warnings: [
          "This PDF was uploaded before, so its page-to-student mapping was reused instead of being read again. Send forceResegment: true to re-run the model.",
        ],
        reusedFromBatchId: prior.id,
      });
    }
  }

  // -- Open the batch row ------------------------------------------------------
  const { data: batch, error: insertErr } = await supabase
    .from("ai_grade_batches")
    .insert({
      test_id: testId,
      created_by: user.id,
      status: "segmenting",
      source_storage_path: storagePath,
      file_name: fileName,
      page_count: pageCount,
      source_sha256: sourceSha256,
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
    await supabase.from("ai_grade_batches").update({ status: "failed", error: message }).eq("id", batch.id);
    return NextResponse.json({ error: message, batchId: batch.id }, { status });
  };

  // -- Segment ------------------------------------------------------------------
  // Structured output (the same zod schema the validator uses) plus one
  // retry on a malformed/invalid response -- same shape as the grading
  // route. A whole-batch call is the most expensive request in the app, so a
  // second attempt is still far cheaper than a teacher re-uploading.
  const segmentationRequest: Anthropic.MessageCreateParamsNonStreaming = {
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
  };

  let validation: ReturnType<typeof validateSegmentationResponse> | null = null;
  let lastError = "Model returned an empty segmentation response";
  for (let attempt = 1; attempt <= 2 && !validation; attempt++) {
    let responseText: string;
    try {
      const message = await anthropic.messages.parse({
        ...segmentationRequest,
        output_config: { format: zodOutputFormat(SegmentationResponseSchema) },
      });
      await recordUsage(supabase, {
        pipeline: "ai_grade_segment",
        model: SEGMENTATION_MODEL,
        usage: message.usage,
        ref: { type: "ai_grade_batch", id: batch.id },
      });
      if (message.stop_reason === "max_tokens") {
        lastError = "Model response was cut off at max_tokens";
        continue;
      }
      responseText = message.parsed_output
        ? JSON.stringify(message.parsed_output)
        : message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    } catch (e) {
      return failBatch(`Segmentation request failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!responseText.trim()) {
      lastError = "Model returned an empty segmentation response";
      continue;
    }
    const attemptValidation = validateSegmentationResponse(responseText, pageCount);
    if (attemptValidation.ok) validation = attemptValidation;
    else lastError = attemptValidation.error;
  }
  if (!validation || !validation.ok) return failBatch(lastError, 502);

  // -- Match against the class roster --------------------------------------
  const proposedSegments = matchSegmentsToRoster(validation.response.students, roster);
  const unassignedPages = [
    ...new Set([
      ...validation.response.unassignedPages,
      ...validation.warnings.flatMap((w) => {
        const m = w.match(/^Page\(s\) (.+) were not mentioned/);
        return m ? m[1].split(", ").map(Number) : [];
      }),
    ]),
  ].sort((a, b) => a - b);
  const blankPages = [...validation.response.blankPages].sort((a, b) => a - b);

  const { error: updateErr } = await supabase
    .from("ai_grade_batches")
    .update({
      status: "segmented",
      proposed_segments: proposedSegments,
      unassigned_pages: unassignedPages,
      blank_pages: blankPages,
      segmented_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  if (updateErr) return failBatch(`Could not save segmentation: ${updateErr.message}`);

  return NextResponse.json({
    batchId: batch.id,
    pageCount,
    segments: proposedSegments,
    unassignedPages,
    blankPages,
    warnings: validation.warnings,
  });
}
