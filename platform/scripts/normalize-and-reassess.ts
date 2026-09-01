/**
 * One-shot data migration for the 1 Sep 2026 scan-geometry incident
 * (HANDOFF §5): uploads normalized split PDFs, repoints
 * na_packet_scans.split_storage_path, re-runs stage 4 (crop) against the
 * canonical anchors, regenerates the affected prompt crops, and re-runs
 * stage 5 (assess, ai_* only) on every regenerated crop.
 *
 * Inputs: the transforms.json + normalized/ directory produced by
 * scripts/scan_geometry/normalize.py (see its README), passed via
 * --transforms. Scans without a normalized PDF get only the anchors whose
 * geometry changed on 1 Sep (Q1, Q2, Q5, Q9, Q17) re-cropped; normalized
 * scans get all 40.
 *
 * Mirrors packet-scans/[id]/crop/route.ts and
 * response-crops/[id]/assess/route.ts exactly; writes ai_* only -- final_*,
 * approved_*, released_at are never touched. Resumable: each phase records
 * progress in <transforms dir>/progress.json and skips completed work.
 *
 * Run: cd platform && npx tsx scripts/normalize-and-reassess.ts \
 *        --transforms /path/to/transforms.json [--phase upload|crop|assess|prompts|all]
 * Env: SUPABASE_SERVICE_ROLE_KEY, GRAPH_LAB_CV_SERVICE_URL, CV_SERVICE_SECRET,
 *      GRADING_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  ASSESSMENT_MODEL,
  ASSESSMENT_SYSTEM_PROMPT,
  buildAssessmentUserPrompt,
  buildRubricBlock,
  isUngradedAnchor,
  validateAssessment,
  type AnchorContext,
} from "../lib/na-assessment";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic({ apiKey: process.env.GRADING_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY! });
const CV_URL = process.env.GRAPH_LAB_CV_SERVICE_URL!.trim().replace(/\/$/, "");
const CV_SECRET = process.env.CV_SERVICE_SECRET ?? "";
const BUCKET = "exam-scans";
const PACKET_VERSION_ID = "1462a2f2-fc2a-4bab-8135-ed3aefeb0aff";
/** Anchors whose geometry changed on 1 Sep -- aligned scans re-crop only these. */
const CHANGED_QIDS = new Set(["Q1", "Q2", "Q5", "Q9", "Q17"]);
/** Prompt crops to regenerate: their band start (previous anchor's y1) moved. */
const PROMPT_REGEN_QIDS = new Set(["Q1", "Q3", "Q6", "Q10"]);
const ASSESS_CONCURRENCY = 5;

const args = process.argv.slice(2);
function argOf(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const transformsPath = argOf("--transforms");
if (!transformsPath) {
  console.error("--transforms <path to transforms.json> is required");
  process.exit(1);
}
const phase = argOf("--phase") ?? "all";
const baseDir = dirname(resolve(transformsPath));
const progressPath = join(baseDir, "progress.json");

type Transforms = Record<string, { student?: string; path?: string; normalized_local?: string; needs_norm: boolean }>;
const transforms: Transforms = JSON.parse(readFileSync(transformsPath, "utf8"));
type Progress = { uploaded: string[]; cropped: string[]; assessed: string[]; prompts: string[] };
const progress: Progress = existsSync(progressPath)
  ? JSON.parse(readFileSync(progressPath, "utf8"))
  : { uploaded: [], cropped: [], assessed: [], prompts: [] };
const saveProgress = () => writeFileSync(progressPath, JSON.stringify(progress, null, 1));

type AnchorRow = {
  id: string; qid: string; base_qid: string | null; page_index: number;
  x0_pt: number; y0_pt: number; x1_pt: number; y1_pt: number;
  expand_max_x1_pt: number | null; expand_max_y1_pt: number | null;
  marks_available: number | null; command_term: string | null; answer_sketch: string | null;
  open_rubric: string | null; misconception_context: string | null;
  question_text: string | null; question_answer: string | null; question_marks: number | null;
  sort_order: number;
};

async function loadAnchors(): Promise<AnchorRow[]> {
  const { data, error } = await supabase
    .from("na_anchors")
    .select("id, qid, base_qid, page_index, x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt, marks_available, command_term, answer_sketch, open_rubric, misconception_context, question_text, question_answer, question_marks, sort_order")
    .eq("packet_version_id", PACKET_VERSION_ID)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data as AnchorRow[];
}

async function uploadPhase() {
  for (const [scanId, t] of Object.entries(transforms)) {
    if (!t.normalized_local || progress.uploaded.includes(scanId)) continue;
    const { data: scan, error } = await supabase
      .from("na_packet_scans").select("id, split_storage_path").eq("id", scanId).single();
    if (error || !scan?.split_storage_path) { console.error(`upload SKIP ${scanId}: ${error?.message}`); continue; }
    const normPath = scan.split_storage_path.replace(/\.pdf$/, "") + `-normalized.pdf`;
    const bytes = readFileSync(join(baseDir, t.normalized_local));
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(normPath, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) { console.error(`upload FAIL ${scanId}: ${upErr.message}`); continue; }
    // Original stays at its old path untouched; only the pointer moves.
    const { error: updErr } = await supabase.from("na_packet_scans").update({ split_storage_path: normPath }).eq("id", scanId);
    if (updErr) { console.error(`repoint FAIL ${scanId}: ${updErr.message}`); continue; }
    progress.uploaded.push(scanId); saveProgress();
    console.log(`uploaded+repointed ${t.student ?? scanId} (${(bytes.length / 1e6).toFixed(1)}MB)`);
  }
}

async function cropScan(scanId: string, anchors: AnchorRow[], full: boolean): Promise<string[]> {
  const subset = full ? anchors : anchors.filter((a) => CHANGED_QIDS.has(a.qid));
  const { data: scan, error } = await supabase
    .from("na_packet_scans").select("id, split_storage_path").eq("id", scanId).single();
  if (error || !scan?.split_storage_path) throw new Error(`scan load: ${error?.message}`);
  const { data: pdfFile, error: dlErr } = await supabase.storage.from(BUCKET).download(scan.split_storage_path);
  if (dlErr || !pdfFile) throw new Error(`pdf download: ${dlErr?.message}`);
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  const res = await fetch(`${CV_URL}/crop`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(CV_SECRET ? { "X-CV-Secret": CV_SECRET } : {}) },
    body: JSON.stringify({
      studentPdfBase64: pdfBase64,
      expectedPageCount: 26,
      rotationHint: 0,
      anchors: subset.map((a) => ({
        qid: a.qid, pageIndex: a.page_index,
        x0Pt: Number(a.x0_pt), y0Pt: Number(a.y0_pt), x1Pt: Number(a.x1_pt), y1Pt: Number(a.y1_pt),
        expandMaxX1Pt: a.expand_max_x1_pt == null ? null : Number(a.expand_max_x1_pt),
        expandMaxY1Pt: a.expand_max_y1_pt == null ? null : Number(a.expand_max_y1_pt),
      })),
    }),
  });
  if (!res.ok) throw new Error(`CV crop HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const cv = (await res.json()) as { pageCountMismatch: number | null; crops: { qid: string; imageBase64: string; expanded: boolean; possiblyTruncated: boolean }[] };
  if (cv.pageCountMismatch !== null) throw new Error(`pageCountMismatch=${cv.pageCountMismatch}`);

  const byQid = new Map(subset.map((a) => [a.qid, a]));
  const croppedIds: string[] = [];
  for (const crop of cv.crops) {
    const anchor = byQid.get(crop.qid);
    if (!anchor || !crop.imageBase64) { console.error(`  no image for ${crop.qid}`); continue; }
    const imageBytes = Buffer.from(crop.imageBase64, "base64");
    const storagePath = `na-crops/${PACKET_VERSION_ID}/${scanId}/${anchor.id}.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, imageBytes, { contentType: "image/png", upsert: true });
    if (upErr) { console.error(`  upload ${crop.qid}: ${upErr.message}`); continue; }
    const { data: existing } = await supabase.from("na_response_crops").select("id")
      .eq("packet_scan_id", scanId).eq("anchor_id", anchor.id).maybeSingle();
    if (existing?.id) {
      const { error: e } = await supabase.from("na_response_crops").update({
        storage_path: storagePath, boundary_expanded: crop.expanded, possibly_truncated: crop.possiblyTruncated, is_blank: false,
      }).eq("id", existing.id);
      if (e) { console.error(`  row ${crop.qid}: ${e.message}`); continue; }
      croppedIds.push(existing.id);
    } else {
      const { data: created, error: e } = await supabase.from("na_response_crops").insert({
        packet_scan_id: scanId, anchor_id: anchor.id, storage_path: storagePath,
        boundary_expanded: crop.expanded, possibly_truncated: crop.possiblyTruncated, is_blank: false,
      }).select("id").single();
      if (e || !created) { console.error(`  row ${crop.qid}: ${e?.message}`); continue; }
      croppedIds.push(created.id);
    }
  }
  return croppedIds;
}

async function cropPhase(anchors: AnchorRow[]) {
  const pending = join(baseDir, "assess-queue.json");
  const queue: Record<string, string[]> = existsSync(pending) ? JSON.parse(readFileSync(pending, "utf8")) : {};
  for (const [scanId, t] of Object.entries(transforms)) {
    if (progress.cropped.includes(scanId)) continue;
    const full = Boolean(t.normalized_local);
    try {
      const ids = await cropScan(scanId, anchors, full);
      queue[scanId] = ids;
      writeFileSync(pending, JSON.stringify(queue, null, 1));
      progress.cropped.push(scanId); saveProgress();
      console.log(`cropped ${t.student ?? scanId}: ${ids.length} crops (${full ? "all" : "changed-only"})`);
    } catch (e) {
      console.error(`crop FAIL ${t.student ?? scanId}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function assessCrop(cropId: string, anchorsById: Map<string, AnchorRow>): Promise<string> {
  const { data: crop, error } = await supabase.from("na_response_crops")
    .select("id, storage_path, is_blank, boundary_expanded, possibly_truncated, anchor_id").eq("id", cropId).single();
  if (error || !crop) return `load-fail`;
  const anchor = anchorsById.get(crop.anchor_id);
  if (!anchor) return "no-anchor";
  const ctx: AnchorContext = {
    qid: anchor.qid, baseQid: anchor.base_qid ?? anchor.qid,
    marksAvailable: anchor.marks_available == null ? null : Number(anchor.marks_available),
    commandTerm: anchor.command_term, answerSketch: anchor.answer_sketch, openRubric: anchor.open_rubric,
    misconceptionContext: anchor.misconception_context, questionText: anchor.question_text,
    questionAnswer: anchor.question_answer, questionMarks: anchor.question_marks == null ? null : Number(anchor.question_marks),
    boundaryExpanded: crop.boundary_expanded ?? undefined, possiblyTruncated: crop.possibly_truncated ?? undefined,
  };
  const { data: prior } = await supabase.from("na_feedback").select("id, ai_marks_awarded").eq("crop_id", cropId).maybeSingle();
  const upsert = async (fields: Record<string, unknown>) => {
    if (prior?.id) {
      const { error: e } = await supabase.from("na_feedback").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", prior.id);
      if (e) throw new Error(e.message);
    } else {
      const { error: e } = await supabase.from("na_feedback").insert({ crop_id: cropId, ...fields });
      if (e) throw new Error(e.message);
    }
  };
  if (isUngradedAnchor(ctx)) {
    await upsert({ ai_attempted: false, ai_teacher_note: "Not marked: this box is an ungraded thinking space (no marks, no answer key, no rubric)." });
    return "ungraded";
  }
  const { data: file, error: dlErr } = await supabase.storage.from(BUCKET).download(crop.storage_path);
  if (dlErr || !file) return "img-fail";
  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const message = await anthropic.messages.create({
    model: ASSESSMENT_MODEL, max_tokens: 2048, system: ASSESSMENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
      { type: "text", text: buildRubricBlock(ctx), cache_control: { type: "ephemeral" } },
      { type: "text", text: buildAssessmentUserPrompt() },
    ] }],
  });
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const validated = validateAssessment(text, ctx.marksAvailable);
  if (!validated.ok) {
    await upsert({ ai_attempted: true, ai_marks_available: ctx.marksAvailable, ai_validation_error: validated.error, ai_raw_response: { rawText: text.slice(0, 4000) } });
    return `INVALID ${anchor.qid}`;
  }
  const a = validated.assessment;
  let warnings = validated.warnings;
  if (a.redirectedElsewhere) {
    warnings = [...warnings, "An arrow crossing this answer box was detected, meaning the student's real work for this question is elsewhere on the page, but the wider-page re-check could not resolve it -- a teacher should check the original page for where that work was written."];
  }
  await upsert({
    ai_attempted: true, ai_student_attempted: a.studentAttempted, ai_transcription: a.transcription,
    ai_verdict: a.verdict, ai_marks_awarded: a.marksAwarded, ai_marks_available: ctx.marksAvailable,
    ai_misconception_tags: a.misconceptionTags, ai_margin_comment: a.marginComment, ai_next_step: a.nextStep,
    ai_confidence: a.confidence, ai_teacher_note: [a.teacherNote, ...warnings].filter(Boolean).join(" | "),
    ai_validation_error: null, ai_raw_response: a as unknown as Record<string, unknown>,
  });
  return `${anchor.qid}: ${prior?.ai_marks_awarded ?? "-"} -> ${a.marksAwarded}/${ctx.marksAvailable}`;
}

async function assessPhase(anchors: AnchorRow[]) {
  const anchorsById = new Map(anchors.map((a) => [a.id, a]));
  const pending = join(baseDir, "assess-queue.json");
  if (!existsSync(pending)) { console.log("no assess queue"); return; }
  const queue: Record<string, string[]> = JSON.parse(readFileSync(pending, "utf8"));
  const doneSet = new Set(progress.assessed);
  const all: { scanId: string; cropId: string }[] = [];
  for (const [scanId, ids] of Object.entries(queue)) {
    for (const id of ids) if (!doneSet.has(id)) all.push({ scanId, cropId: id });
  }
  console.log(`${all.length} crops to assess`);
  let i = 0;
  async function worker() {
    while (i < all.length) {
      const item = all[i++];
      try {
        const r = await assessCrop(item.cropId, anchorsById);
        const student = transforms[item.scanId]?.student ?? item.scanId.slice(0, 8);
        console.log(`[${i}/${all.length}] ${student} ${r}`);
      } catch (e) {
        console.error(`assess FAIL ${item.cropId}: ${e instanceof Error ? e.message : e}`);
        continue; // stays out of progress; a re-run retries it
      }
      progress.assessed.push(item.cropId);
      if (progress.assessed.length % 20 === 0) saveProgress();
    }
  }
  await Promise.all(Array.from({ length: ASSESS_CONCURRENCY }, worker));
  saveProgress();
}

/** Regenerate prompt crops whose band start moved (previous anchor's y1
 *  changed on 1 Sep). Cut from Davi Verma's aligned split PDF via the CV
 *  service, same practice as the 28 Aug backfill. */
async function promptsPhase(anchors: AnchorRow[]) {
  const SOURCE_SCAN = "fb4b6967-2280-4cf6-ac8b-ba7961727c41";
  const { data: scan } = await supabase.from("na_packet_scans").select("split_storage_path").eq("id", SOURCE_SCAN).single();
  if (!scan?.split_storage_path) throw new Error("source scan missing");
  const { data: pdfFile, error: dlErr } = await supabase.storage.from(BUCKET).download(scan.split_storage_path);
  if (dlErr || !pdfFile) throw new Error(`pdf: ${dlErr?.message}`);
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  const sorted = [...anchors].sort((a, b) => (a.page_index - b.page_index) || (Number(a.y0_pt) - Number(b.y0_pt)));
  for (const anchor of sorted) {
    if (!PROMPT_REGEN_QIDS.has(anchor.qid) || progress.prompts.includes(anchor.qid)) continue;
    const prev = sorted.filter((x) => x.page_index === anchor.page_index && Number(x.y1_pt) <= Number(anchor.y0_pt) + 1 && x.id !== anchor.id)
      .sort((a, b) => Number(b.y1_pt) - Number(a.y1_pt))[0];
    const top = prev ? Number(prev.y1_pt) : 30;
    const bottom = Number(anchor.y0_pt);
    if (bottom - top < 25) {
      await supabase.from("na_anchors").update({ prompt_crop_storage_path: null }).eq("id", anchor.id);
      progress.prompts.push(anchor.qid); saveProgress();
      console.log(`prompt ${anchor.qid}: band ${Math.round(bottom - top)}pt < 25 -- cleared`);
      continue;
    }
    const res = await fetch(`${CV_URL}/crop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(CV_SECRET ? { "X-CV-Secret": CV_SECRET } : {}) },
      body: JSON.stringify({
        studentPdfBase64: pdfBase64, expectedPageCount: 26, rotationHint: 0,
        anchors: [{ qid: anchor.qid, pageIndex: anchor.page_index, x0Pt: Number(anchor.x0_pt), y0Pt: top, x1Pt: Number(anchor.x1_pt), y1Pt: bottom, expandMaxX1Pt: null, expandMaxY1Pt: null }],
      }),
    });
    if (!res.ok) { console.error(`prompt ${anchor.qid}: CV ${res.status}`); continue; }
    const cv = (await res.json()) as { crops: { imageBase64: string }[] };
    const img = cv.crops[0]?.imageBase64;
    if (!img) { console.error(`prompt ${anchor.qid}: no image`); continue; }
    const path = `na-crops/${PACKET_VERSION_ID}/prompts/${anchor.id}.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(img, "base64"), { contentType: "image/png", upsert: true });
    if (upErr) { console.error(`prompt ${anchor.qid}: ${upErr.message}`); continue; }
    await supabase.from("na_anchors").update({ prompt_crop_storage_path: path }).eq("id", anchor.id);
    progress.prompts.push(anchor.qid); saveProgress();
    console.log(`prompt ${anchor.qid}: regenerated (${Math.round(bottom - top)}pt band)`);
  }
}

async function main() {
  const anchors = await loadAnchors();
  if (phase === "upload" || phase === "all") await uploadPhase();
  if (phase === "crop" || phase === "all") await cropPhase(anchors);
  if (phase === "prompts" || phase === "all") await promptsPhase(anchors);
  if (phase === "assess" || phase === "all") await assessPhase(anchors);
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
