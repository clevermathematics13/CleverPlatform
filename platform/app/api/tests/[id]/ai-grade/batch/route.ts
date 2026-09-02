import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  SCAN_BUCKET,
  SEGMENTATION_MODEL,
  SEGMENTATION_SYSTEM_PROMPT,
  MAX_BATCH_PAGES,
  MAX_SCAN_BYTES,
  buildSegmentationUserPrompt,
  validateSegmentationResponse,
  matchSegmentsToRoster,
  type RosterEntry,
} from "@/lib/ai-grading";

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
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const { data: batches, error } = await supabase
    .from("ai_grade_batches")
    .select(
      "id, test_id, status, source_storage_path, file_name, page_count, proposed_segments, confirmed_segments, unassigned_pages, error, created_at, segmented_at, split_at"
    )
    .eq("test_id", testId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batches: batches ?? [] });
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
  if (buffer.length > MAX_SCAN_BYTES) {
    return NextResponse.json(
      {
        error: `This batch scan is ${(buffer.length / 1024 / 1024).toFixed(1)}MB; Anthropic's API caps a single request at 32MB regardless of page count. Rescan at a lower resolution (or in grayscale/black-and-white) or split the class into two smaller batches.`,
      },
      { status: 400 }
    );
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
      .select("id, proposed_segments, unassigned_pages")
      .eq("test_id", testId)
      .eq("source_sha256", sourceSha256)
      .in("status", ["segmented", "split"])
      .not("proposed_segments", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prior) {
      const unassignedPages = (prior.unassigned_pages as number[] | null) ?? [];
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
    await recordUsage(supabase, {
      pipeline: "ai_grade_segment",
      model: SEGMENTATION_MODEL,
      usage: message.usage,
      ref: { type: "ai_grade_batch", id: batch.id },
    });
  } catch (e) {
    return failBatch(`Segmentation request failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!responseText.trim()) return failBatch("Model returned an empty segmentation response");

  const validation = validateSegmentationResponse(responseText, pageCount);
  if (!validation.ok) return failBatch(validation.error, 502);

  // -- Match against the class roster --------------------------------------
  let roster: RosterEntry[] = [];
  if (test.course_id) {
    const { data: studentRows } = await supabase
      .from("students")
      .select("profile_id, profiles:profile_id(display_name, nickname)")
      .eq("course_id", test.course_id)
      .eq("hidden", false);

    roster = (studentRows ?? [])
      .map((s) => {
        const profile = s.profiles as unknown as { display_name: string; nickname: string | null } | null;
        // Full name, not nickname: matchSegmentsToRoster needs the surname
        // to resolve cover-page reads where the OCR'd first name is badly
        // garbled but the last name is still recognisable (or vice versa).
        // A nickname-only roster entry silently drops that signal.
        return {
          profileId: s.profile_id as string,
          displayName: profile?.display_name || profile?.nickname || "",
        };
      })
      .filter((r): r is RosterEntry => !!r.displayName);
  }

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

  const { error: updateErr } = await supabase
    .from("ai_grade_batches")
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
  });
}
