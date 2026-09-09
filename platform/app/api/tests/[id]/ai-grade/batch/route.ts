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
  rematchUnmatchedSegments,
  type ProposedSegment,
  type RosterEntry,
} from "@/lib/ai-grading";
import {
  COVER_PAGE_CHECK_MODEL,
  COVER_PAGE_CHECK_SYSTEM_PROMPT,
  buildCoverPageCheckUserPrompt,
  loadInvitedRoster,
  validateCoverPageCheck,
  type CoverPageCheck,
} from "@/lib/na-scanning";
import { QUICK_READ_MAX_PAGES, segmentByCoverPages } from "@/lib/cover-page-segmentation";
import { chunkFileName, needsChunking, planBatchChunks, type ChunkLimits } from "@/lib/batch-chunking";
import { applyBlankPages, detectBlankPages } from "@/lib/blank-pages";

export const maxDuration = 300;

/**
 * GET /api/tests/[id]/ai-grade/batch
 * Lists batch uploads for this assessment, most recent first — for the
 * "Batch upload" tab to show prior batches and their segmentation status.
 *
 * POST /api/tests/[id]/ai-grade/batch
 * Body: { storagePath: string, fileName?: string, readMode?: "quick" | "deep" }
 *
 * The client uploads the raw PDF directly to Supabase Storage (bucket
 * "exam-scans", path "batches/<uuid>/<fileName>") BEFORE calling this route —
 * a batch scan can run to hundreds of megabytes, far past what a serverless
 * function's request body can carry as JSON. This route receives only the
 * storage path, downloads it server-side, and proposes which pages belong to
 * which student. It does not grade anything and does not split the PDF —
 * see POST .../batch/[batchId]/split for that, which runs only after the
 * teacher confirms the mapping this route proposes.
 *
 * There are two ways of reading the scan, and the body's readMode picks one.
 *
 * "quick" is the DEFAULT, and what a missing or unrecognised readMode means.
 * Every page is checked on its own with the cheap single-page Haiku
 * cover-page check the NA pipeline already uses, and each student runs from
 * their cover page to the page before the next cover
 * (lib/cover-page-segmentation.ts). It defaults because the whole-document
 * read is about a third of what an upload costs (~$1.00 of ~$3.00 on an
 * 84-page scan) while the ordinary pile -- stapled scripts, scanned in
 * order -- only ever poses the question "where does each one start?", which
 * is exactly what a cover-page check answers.
 *
 * "deep" is the original behaviour: the whole PDF goes to SEGMENTATION_MODEL
 * in one vision call, which can attribute a loose sheet to a student whose
 * cover page is pages away. That is what it is for -- unstapled sheets
 * shuffled out of order -- and it stays opt-in because it is also the
 * teacher's "the quick read got a loose sheet wrong" retry.
 *
 * Oversized uploads. A deep read's single whole-document call is bounded by
 * Anthropic's 100-page document limit and 32MB request limit, and a full
 * class of a Grade 9 formative assessment breaks the page limit easily. A
 * quick read sends one page per request, so no byte total can break it and
 * only QUICK_READ_MAX_PAGES applies -- see chunkLimitsFor.
 * Rather than rejecting an upload past its mode's limits, this route cuts it
 * into parts (lib/batch-chunking.ts): each hard boundary is pulled back to the nearest
 * cover page, found with the NA pipeline's cheap single-page Haiku check, so
 * no student's script straddles a part. Each part is written back to
 * Storage next to the original and the response lists them
 * ({ chunked: true, chunks: [...] }); the client then POSTs each part's
 * storagePath to this same route, so every part is segmented, reviewed,
 * split and graded as an ordinary batch. No database row is written for
 * the parent upload — its parts carry "(part i of n, pages a-b)" in their
 * file_name, which is all the linkage the review UI needs.
 */

/**
 * The roster every cover-page name is matched against. Sourced from
 * invited_students, not the students table directly: a class imported via
 * Google Classroom (or added with a manual invite) has a pending
 * invited_students row for every student well before any of them have
 * logged in, while a students enrollment row only exists once they have
 * (see auto_enroll_from_invitations). Every currently-enrolled student
 * still has an invited_students row too (both import paths write one), so
 * this covers exactly the same roster plus the not-yet-registered students
 * a students-only query would silently exclude. Mirrors the NA scanning
 * pipeline's own roster source (lib/na-scanning.ts) -- including its
 * virtual "track course" pooling for grouped classes, and, because a test
 * sits on one class (9G) while the scanned pile mixes every class in the
 * track (9A, 9C, 9G), the sibling classes of that track too. Must match
 * the roster /api/students serves the dropdown, or a name matched here
 * would have no option to land on.
 */
async function loadGradingRoster(supabase: SupabaseClient, courseId: string | null): Promise<RosterEntry[]> {
  if (!courseId) return [];
  const { roster } = await loadInvitedRoster(supabase, courseId, { includeTrackSiblings: true });
  return roster
    .map((r): RosterEntry => ({
      // Registered students resolve straight to their real profile id, so
      // a returning student's batch scan is written the ordinary way.
      // Not-yet-registered students get the composite subject id instead
      // -- see parseGradingSubject.
      profileId: r.profileId ?? `${INVITED_SUBJECT_PREFIX}${r.invitedId}`,
      displayName: r.fullName,
      aliases: r.aliases ?? [],
    }))
    .filter((r) => !!r.displayName);
}

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
      "id, test_id, status, read_mode, source_storage_path, file_name, page_count, proposed_segments, confirmed_segments, unassigned_pages, blank_pages, error, created_at, segmented_at, split_at"
    )
    .eq("test_id", testId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // How many students from each batch have already been paid for -- graded,
  // or with their grading under way. The split route names every per-student
  // scan "...-batch-<batchId>.pdf", so the run's source path is the link.
  // Lets the tab tell a batch whose grading has started (finished with, from
  // this tab's point of view) from one that was split and then lost to a
  // gateway timeout before grading started (still needs doing).
  //
  // 'submitted' and 'running' count alongside 'complete' because the teacher
  // has been charged for those students too. An overnight submission is N
  // 'submitted' runs and no complete ones for hours; counting only 'complete'
  // read that as nobody graded, so lib/batch-restore.ts called the batch
  // unfinished, the tab restored it on the next page load with the amber
  // "most likely the earlier attempt timed out" note, and one click on "Split
  // and grade N student(s)" marked the whole class a SECOND time -- at full
  // price, synchronously, while the first submission was still with Anthropic.
  //
  // The case this query was written for is untouched: a batch split and then
  // lost before any run row existed has no runs in ANY of these statuses, so
  // graded_runs is still 0 and it is still restored. A run that later fails
  // leaves the set too, so a batch whose grading really did die comes back.
  //
  // 'running' is deliberately NOT counted. It looks like it belongs here, but
  // a synchronous run is 'running' only for the seconds its own request is
  // alive, and if that request is killed (a gateway timeout mid-class is the
  // exact case this restore exists for) the row is stranded 'running' with no
  // batch pointer, which nothing sweeps. Counting it would hide the rest of
  // that part's students behind one dead row -- trading a double mark for a
  // silent no-mark. An overnight run is 'submitted' from the moment it is
  // paid for, so the double-billing case is covered without it.
  const { data: runs } = await supabase
    .from("ai_grade_runs")
    .select("source_storage_path")
    .eq("test_id", testId)
    .in("status", ["complete", "submitted"])
    .like("source_storage_path", "%-batch-%.pdf");
  const gradedRunsByBatch = new Map<string, number>();
  for (const r of runs ?? []) {
    const m = /-batch-([0-9a-f-]{36})\.pdf$/.exec(r.source_storage_path ?? "");
    if (m) gradedRunsByBatch.set(m[1], (gradedRunsByBatch.get(m[1]) ?? 0) + 1);
  }

  // Proposals are frozen when a batch is read, so a spelling recorded
  // afterwards (or a student added to the roster since) never reached
  // rows read earlier. Re-match the unmatched ones against today's roster
  // and persist what changed, so the restored panel pre-fills them.
  let rematchRoster: RosterEntry[] = [];
  try {
    const { data: test } = await supabase.from("tests").select("course_id").eq("id", testId).maybeSingle();
    rematchRoster = await loadGradingRoster(supabase, (test?.course_id as string | null) ?? null);
  } catch {
    // A roster failure only means the stored proposals are served as-is.
  }
  const refreshed = await Promise.all(
    (batches ?? []).map(async (b) => {
      const proposals = Array.isArray(b.proposed_segments) ? (b.proposed_segments as ProposedSegment[]) : null;
      if (!proposals || rematchRoster.length === 0 || !["segmented", "split"].includes(b.status as string)) return b;
      const { segments, changed } = rematchUnmatchedSegments(proposals, rematchRoster);
      if (!changed) return b;
      await supabase.from("ai_grade_batches").update({ proposed_segments: segments }).eq("id", b.id);
      return { ...b, proposed_segments: segments };
    })
  );

  return NextResponse.json({
    batches: refreshed.map((b) => ({ ...b, graded_runs: gradedRunsByBatch.get(b.id as string) ?? 0 })),
  });
}

type ReadMode = "quick" | "deep";

/**
 * One page of `sourceDoc` on its own, as base64 PDF bytes. One page per
 * request is what keeps every cover-page check clear of both Anthropic
 * limits -- the 100-page document block and the 32MB request body --
 * whatever the upload's size or the scanner's resolution, which is why a
 * quick read has no byte ceiling at all. The same trick the NA batch route
 * uses for its whole segmentation. Shared by the oversized-upload chunker
 * and the quick read below, which ask about the same page for different
 * reasons.
 */
async function singlePagePdf(sourceDoc: PDFDocument, page: number): Promise<string> {
  const doc = await PDFDocument.create();
  const [copied] = await doc.copyPages(sourceDoc, [page - 1]);
  doc.addPage(copied);
  return Buffer.from(await doc.save()).toString("base64");
}

/**
 * The ceilings a part is planned against. A deep read hands a whole part to
 * the segmentation model in one request, so both of Anthropic's limits bind
 * and the module defaults (MAX_BATCH_PAGES/MAX_SCAN_BYTES) are right. A
 * quick read walks a part one page at a time, so its bytes never reach a
 * request: the only ceiling left is how many single-page checks one upload
 * may fan out into.
 *
 * Dropping the byte ceiling for quick reads is deliberate -- it is most of
 * the point of the mode -- but it does mean a quick-read part is no longer
 * bounded at 32MB, and this route still buffers the whole upload and loads
 * it with pdf-lib. The binding limit is now the function's memory rather
 * than any API limit; if a very large scan ever fails here, that is where
 * to look, not at a rejected request.
 */
function chunkLimitsFor(readMode: ReadMode): ChunkLimits {
  return readMode === "quick"
    ? { maxPages: QUICK_READ_MAX_PAGES, maxBytes: Number.MAX_SAFE_INTEGER }
    : {};
}

/**
 * Cut an upload that is too large for one read into parts, each stored as
 * its own PDF next to the original. See the route comment and
 * lib/batch-chunking.ts for why the cuts land on cover pages.
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
  readMode: ReadMode;
}) {
  const { supabase, anthropic, sourceDoc, buffer, pageCount, storagePath, fileName, rosterNames, readMode } = args;

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
              source: { type: "base64", media_type: "application/pdf", data: await singlePagePdf(sourceDoc, page) },
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

  const plan = await planBatchChunks({
    pageCount,
    byteLength: buffer.length,
    isCoverPage,
    ...chunkLimitsFor(readMode),
  });

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

    // Only a deep read has to fit a whole part into one 32MB request, so
    // only a deep read can be defeated by a part that is still too heavy.
    // A quick read reads the part a page at a time and does not care.
    if (readMode === "deep" && bytes.length > MAX_SCAN_BYTES) {
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

  // No readMode in the response: the client re-posts each part's
  // storagePath with the same readMode it sent for the parent, so every
  // part is read the way the whole upload was asked to be.
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

  let body: { storagePath?: unknown; fileName?: unknown; forceResegment?: unknown; readMode?: unknown };
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

  // Anything that isn't an explicit "deep" reads as quick, so a client that
  // predates the checkbox (or sends nothing at all) gets the cheap read
  // rather than silently paying for the whole-document one.
  const readMode: ReadMode = body.readMode === "deep" ? "deep" : "quick";

  // -- Load the class roster ---------------------------------------------------
  // See loadGradingRoster. Loaded before segmentation because the
  // oversized-upload path also hands the name list to its cover-page checks
  // (constrained recognition against real names beats open-vocabulary
  // handwriting OCR).
  const roster = await loadGradingRoster(supabase, (test.course_id as string | null) ?? null);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // -- Too big for one read: cut into parts -----------------------------------
  // What counts as too big is the mode's, not the file's: a deep read is
  // capped at 100 pages and 32MB because it sends the document in one
  // request, while a quick read only has QUICK_READ_MAX_PAGES to answer to,
  // so a 200-page 60MB scan goes through it whole (see chunkLimitsFor).
  if (needsChunking(pageCount, buffer.length, chunkLimitsFor(readMode))) {
    if (pageCount === 1) {
      // A single page can't be cut any smaller; only a rescan helps. Deep
      // read only reaches this in practice -- one page is never over the
      // quick read's page ceiling, and it has no byte ceiling to breach.
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
        readMode,
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
  //
  // The read_mode filter is asymmetric on purpose. A deep proposal is at
  // least as good as a quick one -- the whole-document read finds every
  // cover page the per-page check does, and the loose sheets it misses --
  // so a quick request may be served either. A deep request may only be
  // served a deep proposal: asking for a deep read IS the teacher's "the
  // quick read got a loose sheet wrong" retry, and handing back the quick
  // proposal it is meant to replace would silently ignore the request.
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  if (body.forceResegment !== true) {
    const { data: prior } = await supabase
      .from("ai_grade_batches")
      .select("id, read_mode, proposed_segments, unassigned_pages, blank_pages")
      .eq("test_id", testId)
      .eq("source_sha256", sourceSha256)
      .in("read_mode", readMode === "deep" ? ["deep"] : ["quick", "deep"])
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
          // The PRIOR's mode, not the requested one: the row records how
          // these segments were actually produced, so a later deep request
          // can tell a copied quick proposal from a deep one.
          read_mode: prior.read_mode,
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
      read_mode: readMode,
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
  // Both reads end at the same place: proposed segments, unassigned pages,
  // the read's own blank-page list and its warnings. Everything below the
  // branch -- the blank-page second look, the row update and the response --
  // is shared, so the two modes differ only in how the mapping is found.
  let proposedSegments: ProposedSegment[];
  let unassignedPages: number[];
  let modelBlankPages: number[];
  let warnings: string[];

  if (readMode === "quick") {
    // -- Quick read: one cover-page check per page ---------------------------
    // The same single-page Haiku call the chunker makes above, but keeping
    // the whole verdict rather than just the boolean: the cover page's name
    // is read in the SAME request as the is-this-a-cover decision, so
    // asking "whose is it?" separately would double the cost of the read.
    const rosterNames = roster.map((r) => r.displayName);
    const checkPage = async (page: number): Promise<CoverPageCheck> => {
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
                source: { type: "base64", media_type: "application/pdf", data: await singlePagePdf(sourceDoc, page) },
              },
              { type: "text", text: buildCoverPageCheckUserPrompt(rosterNames) },
            ],
          },
        ],
      });
      await recordUsage(supabase, {
        pipeline: "ai_grade_cover_page",
        model: COVER_PAGE_CHECK_MODEL,
        usage: message.usage,
        ref: { type: "ai_grade_batch", id: batch.id },
      });
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      const validated = validateCoverPageCheck(text);
      // Throw rather than report "not a cover page": an unreadable answer is
      // no evidence about the page, and swallowing it would fold a student's
      // script silently into the student before them. segmentByCoverPages
      // records the throw as checkFailed and warns about that page instead.
      if (!validated.ok) throw new Error(validated.error);
      return validated.result;
    };

    const plan = await segmentByCoverPages({ pageCount, checkPage });
    if (plan.students.length === 0) {
      return failBatch(
        "No cover pages were found in this scan. Each student's script must start with a cover page bearing their name — tick Deep read to have the whole document read instead.",
        502
      );
    }
    proposedSegments = matchSegmentsToRoster(plan.students, roster);
    unassignedPages = plan.unassignedPages;
    // A quick read has no blank list of its own: every page is claimed by
    // construction (each student runs to the page before the next cover),
    // and the detectBlankPages pass below still covers whatever the plan
    // did leave unassigned.
    modelBlankPages = [];
    warnings = plan.warnings;
  } else {
    // -- Deep read: one whole-document call ----------------------------------
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
    proposedSegments = matchSegmentsToRoster(validation.response.students, roster);
    unassignedPages = [
      ...new Set([
        ...validation.response.unassignedPages,
        ...validation.warnings.flatMap((w) => {
          const m = w.match(/^Page\(s\) (.+) were not mentioned/);
          return m ? m[1].split(", ").map(Number) : [];
        }),
      ]),
    ].sort((a, b) => a - b);
    modelBlankPages = [...validation.response.blankPages].sort((a, b) => a - b);
    warnings = validation.warnings;
  }

  // -- Second look at unassigned pages ---------------------------------------
  // The whole-document read misses blank back pages often enough that a
  // 4-booklet scan came back with all four flagged as unassigned. Each
  // page the model left out gets its own cheap single-page question, and
  // a confident "blank" moves it out of the teacher's way (lib/blank-pages.ts).
  // A quick read leaves almost nothing here to check: it claims every page
  // from a cover to the page before the next one, so the only unassigned
  // pages it can produce are the ones before the FIRST cover. A blank back
  // page mid-script stays with its student, which is the right outcome --
  // it is claimed, so the review UI never asks the teacher about it, and a
  // blank page inside a student's PDF costs nothing at marking time.
  let { blankPages, unassignedPages: stillUnassigned } = applyBlankPages(
    { blankPages: modelBlankPages, unassignedPages },
    []
  );
  if (stillUnassigned.length > 0) {
    const checked = await detectBlankPages({
      anthropic,
      supabase,
      sourceDoc,
      pages: stillUnassigned.slice(0, 20),
      batchId: batch.id,
    });
    ({ blankPages, unassignedPages: stillUnassigned } = applyBlankPages(
      { blankPages, unassignedPages: stillUnassigned },
      checked.filter((c) => c.blank).map((c) => c.page)
    ));
  }

  const { error: updateErr } = await supabase
    .from("ai_grade_batches")
    .update({
      status: "segmented",
      proposed_segments: proposedSegments,
      unassigned_pages: stillUnassigned,
      blank_pages: blankPages,
      segmented_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  if (updateErr) return failBatch(`Could not save segmentation: ${updateErr.message}`);

  return NextResponse.json({
    batchId: batch.id,
    pageCount,
    segments: proposedSegments,
    unassignedPages: stillUnassigned,
    blankPages,
    warnings,
  });
}
