/**
 * One-off: re-run stage 5 assessment over crops that were already
 * assessed, so their feedback is rewritten under the current
 * ASSESSMENT_SYSTEM_PROMPT.
 *
 * Written for the brevity change (marginComment/nextStep cut to one
 * sentence of 15 words or fewer): the stored feedback for every packet
 * predates it and averages 25-37 words, so the prompt change alone does
 * nothing for work already in the database.
 *
 * Deliberately mirrors app/api/na-review/response-crops/[cropId]/assess/
 * route.ts rather than sharing code with it -- same standalone-copy
 * convention the worker follows (see worker/crop.ts's header). What
 * matters is that it keeps the route's central guarantee: ONLY ai_*
 * columns are written. final_*, approved_at and released_at are never
 * touched, so this produces new drafts for teacher review and cannot
 * change a mark or a comment a student has already been shown.
 *
 * Usage (from platform/):
 *   npx tsx scripts/regrade-na-feedback.ts --scan <packetScanId> --dry-run
 *   npx tsx scripts/regrade-na-feedback.ts --status released
 *   npx tsx scripts/regrade-na-feedback.ts --all --concurrency 4
 *
 * Flags:
 *   --crop <id>        one response crop (repeatable) -- for retrying
 *                      the handful a run leaves with a validation error
 *   --scan <id>        one packet scan (repeatable)
 *   --status <status>  every packet scan with this na_packet_scans.status
 *   --all              every packet scan
 *   --limit <n>        stop after n crops (per run, for a pilot)
 *   --concurrency <n>  parallel crops in flight (default 4)
 *   --dry-run          assess and report, write nothing
 *   --not-updated-since <iso>
 *                      skip crops whose feedback was already written at
 *                      or after this timestamp -- i.e. resume a run that
 *                      stopped partway (the first whole-database run died
 *                      when the API credit balance hit zero, 1,338 crops
 *                      short) without paying to redo what succeeded.
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NA_SCAN_BUCKET } from "../lib/na-scanning";
import {
  ASSESSMENT_MODEL,
  ASSESSMENT_SYSTEM_PROMPT,
  WIDE_CONTEXT_SYSTEM_PROMPT,
  buildAssessmentUserPrompt,
  buildWideContextUserPrompt,
  buildRubricBlock,
  isUngradedAnchor,
  validateAssessment,
  type AnchorContext,
} from "../lib/na-assessment";

// ---- args -------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const values = (name: string) => {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
  });
  return out;
};
const value = (name: string) => values(name)[0];

const DRY_RUN = flag("dry-run");
const LIMIT = value("limit") ? Number(value("limit")) : Infinity;
const CONCURRENCY = value("concurrency") ? Number(value("concurrency")) : 4;
const NOT_UPDATED_SINCE = value("not-updated-since");
const CROP_IDS = values("crop");
const SCAN_IDS = values("scan");
const STATUSES = values("status");
const ALL = flag("all");

if (!SCAN_IDS.length && !STATUSES.length && !ALL && !CROP_IDS.length) {
  console.error("Nothing selected. Pass --crop <id>, --scan <id>, --status <status>, or --all.");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.GRADING_ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (or GRADING_ANTHROPIC_API_KEY)."
  );
  process.exit(1);
}

// Service role: this is a trusted backend process, not a teacher session,
// exactly as the worker documents for the same key.
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// maxRetries above the SDK default of 2: this run makes ~1,850 calls and
// the account's actual per-minute rate-limit tier is unverified (see the
// worker README's note on WORKER_CONCURRENCY), so a 429 partway through
// should back off and retry rather than mark a crop failed.
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY, maxRetries: 6 });

// ---- crop selection ---------------------------------------------------

interface AnchorRow {
  qid: string;
  base_qid: string | null;
  marks_available: number | null;
  command_term: string | null;
  answer_sketch: string | null;
  open_rubric: string | null;
  misconception_context: string | null;
  question_text: string | null;
  question_answer: string | null;
  question_marks: number | null;
  page_index: number | null;
  x0_pt: number | null;
  y0_pt: number | null;
  x1_pt: number | null;
  y1_pt: number | null;
}

async function selectScanIds(): Promise<string[]> {
  if (ALL || STATUSES.length) {
    let q = supabase.from("na_packet_scans").select("id, status");
    if (!ALL) q = q.in("status", STATUSES);
    const { data, error } = await q;
    if (error) throw error;
    return [...new Set([...(data ?? []).map((r) => r.id as string), ...SCAN_IDS])];
  }
  return SCAN_IDS;
}

const CROP_SELECT =
  "id, storage_path, is_blank, boundary_expanded, possibly_truncated, packet_scan_id, na_anchors(qid, base_qid, marks_available, command_term, answer_sketch, open_rubric, misconception_context, question_text, question_answer, question_marks, page_index, x0_pt, y0_pt, x1_pt, y1_pt), na_feedback(updated_at)";

async function selectCrops(scanIds: string[]) {
  const rows: Array<{
    id: string;
    storage_path: string;
    is_blank: boolean | null;
    boundary_expanded: boolean | null;
    possibly_truncated: boolean | null;
    packet_scan_id: string;
    na_anchors: AnchorRow | AnchorRow[] | null;
    na_feedback: { updated_at: string | null } | Array<{ updated_at: string | null }> | null;
  }> = [];

  // Paged: a whole-database run is ~2,000 crops, past PostgREST's default
  // 1,000-row ceiling.
  for (const scanId of scanIds) {
    const { data, error } = await supabase
      .from("na_response_crops")
      .select(CROP_SELECT)
      .eq("packet_scan_id", scanId);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as typeof rows));
  }

  if (!NOT_UPDATED_SINCE) return rows;
  const cutoff = Date.parse(NOT_UPDATED_SINCE);
  if (Number.isNaN(cutoff)) {
    console.error(`--not-updated-since is not a parseable timestamp: ${NOT_UPDATED_SINCE}`);
    process.exit(1);
  }
  return rows.filter((r) => {
    const fb = Array.isArray(r.na_feedback) ? r.na_feedback[0] : r.na_feedback;
    if (!fb?.updated_at) return true;
    return Date.parse(fb.updated_at) < cutoff;
  });
}

// ---- one crop ---------------------------------------------------------

const upsertFeedback = async (cropId: string, fields: Record<string, unknown>) => {
  if (DRY_RUN) return;
  const { data: existing } = await supabase
    .from("na_feedback")
    .select("id")
    .eq("crop_id", cropId)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await supabase
      .from("na_feedback")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`Could not update feedback: ${error.message}`);
    return;
  }
  const { error } = await supabase.from("na_feedback").insert({ crop_id: cropId, ...fields });
  if (error) throw new Error(`Could not create feedback: ${error.message}`);
};

async function resolveRedirect(
  ctx: AnchorContext,
  anchor: AnchorRow,
  packetScanId: string
): Promise<ReturnType<typeof validateAssessment> | null> {
  if (!process.env.GRAPH_LAB_CV_SERVICE_URL) return null;
  if (
    anchor.page_index == null ||
    anchor.x0_pt == null ||
    anchor.y0_pt == null ||
    anchor.x1_pt == null ||
    anchor.y1_pt == null
  ) {
    return null;
  }

  const { data: scan } = await supabase
    .from("na_packet_scans")
    .select("split_storage_path")
    .eq("id", packetScanId)
    .maybeSingle();
  if (!scan?.split_storage_path) return null;

  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(NA_SCAN_BUCKET)
    .download(scan.split_storage_path);
  if (dlErr || !pdfFile) return null;
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  const serviceBase = process.env.GRAPH_LAB_CV_SERVICE_URL.trim().replace(/\/$/, "");
  const target = `${/^https?:\/\//i.test(serviceBase) ? serviceBase : `https://${serviceBase}`}/page-image`;
  const cvSecret = process.env.CV_SERVICE_SECRET ?? "";

  let pageImageBase64: string;
  try {
    const res = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(cvSecret ? { "X-CV-Secret": cvSecret } : {}) },
      body: JSON.stringify({
        studentPdfBase64: pdfBase64,
        pageIndex: anchor.page_index,
        rotationHint: 0,
        highlightBox: { x0Pt: anchor.x0_pt, y0Pt: anchor.y0_pt, x1Pt: anchor.x1_pt, y1Pt: anchor.y1_pt },
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { imageBase64?: string };
    if (!body.imageBase64) return null;
    pageImageBase64 = body.imageBase64;
  } catch {
    return null;
  }

  try {
    const message = await anthropic.messages.create({
      model: ASSESSMENT_MODEL,
      max_tokens: 2048,
      system: WIDE_CONTEXT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: pageImageBase64 } },
            { type: "text", text: buildRubricBlock(ctx), cache_control: { type: "ephemeral" } },
            { type: "text", text: buildWideContextUserPrompt() },
          ],
        },
      ],
    });
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const validated = validateAssessment(text, ctx.marksAvailable);
    return validated.ok ? validated : null;
  } catch {
    return null;
  }
}

interface Outcome {
  cropId: string;
  qid: string;
  status: "assessed" | "skipped" | "failed";
  reason?: string;
  before?: { comment: string | null; next: string | null; marks: number | null };
  after?: { comment: string; next: string; marks: number };
}

async function regradeCrop(crop: Awaited<ReturnType<typeof selectCrops>>[number]): Promise<Outcome> {
  const anchor = (Array.isArray(crop.na_anchors) ? crop.na_anchors[0] : crop.na_anchors) as AnchorRow | null;
  if (!anchor) return { cropId: crop.id, qid: "?", status: "failed", reason: "no linked anchor" };

  const ctx: AnchorContext = {
    qid: anchor.qid,
    baseQid: anchor.base_qid ?? anchor.qid,
    marksAvailable: anchor.marks_available,
    commandTerm: anchor.command_term,
    answerSketch: anchor.answer_sketch,
    openRubric: anchor.open_rubric,
    misconceptionContext: anchor.misconception_context,
    questionText: anchor.question_text,
    questionAnswer: anchor.question_answer,
    questionMarks: anchor.question_marks,
    boundaryExpanded: crop.boundary_expanded ?? undefined,
    possiblyTruncated: crop.possibly_truncated ?? undefined,
  };

  const { data: priorRow } = await supabase
    .from("na_feedback")
    .select("ai_margin_comment, ai_next_step, ai_marks_awarded")
    .eq("crop_id", crop.id)
    .maybeSingle();
  const before = {
    comment: priorRow?.ai_margin_comment ?? null,
    next: priorRow?.ai_next_step ?? null,
    marks: priorRow?.ai_marks_awarded ?? null,
  };

  // Same two no-API-call skip paths as the route, and for the same
  // reason -- a regrade must not turn an ungraded thinking space or a
  // blank box into a marked answer.
  if (isUngradedAnchor(ctx)) {
    await upsertFeedback(crop.id, {
      ai_attempted: false,
      ai_teacher_note:
        "Not marked: this box is an ungraded thinking space (no marks, no answer key, no rubric).",
    });
    return { cropId: crop.id, qid: ctx.qid, status: "skipped", reason: "ungraded anchor", before };
  }
  if (crop.is_blank) {
    await upsertFeedback(crop.id, {
      ai_attempted: false,
      ai_marks_available: ctx.marksAvailable,
      ai_teacher_note: "Not marked: crop detected as blank in stage 4 (no ink found in the answer box).",
    });
    return { cropId: crop.id, qid: ctx.qid, status: "skipped", reason: "blank crop", before };
  }

  let imageBase64: string;
  try {
    const { data: file, error: dlErr } = await supabase.storage
      .from(NA_SCAN_BUCKET)
      .download(crop.storage_path);
    if (dlErr || !file) throw new Error(dlErr?.message ?? "crop image not found in storage");
    imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  } catch (e) {
    return {
      cropId: crop.id,
      qid: ctx.qid,
      status: "failed",
      reason: `crop image: ${e instanceof Error ? e.message : String(e)}`,
      before,
    };
  }

  const message = await anthropic.messages.create({
    model: ASSESSMENT_MODEL,
    max_tokens: 2048,
    system: ASSESSMENT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
          { type: "text", text: buildRubricBlock(ctx), cache_control: { type: "ephemeral" } },
          { type: "text", text: buildAssessmentUserPrompt() },
        ],
      },
    ],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const validated = validateAssessment(text, ctx.marksAvailable);
  if (!validated.ok) {
    await upsertFeedback(crop.id, {
      ai_attempted: true,
      ai_marks_available: ctx.marksAvailable,
      ai_validation_error: validated.error,
      ai_raw_response: { rawText: text.slice(0, 4000) },
    });
    return { cropId: crop.id, qid: ctx.qid, status: "failed", reason: validated.error, before };
  }

  let a = validated.assessment;
  let warnings = validated.warnings;
  if (a.redirectedElsewhere) {
    const resolved = await resolveRedirect(ctx, anchor, crop.packet_scan_id);
    if (resolved?.ok) {
      a = resolved.assessment;
      warnings = resolved.warnings;
    } else {
      warnings = [
        ...warnings,
        "An arrow crossing this answer box was detected, meaning the student's real work for this question is elsewhere on the page, but the wider-page re-check could not resolve it -- a teacher should check the original page for where that work was written.",
      ];
    }
  }

  await upsertFeedback(crop.id, {
    ai_attempted: true,
    ai_student_attempted: a.studentAttempted,
    ai_transcription: a.transcription,
    ai_verdict: a.verdict,
    ai_marks_awarded: a.marksAwarded,
    ai_marks_available: ctx.marksAvailable,
    ai_misconception_tags: a.misconceptionTags,
    ai_margin_comment: a.marginComment,
    ai_next_step: a.nextStep,
    ai_confidence: a.confidence,
    ai_teacher_note: [a.teacherNote, ...warnings].filter(Boolean).join(" | "),
    ai_validation_error: null,
    ai_raw_response: a as unknown as Record<string, unknown>,
  });

  return {
    cropId: crop.id,
    qid: ctx.qid,
    status: "assessed",
    before,
    after: { comment: a.marginComment, next: a.nextStep, marks: a.marksAwarded },
  };
}

// ---- run --------------------------------------------------------------

const words = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? 0 : t.split(/\s+/).length;
};

async function main() {
  let scanIds: string[] = [];
  let allCrops: Awaited<ReturnType<typeof selectCrops>>;
  if (CROP_IDS.length) {
    const { data, error } = await supabase.from("na_response_crops").select(CROP_SELECT).in("id", CROP_IDS);
    if (error) throw error;
    allCrops = (data ?? []) as unknown as typeof allCrops;
    scanIds = [...new Set(allCrops.map((c) => c.packet_scan_id))];
  } else {
    scanIds = await selectScanIds();
    allCrops = await selectCrops(scanIds);
  }
  const crops = allCrops.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log(
    `${DRY_RUN ? "DRY RUN: " : ""}${allCrops.length} crop(s) selected across ${scanIds.length} packet scan(s)` +
      `${crops.length !== allCrops.length ? `, ${crops.length} after --limit` : ""}, concurrency ${CONCURRENCY}`
  );
  if (crops.length === 0) return;

  const outcomes: Outcome[] = [];
  let cursor = 0;
  let done = 0;

  const runner = async () => {
    while (cursor < crops.length) {
      const crop = crops[cursor++];
      try {
        const outcome = await regradeCrop(crop);
        outcomes.push(outcome);
      } catch (e) {
        outcomes.push({
          cropId: crop.id,
          qid: "?",
          status: "failed",
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      done++;
      if (done % 20 === 0 || done === crops.length) {
        console.log(`  ${done}/${crops.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, crops.length) }, runner));

  const assessed = outcomes.filter((o) => o.status === "assessed");
  const failed = outcomes.filter((o) => o.status === "failed");
  const skipped = outcomes.filter((o) => o.status === "skipped");
  const marksChanged = assessed.filter(
    (o) => o.before?.marks != null && o.after && o.before.marks !== o.after.marks
  );

  const avg = (ns: number[]) => (ns.length ? (ns.reduce((s, n) => s + n, 0) / ns.length).toFixed(1) : "0");
  console.log("");
  console.log(`assessed ${assessed.length}, skipped ${skipped.length}, failed ${failed.length}`);
  console.log(
    `margin comment words: ${avg(assessed.map((o) => words(o.before?.comment)))} -> ${avg(assessed.map((o) => words(o.after?.comment)))}`
  );
  console.log(
    `next step words:      ${avg(assessed.map((o) => words(o.before?.next)))} -> ${avg(assessed.map((o) => words(o.after?.next)))}`
  );
  console.log(`marks changed on ${marksChanged.length} of ${assessed.length} assessed crops`);
  for (const o of marksChanged) {
    console.log(`  ${o.qid} (${o.cropId}): ${o.before?.marks} -> ${o.after?.marks}`);
  }
  for (const o of failed) console.log(`  FAILED ${o.qid} (${o.cropId}): ${o.reason}`);

  if (DRY_RUN) {
    console.log("\n-- samples --");
    for (const o of assessed.slice(0, 8)) {
      console.log(`\n[${o.qid}]`);
      console.log(`  before: ${o.before?.comment ?? "(none)"}`);
      console.log(`  after:  ${o.after?.comment}`);
      console.log(`  before next: ${o.before?.next ?? "(none)"}`);
      console.log(`  after next:  ${o.after?.next}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
