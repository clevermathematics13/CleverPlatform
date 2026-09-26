// Bulk mark-scheme build: reads each PPQ question's mark-scheme images,
// transcribes them into LaTeX, checks the transcription, and fills
// question_parts from it.
//
// Every attempt is one markscheme_builds row
// (supabase/migrations/20260926165846_markscheme_builds.sql), so this script
// keeps no local state: a batch submitted in one session is collected in
// the next. A question that passes every check is written by
// apply_markscheme_build(), which re-checks each row it changes; one that
// fails is flagged for the teacher in LaTeX Review, and none of it reaches
// the grader. The rules are in lib/markscheme-build.ts, the request in
// lib/markscheme-transcribe.ts.
//
// Usage (from platform/):
//   npx tsx scripts/build-mark-schemes.ts                        # dry run: what would be built; no calls, no writes
//   npx tsx scripts/build-mark-schemes.ts --gold --out /tmp/gold.json
//   npx tsx scripts/build-mark-schemes.ts --apply --limit 20     # transcribe now; apply what passes, flag the rest
//   npx tsx scripts/build-mark-schemes.ts --apply --hold --codes 19M.1.AHL.TZ2.H_4
//   npx tsx scripts/build-mark-schemes.ts --release --codes 19M.1.AHL.TZ2.H_4
//   npx tsx scripts/build-mark-schemes.ts --batch --all          # submit every selected question as Message Batches
//   npx tsx scripts/build-mark-schemes.ts --collect              # read every ended batch; apply what passes
//   npx tsx scripts/build-mark-schemes.ts --rollback <run id>
//
// Selection (dry run, --apply, --batch): questions with mark-scheme images
// and a part with no scheme (or no parts at all), and no build pending,
// flagged, applied, accepted or dismissed; printable ones (question images
// on file) first. Narrow it with --codes a,b --session 19M,19N --level
// SL|AHL --paper 1 --limit N. --apply and --batch spend money, so they need
// --limit, --codes or --all.
//
// --gold transcribes the questions whose schemes are already known good
// (every verified part, and [L67] P1's eight questions, checked against
// their images by hand) at each --effort (default medium,high) and compares
// marks, codes and text with the bank. It writes nothing but usage rows.
// --out saves the full comparison, scheme text included, so it must point
// outside the repository, which is public. --from <that file> compares a
// saved run again, against the bank as it is now, without calling the model.
//
// --hold (with --apply or --collect) stores the transcription, checks and
// plan but leaves passing builds pending, for a look before they go live;
// --release applies them, planned again against the parts as they are then
// (--codes and --run narrow it). --rollback undoes every build a run
// applied, newest first; the database refuses any question a test or saved
// exam uses now, or whose parts were edited since.
//
// Other options: --effort (default high), --max-tokens (24000),
// --concurrency (3; synchronous calls), --batch-size (150), --run <id> to
// name a run (default ms-<UTC timestamp>), --verbose.
//
// Needs SUPABASE_SERVICE_ROLE_KEY, and ANTHROPIC_API_KEY (or
// GRADING_ANTHROPIC_API_KEY) for every mode that calls the model. Each call
// writes an ai_usage_log row (pipeline "markscheme_build").

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { recordUsage } from "../lib/ai-usage";
import { loadExistingParts, loadQuestionUse } from "../lib/markscheme-builds-service";
import { fetchAllRows, fetchInChunks } from "../lib/supabase-paging";
import { summarizeSchemeMarks } from "../lib/mark-codes";
import {
  alignSubparts,
  checkTranscription,
  isIdenticalSiblingCopy,
  normalizeTranscription,
  planPartChanges,
  questionNumberFromCode,
  realBankTotal,
  wholeQuestionLatex,
  type ExistingPart,
  type NormalizedScheme,
  type PartAction,
  type TranscribedScheme,
} from "../lib/markscheme-build";
import {
  buildTranscriptionRequest,
  MARKSCHEME_BUILD_MODEL,
  MARKSCHEME_PROMPT_VERSION,
  mediaTypeForBytes,
  parseTranscription,
  type SchemeImage,
  type TranscriptionEffort,
  type TranscriptionResult,
} from "../lib/markscheme-transcribe";

// -- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined && !v.startsWith("--") ? v : undefined;
};
const list = (name: string): string[] | null => {
  const v = opt(name);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;
};

const MODES = ["gold", "apply", "batch", "collect", "release", "rollback"] as const;
type Mode = (typeof MODES)[number] | "dry";
const chosenModes = MODES.filter((m) => flag(m));
if (chosenModes.length > 1) throw new Error(`Pick one of --${MODES.join(", --")}`);
const MODE: Mode = chosenModes[0] ?? "dry";
const HOLD = flag("hold");
if (HOLD && MODE !== "apply" && MODE !== "collect") throw new Error("--hold goes with --apply or --collect");
const ROLLBACK_RUN = opt("rollback");
if (MODE === "rollback" && !ROLLBACK_RUN) throw new Error("--rollback needs the run id to undo");

const EFFORTS: TranscriptionEffort[] = ["low", "medium", "high", "xhigh", "max"];
// The 26 Sep 2026 gold run (13 known-good questions, 31 parts) found medium
// and high equally right on marks and codes; high kept the notation more
// faithfully for about a cent more a question.
const DEFAULT_EFFORT: TranscriptionEffort = "high";
const efforts = (list("effort") ?? (MODE === "gold" ? ["medium", "high"] : [DEFAULT_EFFORT])) as TranscriptionEffort[];
if (efforts.some((e) => !EFFORTS.includes(e))) throw new Error(`--effort takes ${EFFORTS.join(", ")}`);
if (MODE !== "gold" && efforts.length > 1) throw new Error("Only --gold compares more than one effort");
const EFFORT = efforts[0];

const MAX_TOKENS = Number(opt("max-tokens") ?? 24000);
const CONCURRENCY = Math.max(1, Number(opt("concurrency") ?? 3));
const BATCH_SIZE = Math.max(1, Number(opt("batch-size") ?? 150));
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const CODES = list("codes");
const SESSIONS = list("session");
const LEVELS = list("level")?.map((l) => l.toUpperCase()) ?? null;
const PAPERS = list("paper")?.map(Number) ?? null;
const RUN_FILTER = opt("run");
const RUN_ID = RUN_FILTER ?? `ms-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
const OUT = opt("out");
const FROM = opt("from");
const VERBOSE = flag("verbose");

if ((MODE === "apply" || MODE === "batch") && LIMIT === Infinity && !CODES && !flag("all")) {
  throw new Error(`--${MODE} spends money on every selected question: give --limit, --codes or --all`);
}
const REPO_ROOT = path.resolve(__dirname, "..", "..");
if (OUT && !path.relative(REPO_ROOT, path.resolve(OUT)).startsWith("..")) {
  throw new Error("--out must be outside the repository: it holds mark-scheme text, and the repository is public");
}

const supabaseUrl = process.env.SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.GRADING_ANTHROPIC_API_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
const CALLS_MODEL = (MODE === "gold" && !FROM) || MODE === "apply" || MODE === "batch" || MODE === "collect";
if (CALLS_MODEL && !anthropicKey) throw new Error("ANTHROPIC_API_KEY (or GRADING_ANTHROPIC_API_KEY) is required");

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: anthropicKey ?? "unused" });

// -- helpers ----------------------------------------------------------------
async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

const hasText = (s: string | null | undefined) => !!s && s.trim().length > 0;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const labelName = (l: string) => (l ? `(${l})` : "the whole question");

// Dollars per million tokens for MARKSCHEME_BUILD_MODEL; the Batch API halves all four.
const RATE = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
function costOf(usage: Anthropic.Usage | undefined, batch = false): number {
  if (!usage) return 0;
  const dollars =
    (usage.input_tokens * RATE.input +
      usage.output_tokens * RATE.output +
      (usage.cache_creation_input_tokens ?? 0) * RATE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * RATE.cacheRead) /
    1e6;
  return batch ? dollars / 2 : dollars;
}

// -- the bank ---------------------------------------------------------------
interface Question {
  id: string;
  code: string;
  session: string | null;
  paper: number | null;
  level: string | null;
}

interface Candidate extends Question {
  imagePaths: string[];
  parts: ExistingPart[];
  /** Question images on file, so ExamBuilder can print it. */
  printable: boolean;
}

async function loadQuestions(ids: string[]): Promise<Question[]> {
  return fetchInChunks<Question>(ids, (chunk) =>
    supabase.from("ib_questions").select("id, code, session, paper, level").in("id", chunk)
  );
}

/** Mark-scheme image paths per question, in their stored order (which the prompt does not rely on). */
async function loadImagePaths(): Promise<Map<string, string[]>> {
  const rows = await fetchAllRows<{ question_id: string; storage_path: string; sort_order: number | null }>((from, to) =>
    supabase
      .from("question_images")
      .select("question_id, storage_path, sort_order")
      .eq("image_type", "markscheme")
      .order("id")
      .range(from, to)
  );
  const byQuestion = new Map<string, typeof rows>();
  for (const r of rows) byQuestion.set(r.question_id, [...(byQuestion.get(r.question_id) ?? []), r]);
  return new Map(
    [...byQuestion].map(([id, list]) => [
      id,
      list
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.storage_path.localeCompare(b.storage_path))
        .map((r) => r.storage_path),
    ])
  );
}

function matchesFilters(q: Question): boolean {
  if (CODES && !CODES.includes(q.code)) return false;
  if (SESSIONS && !SESSIONS.some((s) => q.code.startsWith(`${s}.`))) return false;
  if (LEVELS && !LEVELS.includes((q.level ?? "").toUpperCase())) return false;
  if (PAPERS && !PAPERS.includes(q.paper ?? -1)) return false;
  return true;
}

function needsScheme(parts: ExistingPart[]): boolean {
  return (
    parts.length === 0 ||
    isIdenticalSiblingCopy(parts) ||
    parts.some((p) => !p.latex_verified && !hasText(p.markscheme_latex))
  );
}

/** The questions a build would touch, printable first, and why the rest are left alone. */
async function selectCandidates(): Promise<{ candidates: Candidate[]; skipped: Map<string, number> }> {
  const skipped = new Map<string, number>();
  const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);

  const imagePaths = await loadImagePaths();
  const questions = (await loadQuestions([...imagePaths.keys()])).filter(matchesFilters);
  const parts = await loadExistingParts(supabase, questions.map((q) => q.id));
  const builds = await fetchAllRows<{ question_id: string; status: string }>((from, to) =>
    supabase
      .from("markscheme_builds")
      .select("question_id, status")
      .in("status", ["pending", "flagged", "applied", "accepted", "dismissed"])
      .order("id")
      .range(from, to)
  );
  const buildStatus = new Map(builds.map((b) => [b.question_id, b.status]));
  const printable = new Set(
    (
      await fetchAllRows<{ question_id: string }>((from, to) =>
        supabase.from("question_images").select("question_id").eq("image_type", "question").order("id").range(from, to)
      )
    ).map((r) => r.question_id)
  );

  const candidates: Candidate[] = [];
  for (const q of questions) {
    const qParts = parts.get(q.id) ?? [];
    const status = buildStatus.get(q.id);
    if (status) skip(`has a build ${status}`);
    else if (!needsScheme(qParts)) skip("every part already has a scheme");
    else candidates.push({ ...q, imagePaths: imagePaths.get(q.id) ?? [], parts: qParts, printable: printable.has(q.id) });
  }
  candidates.sort((a, b) => Number(b.printable) - Number(a.printable) || a.code.localeCompare(b.code));
  return { candidates: candidates.slice(0, LIMIT), skipped };
}

// -- the model call -----------------------------------------------------------
const IMAGE_BUCKET = "question-images";
// The API refuses an image over 5 MB.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function loadImages(paths: string[]): Promise<{ images: SchemeImage[]; bytes: number }> {
  if (paths.length === 0) throw new Error("No mark-scheme images on file.");
  const images: SchemeImage[] = [];
  let bytes = 0;
  for (const p of paths) {
    const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(p);
    if (error || !data) throw new Error(`Could not download ${p}: ${error?.message ?? "no data"}`);
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new Error(`${p} is ${(buf.length / 1048576).toFixed(1)} MB; the API takes at most 5 MB an image.`);
    }
    bytes += buf.length;
    images.push({ mediaType: mediaTypeForBytes(buf, p), base64: buf.toString("base64") });
  }
  return { images, bytes };
}

function requestFor(q: { code: string }, images: SchemeImage[], effort: TranscriptionEffort) {
  return buildTranscriptionRequest({
    code: q.code,
    questionNumber: questionNumberFromCode(q.code),
    images,
    effort,
    maxTokens: MAX_TOKENS,
  });
}

interface Transcribed {
  message: Anthropic.Message;
  result: TranscriptionResult;
  seconds: number;
}

async function transcribeNow(c: Candidate, effort: TranscriptionEffort, buildId: string | null): Promise<Transcribed> {
  const started = Date.now();
  const { images } = await loadImages(c.imagePaths);
  // Streamed: a long adaptive-thinking response can outlast a plain request's timeout.
  const message = await anthropic.messages.stream(requestFor(c, images, effort)).finalMessage();
  await recordUsage(supabase, {
    pipeline: "markscheme_build",
    model: message.model,
    usage: message.usage,
    ref: buildId ? { type: "markscheme_build", id: buildId } : undefined,
  });
  return { message, result: parseTranscription(message), seconds: (Date.now() - started) / 1000 };
}

// -- build rows -----------------------------------------------------------------
async function createBuild(c: Candidate, effort: TranscriptionEffort): Promise<string | null> {
  const { data, error } = await supabase
    .from("markscheme_builds")
    .insert({
      question_id: c.id,
      source: "ms_images",
      source_ref: { images: c.imagePaths, effort, max_tokens: MAX_TOKENS },
      model: MARKSCHEME_BUILD_MODEL,
      prompt_version: MARKSCHEME_PROMPT_VERSION,
      run_id: RUN_ID,
    })
    .select("id")
    .single();
  // 23505: the question already has a pending or flagged build (one open build a question).
  if (error?.code === "23505") return null;
  if (error || !data) throw new Error(`Could not record a build for ${c.code}: ${error?.message ?? "no row"}`);
  return data.id as string;
}

async function failBuild(id: string, error: string, usage?: Anthropic.Usage): Promise<void> {
  const { error: e } = await supabase
    .from("markscheme_builds")
    .update({ status: "failed", error: error.slice(0, 4000), ...(usage ? { usage } : {}) })
    .eq("id", id);
  if (e) console.error(`  could not mark build ${id} failed: ${e.message}`);
}

type Outcome = "applied" | "flagged" | "held" | "failed";

interface Settled {
  outcome: Outcome;
  /** The flags, or what was (or would be) applied. */
  notes: string[];
}

function describeAction(a: PartAction): string {
  if (a.kind === "insert") return `add ${a.label ? `(${a.label})` : "one part"} [${a.marks}]`;
  if (a.kind === "relabel") return `relabel the unlabelled part (${a.label}) [${a.marks}]`;
  return `fill ${a.expectedLabel ? `(${a.expectedLabel})` : "the unlabelled part"}${a.marks !== null ? ` [${a.marks}]` : ""}`;
}

/**
 * Checks and plans one transcription against the question as it is now, and
 * records the result. A clean plan is applied, unless apply is false
 * (--hold): then the build stays pending until --release.
 */
async function settleBuild(
  buildId: string,
  q: { id: string; code: string },
  raw: TranscribedScheme,
  apply: boolean,
  usage?: Anthropic.Usage
): Promise<Settled> {
  const scheme = normalizeTranscription(raw);
  const parts = (await loadExistingParts(supabase, [q.id])).get(q.id) ?? [];
  const use = (await loadQuestionUse(supabase, [q])).get(q.id) ?? null;
  const check = checkTranscription(scheme, {
    expectedQuestionNumber: questionNumberFromCode(q.code),
    bankTotal: realBankTotal(parts),
  });
  const plan = planPartChanges({ existing: parts, scheme, marks: check.resolvedMarks, inUse: use?.target ?? null });
  const issues = [...check.issues, ...(use?.conflicts ?? [])];
  if (issues.length === 0 && plan.flags.length === 0 && plan.actions.length === 0) {
    issues.push("The scheme changes nothing: every part it covers already has a scheme or was verified.");
  }
  const flagged = issues.length > 0 || plan.flags.length > 0;

  const { error } = await supabase
    .from("markscheme_builds")
    .update({
      transcription: raw,
      checks: { issues, warnings: check.warnings, resolvedMarks: check.resolvedMarks },
      plan,
      status: flagged ? "flagged" : "pending",
      error: null,
      ...(usage ? { usage } : {}),
    })
    .eq("id", buildId);
  if (error) throw new Error(`Could not record build ${buildId}: ${error.message}`);
  if (flagged) return { outcome: "flagged", notes: [...issues, ...plan.flags] };
  if (!apply) return { outcome: "held", notes: plan.actions.map(describeAction) };

  const { error: applyError } = await supabase.rpc("apply_markscheme_build", { p_build_id: buildId });
  if (applyError) {
    await failBuild(buildId, applyError.message);
    return { outcome: "failed", notes: [applyError.message] };
  }
  return { outcome: "applied", notes: plan.actions.map(describeAction) };
}

function formatNotes(s: Settled): string {
  if (s.notes.length === 0) return "";
  if (s.outcome === "applied" || s.outcome === "held") return `: ${s.notes.join(", ")}`;
  return `\n        - ${s.notes.join("\n        - ")}`;
}

class Tally {
  private counts = new Map<string, number>();
  private reasons = new Map<string, number>();
  cost = 0;

  add(outcome: string, notes: string[] = []): void {
    this.counts.set(outcome, (this.counts.get(outcome) ?? 0) + 1);
    if (outcome !== "flagged" && outcome !== "failed") return;
    for (const n of notes) {
      const key = /^(Unreadable|Source):/.test(n)
        ? `${n.split(":")[0]}: ...`
        : n
            .replace(/\([a-z]+\)/g, "(x)")
            .replace(/"[^"]*"/g, '"..."')
            .replace(/\d+(?:\.\d+)?/g, "N")
            .slice(0, 100);
      this.reasons.set(key, (this.reasons.get(key) ?? 0) + 1);
    }
  }

  print(): void {
    const counts = [...this.counts].map(([k, v]) => `${v} ${k}`).join(", ");
    console.log(`\n${counts || "nothing done"}; about $${this.cost.toFixed(2)}.`);
    const top = [...this.reasons].sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (top.length) {
      console.log("Most common reasons:");
      for (const [k, v] of top) console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
  }
}

// -- modes ----------------------------------------------------------------------
function shapeOf(parts: ExistingPart[]): string {
  if (parts.length === 0) return "no parts yet";
  if (isIdenticalSiblingCopy(parts)) return "one scheme copied onto every part";
  if (parts.length === 1 && parts[0].part_label === "") return "one unlabelled part";
  if (parts.some((p) => p.part_label === "")) return "an unlabelled part beside labelled ones";
  return "labelled parts";
}

async function dryRun(): Promise<void> {
  const { candidates, skipped } = await selectCandidates();
  const use = await loadQuestionUse(supabase, candidates);
  const count = (key: (c: Candidate) => string) => {
    const m = new Map<string, number>();
    for (const c of candidates) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ");
  };
  const images = candidates.reduce((s, c) => s + c.imagePaths.length, 0);
  console.log(`Dry run: ${candidates.length} questions would be built, ${images} scheme images.`);
  if (candidates.length === 0) return;
  console.log(`  printable: ${count((c) => (c.printable ? "printable" : "not printable"))}`);
  console.log(`  level/paper: ${count((c) => `${c.level ?? "?"} P${c.paper ?? "?"}`)}`);
  console.log(`  parts now: ${count((c) => shapeOf(c.parts))}`);
  if (skipped.size) console.log(`  left alone: ${[...skipped].map(([k, v]) => `${v} ${k}`).join(", ")}`);
  const inUse = candidates.filter((c) => use.has(c.id));
  if (inUse.length) {
    console.log(`  used by a test or saved exam (${inUse.length}): only their tested labels are filled or created:`);
    for (const c of inUse) {
      const labels = use.get(c.id)!.target.labels.map(labelName).join(", ");
      console.log(`    ${c.code} [${shapeOf(c.parts)}] tests use ${labels}`);
    }
  }
  // Measured by the 26 Sep 2026 gold run at high effort: $0.70 for 13
  // questions synchronously, about $0.054 each; batches are half price.
  console.log(
    `  estimated cost: ~$${(candidates.length * 0.027).toFixed(0)} as batches, ~$${(candidates.length * 0.054).toFixed(0)} synchronously`
  );
  if (VERBOSE) for (const c of candidates) console.log(`    ${c.code} [${shapeOf(c.parts)}] ${c.imagePaths.length} image(s)`);
}

async function runSync(candidates: Candidate[]): Promise<void> {
  const tally = new Tally();
  console.log(
    `Run ${RUN_ID}: ${candidates.length} questions at effort ${EFFORT}, ${HOLD ? "held for review" : "applying what passes"}.`
  );
  await pool(candidates, CONCURRENCY, async (c, i) => {
    const tag = `${String(i + 1).padStart(4)}/${candidates.length} ${c.code}`;
    const buildId = await createBuild(c, EFFORT);
    if (!buildId) {
      tally.add("skipped");
      console.log(`${tag}: already has an open build`);
      return;
    }
    try {
      const t = await transcribeNow(c, EFFORT, buildId);
      const cost = costOf(t.message.usage);
      tally.cost += cost;
      if (!t.result.ok) {
        await failBuild(buildId, t.result.error, t.message.usage);
        tally.add("failed", [t.result.error]);
        console.log(`${tag}: failed: ${t.result.error}`);
        return;
      }
      const s = await settleBuild(buildId, c, t.result.scheme, !HOLD, t.message.usage);
      tally.add(s.outcome, s.notes);
      console.log(`${tag}: ${s.outcome} (${t.seconds.toFixed(0)}s, $${cost.toFixed(3)})${formatNotes(s)}`);
    } catch (e) {
      await failBuild(buildId, errorText(e));
      tally.add("failed", [errorText(e)]);
      console.log(`${tag}: failed: ${errorText(e)}`);
    }
  });
  tally.print();
  console.log(`Undo with: npx tsx scripts/build-mark-schemes.ts --rollback ${RUN_ID}`);
}

// The Batch API takes at most 256 MB a batch, and the base64 images are nearly all of it.
const BATCH_BYTE_BUDGET = 180 * 1024 * 1024;

async function submitBatches(candidates: Candidate[]): Promise<void> {
  let entries: { buildId: string; params: Anthropic.MessageCreateParamsNonStreaming }[] = [];
  let encoded = 0;
  let submitted = 0;

  const flush = async () => {
    if (entries.length === 0) return;
    const requests = entries.map((e) => ({ custom_id: e.buildId, params: e.params }));
    const ids = entries.map((e) => e.buildId);
    const size = encoded;
    entries = [];
    encoded = 0;
    let batch: Anthropic.Messages.Batches.MessageBatch;
    try {
      batch = await anthropic.messages.batches.create({ requests });
    } catch (e) {
      for (const id of ids) await failBuild(id, `Batch submission failed: ${errorText(e)}`);
      console.log(`A batch of ${ids.length} failed to submit: ${errorText(e)}`);
      return;
    }
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase.from("markscheme_builds").update({ anthropic_batch_id: batch.id }).in("id", chunk);
      if (error) {
        console.error(
          `Batch ${batch.id} is running, but ${chunk.length} of its builds could not be linked to it (${error.message}). ` +
            `Link them before --collect: update markscheme_builds set anthropic_batch_id = '${batch.id}' where id in ('${chunk.join("', '")}');`
        );
      }
    }
    submitted += ids.length;
    console.log(`Batch ${batch.id}: ${ids.length} questions, ${(size / 1048576).toFixed(0)} MB.`);
  };

  console.log(`Run ${RUN_ID}: ${candidates.length} questions at effort ${EFFORT}, in batches of up to ${BATCH_SIZE}.`);
  for (const c of candidates) {
    const buildId = await createBuild(c, EFFORT);
    if (!buildId) {
      console.log(`${c.code}: already has an open build`);
      continue;
    }
    try {
      const { images, bytes } = await loadImages(c.imagePaths);
      const size = Math.ceil(bytes / 3) * 4;
      if (entries.length >= BATCH_SIZE || encoded + size > BATCH_BYTE_BUDGET) await flush();
      entries.push({ buildId, params: requestFor(c, images, EFFORT) });
      encoded += size;
    } catch (e) {
      await failBuild(buildId, errorText(e));
      console.log(`${c.code}: failed: ${errorText(e)}`);
    }
  }
  await flush();
  console.log(`Run ${RUN_ID}: ${submitted} questions submitted. Run --collect once the batches have ended (usually within the hour).`);
}

interface WaitingBuild {
  id: string;
  question_id: string;
  anthropic_batch_id: string | null;
  created_at: string;
}

async function collect(): Promise<void> {
  const waiting = await fetchAllRows<WaitingBuild>((from, to) =>
    supabase
      .from("markscheme_builds")
      .select("id, question_id, anthropic_batch_id, created_at")
      .eq("status", "pending")
      .is("transcription", null)
      .order("id")
      .range(from, to)
  );
  // A run that stopped between recording its builds and submitting them
  // leaves them pending, which blocks the question; an hour is ample.
  for (const b of waiting) {
    if (!b.anthropic_batch_id && Date.now() - Date.parse(b.created_at) > 60 * 60 * 1000) {
      await failBuild(b.id, "Never submitted: the run stopped before its batch was created.");
    }
  }
  const byBatch = new Map<string, WaitingBuild[]>();
  for (const b of waiting) {
    if (b.anthropic_batch_id) byBatch.set(b.anthropic_batch_id, [...(byBatch.get(b.anthropic_batch_id) ?? []), b]);
  }
  if (byBatch.size === 0) {
    console.log("No batches are waiting.");
    return;
  }

  const questions = new Map((await loadQuestions([...new Set(waiting.map((b) => b.question_id))])).map((q) => [q.id, q]));
  const tally = new Tally();
  for (const [batchId, builds] of byBatch) {
    const batch = await anthropic.messages.batches.retrieve(batchId);
    if (batch.processing_status !== "ended") {
      const n = batch.request_counts;
      console.log(`Batch ${batchId}: ${batch.processing_status}, ${n.succeeded + n.errored + n.canceled + n.expired} of ${builds.length} done.`);
      continue;
    }
    console.log(`Batch ${batchId}: ended; collecting ${builds.length}.`);
    const open = new Map(builds.map((b) => [b.id, b]));
    for await (const line of await anthropic.messages.batches.results(batchId)) {
      const b = open.get(line.custom_id);
      if (!b) continue;
      open.delete(line.custom_id);
      const q = questions.get(b.question_id);
      if (!q) {
        await failBuild(b.id, "Its question is no longer in the bank.");
        tally.add("failed");
        continue;
      }
      try {
        if (line.result.type !== "succeeded") {
          const why = line.result.type === "errored" ? line.result.error.error.message : line.result.type;
          await failBuild(b.id, `Batch request ${line.result.type}: ${why}`);
          tally.add("failed", [`Batch request ${line.result.type}`]);
          console.log(`  ${q.code}: failed: ${why}`);
          continue;
        }
        const message = line.result.message;
        tally.cost += costOf(message.usage, true);
        await recordUsage(supabase, {
          pipeline: "markscheme_build",
          model: message.model,
          usage: message.usage,
          batch: true,
          ref: { type: "markscheme_build", id: b.id },
        });
        const result = parseTranscription(message);
        if (!result.ok) {
          await failBuild(b.id, result.error, message.usage);
          tally.add("failed", [result.error]);
          console.log(`  ${q.code}: failed: ${result.error}`);
          continue;
        }
        const s = await settleBuild(b.id, q, result.scheme, !HOLD, message.usage);
        tally.add(s.outcome, s.notes);
        console.log(`  ${q.code}: ${s.outcome}${formatNotes(s)}`);
      } catch (e) {
        await failBuild(b.id, errorText(e));
        tally.add("failed", [errorText(e)]);
        console.log(`  ${q.code}: failed: ${errorText(e)}`);
      }
    }
    for (const b of open.values()) await failBuild(b.id, "The batch ended without a result for this build.");
  }
  tally.print();
}

async function release(): Promise<void> {
  const held = await fetchAllRows<{ id: string; question_id: string; transcription: TranscribedScheme }>((from, to) => {
    let query = supabase
      .from("markscheme_builds")
      .select("id, question_id, transcription")
      .eq("status", "pending")
      .not("transcription", "is", null);
    if (RUN_FILTER) query = query.eq("run_id", RUN_FILTER);
    return query.order("id").range(from, to);
  });
  const questions = new Map((await loadQuestions([...new Set(held.map((b) => b.question_id))])).map((q) => [q.id, q]));
  const chosen = held.filter((b) => {
    const q = questions.get(b.question_id);
    return q && (!CODES || CODES.includes(q.code));
  });
  console.log(`Releasing ${chosen.length} held builds.`);
  const tally = new Tally();
  for (const b of chosen) {
    const q = questions.get(b.question_id)!;
    try {
      const s = await settleBuild(b.id, q, b.transcription, true);
      tally.add(s.outcome, s.notes);
      console.log(`  ${q.code}: ${s.outcome}${formatNotes(s)}`);
    } catch (e) {
      await failBuild(b.id, errorText(e));
      tally.add("failed", [errorText(e)]);
      console.log(`  ${q.code}: failed: ${errorText(e)}`);
    }
  }
  tally.print();
}

async function rollback(runId: string): Promise<void> {
  const builds = await fetchAllRows<{ id: string; question_id: string; status: string }>((from, to) =>
    supabase
      .from("markscheme_builds")
      .select("id, question_id, status")
      .eq("run_id", runId)
      .in("status", ["applied", "accepted"])
      .order("applied_at", { ascending: false })
      .range(from, to)
  );
  const questions = new Map((await loadQuestions([...new Set(builds.map((b) => b.question_id))])).map((q) => [q.id, q]));
  const accepted = builds.filter((b) => b.status === "accepted").length;
  const applied = builds.filter((b) => b.status === "applied");
  console.log(
    `Run ${runId}: rolling back ${applied.length} applied builds${accepted ? `; ${accepted} the teacher accepted are left alone` : ""}.`
  );
  let done = 0;
  for (const b of applied) {
    const code = questions.get(b.question_id)?.code ?? b.question_id;
    const { data, error } = await supabase.rpc("rollback_markscheme_build", { p_build_id: b.id });
    if (error) {
      console.log(`  ${code}: not rolled back: ${error.message}`);
      continue;
    }
    done += 1;
    const r = data as { deleted: number; restored: number };
    console.log(`  ${code}: rolled back (${r.deleted} parts removed, ${r.restored} restored)`);
  }
  console.log(`${done} of ${applied.length} rolled back.`);
}

// -- gold -------------------------------------------------------------------------
// [L67] P1's eight questions: in use, and their schemes checked against the
// images by hand when the test was set up.
const GOLD_EXTRA_CODES = [
  "17N.1.AHL.TZ0.H_4",
  "18M.1.SL.TZ2.S_3",
  "19M.1.AHL.TZ2.H_4",
  "13M.1.AHL.TZ2.H_5",
  "13M.1.AHL.TZ1.H_7",
  "19N.1.AHL.TZ0.H_6",
  "18N.1.AHL.TZ0.H_9",
  "18N.1.AHL.TZ0.H_10",
];

interface PartComparison {
  label: string;
  verified: boolean;
  bankMarks: number;
  schemeMarks: number | null;
  bankCodes: string;
  schemeCodes: string;
  /** Share of lines the two have in common after cosmetic normalising, 0-1. */
  similarity: number;
  onlyBank: string[];
  onlyScheme: string[];
}

/**
 * The content lines as the grader would read them, with what never changes
 * a mark taken out: code-only lines and trailing codes (compared on their
 * own), the marks statement, spacing, dollar signs, \left/\right and \big
 * sizes, \dfrac, \displaystyle, and \text/\textbf/\mathrm wrappers.
 */
function comparableLines(latex: string): string[] {
  return latex
    .split("\n")
    .map((line) =>
      line
        .replace(/\\hfill.*$/, "")
        .replace(/^\s*(?:\\textbf\{)?\s*total\s*\[\s*\d+\s*marks?\s*\]\s*\}?\s*$/i, "")
        .replace(/\\(?:text|textbf|textit|textrm|mathrm|mathbf|emph)\s*\{([^{}]*)\}/g, "$1")
        .replace(/\\(?:left|right|[bB]igg?[lr]?)(?=[()[\]|.\\{}])/g, "")
        .replace(/\\[dt]frac/g, "\\frac")
        .replace(/\\displaystyle/g, "")
        .replace(/\\ldots|\\dots|\\cdots/g, "...")
        .replace(/\^\{\\circ\}/g, "^\\circ")
        .replace(/([_^])\{([A-Za-z0-9])\}/g, "$1$2")
        .replace(/\\(?:quad|qquad|[,;:! ])/g, "")
        .replace(/[\s~$]/g, "")
    )
    .filter(Boolean);
}

function commonLines(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const codeList = (latex: string) =>
  summarizeSchemeMarks(latex)
    .codes.map((c) => c.token)
    .sort()
    .join(" ");

function compareToBank(bank: ExistingPart[], normalized: NormalizedScheme, resolved: (number | null)[]): PartComparison[] {
  // Cut shared-marks parts into the bank's sub-parts first, as the planner does.
  const { scheme, marks } = alignSubparts(normalized, resolved, new Set(bank.map((p) => p.part_label)));
  const unlabelledScheme = scheme.parts.length === 1 && scheme.parts[0].label === "";
  const out: PartComparison[] = [];
  for (const p of bank) {
    if (!hasText(p.markscheme_latex)) continue;
    let latex = "";
    let m: number | null = null;
    if (p.part_label === "" && !unlabelledScheme) {
      // The bank keeps the whole question on one part: compare it with every part together.
      latex = wholeQuestionLatex(scheme);
      m = marks.every((x) => x !== null) ? marks.reduce<number>((s, x) => s + (x ?? 0), 0) : scheme.totalMarks;
    } else {
      const i = scheme.parts.findIndex((s) => s.label === p.part_label);
      if (i >= 0) {
        latex = scheme.parts[i].latex;
        m = marks[i];
      }
    }
    const a = comparableLines(p.markscheme_latex!);
    const b = comparableLines(latex);
    const both = commonLines(a, b);
    const inB = new Set(b);
    const inA = new Set(a);
    out.push({
      label: p.part_label,
      verified: p.latex_verified,
      bankMarks: p.marks,
      schemeMarks: m,
      bankCodes: codeList(p.markscheme_latex!),
      schemeCodes: codeList(latex),
      similarity: a.length + b.length ? (2 * both) / (a.length + b.length) : 1,
      onlyBank: a.filter((l) => !inB.has(l)),
      onlyScheme: b.filter((l) => !inA.has(l)),
    });
  }
  return out;
}

interface GoldRow {
  code: string;
  effort: TranscriptionEffort;
  error?: string;
  seconds?: number;
  cost?: number;
  usage?: Anthropic.Usage;
  issues?: string[];
  warnings?: string[];
  parts?: PartComparison[];
  transcription?: TranscribedScheme;
}

function goldRowFor(c: Candidate, base: GoldRow, saved: TranscribedScheme): GoldRow {
  // Transcriptions saved by an older prompt lack the newer fields.
  const raw: TranscribedScheme = { ...saved, misprints: saved.misprints ?? [], diagrams: saved.diagrams ?? [] };
  const scheme = normalizeTranscription(raw);
  const check = checkTranscription(scheme, {
    expectedQuestionNumber: questionNumberFromCode(c.code),
    bankTotal: realBankTotal(c.parts),
  });
  return {
    ...base,
    issues: check.issues,
    warnings: check.warnings,
    parts: compareToBank(c.parts, scheme, check.resolvedMarks),
    transcription: raw,
  };
}

function printGold(effort: string, rows: GoldRow[]): void {
  let compared = 0;
  let marksAgree = 0;
  let codesAgree = 0;
  let similarity = 0;
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.code}: ERROR ${r.error}`);
      continue;
    }
    const ps = r.parts ?? [];
    const mOk = ps.filter((p) => p.schemeMarks === p.bankMarks).length;
    const cOk = ps.filter((p) => p.schemeCodes === p.bankCodes).length;
    const sim = ps.reduce((s, p) => s + p.similarity, 0);
    compared += ps.length;
    marksAgree += mOk;
    codesAgree += cOk;
    similarity += sim;
    console.log(
      `${r.code}: marks ${mOk}/${ps.length}, codes ${cOk}/${ps.length}, text ${ps.length ? ((100 * sim) / ps.length).toFixed(0) : "-"}%, ` +
        `${r.issues?.length ?? 0} issue(s); ${r.seconds?.toFixed(0) ?? "-"}s, ${r.usage?.output_tokens ?? "-"} out, $${r.cost?.toFixed(3) ?? "-"}`
    );
    for (const issue of r.issues ?? []) console.log(`    issue: ${issue}`);
    if (VERBOSE) for (const w of r.warnings ?? []) console.log(`    warning: ${w}`);
    for (const p of ps) {
      const differs = p.schemeMarks !== p.bankMarks || p.schemeCodes !== p.bankCodes || p.similarity < 1;
      if (!differs && !VERBOSE) continue;
      console.log(
        `    ${labelName(p.label)}${p.verified ? " (verified)" : ""}: marks ${p.bankMarks} vs ${p.schemeMarks ?? "?"}; ` +
          `codes [${p.bankCodes}] vs [${p.schemeCodes}]; text ${(100 * p.similarity).toFixed(0)}%`
      );
      for (const l of p.onlyBank) console.log(`      - ${l}`);
      for (const l of p.onlyScheme) console.log(`      + ${l}`);
    }
  }
  const ok = rows.filter((r) => !r.error);
  const cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  console.log(
    `\neffort ${effort}: ${ok.length}/${rows.length} transcribed; parts compared ${compared}: marks agree ${marksAgree}, codes agree ${codesAgree}, ` +
      `mean text ${compared ? ((100 * similarity) / compared).toFixed(0) : "-"}%; ${ok.filter((r) => (r.issues?.length ?? 0) > 0).length} would be flagged; ` +
      `$${cost.toFixed(2)}, mean ${(ok.reduce((s, r) => s + (r.seconds ?? 0), 0) / Math.max(1, ok.length)).toFixed(0)}s, ` +
      `mean ${Math.round(ok.reduce((s, r) => s + (r.usage?.output_tokens ?? 0), 0) / Math.max(1, ok.length))} output tokens`
  );
}

async function gold(): Promise<void> {
  const verified = await fetchAllRows<{ question_id: string }>((from, to) =>
    supabase.from("question_parts").select("question_id").eq("latex_verified", true).order("id").range(from, to)
  );
  const { data: extra, error } = await supabase.from("ib_questions").select("id").in("code", GOLD_EXTRA_CODES);
  if (error) throw new Error(error.message);
  const ids = [...new Set([...verified.map((r) => r.question_id), ...(extra ?? []).map((r) => r.id as string)])];
  const imagePaths = await loadImagePaths();
  const parts = await loadExistingParts(supabase, ids);
  const set: Candidate[] = (await loadQuestions(ids))
    .filter(matchesFilters)
    .filter((q) => imagePaths.has(q.id))
    .map((q) => ({ ...q, imagePaths: imagePaths.get(q.id)!, parts: parts.get(q.id) ?? [], printable: true }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const byCode = new Map(set.map((c) => [c.code, c]));

  const report: GoldRow[] = [];
  if (FROM) {
    // Compare a saved run again, against the bank as it is now, without calling the model.
    const saved = JSON.parse(readFileSync(FROM, "utf8")) as { rows: GoldRow[] };
    for (const effort of [...new Set(saved.rows.map((r) => r.effort))]) {
      console.log(`\n== effort ${effort} (from ${FROM}) ==`);
      const rows = saved.rows
        .filter((r) => r.effort === effort && byCode.has(r.code))
        .map((r) => (r.transcription ? goldRowFor(byCode.get(r.code)!, { ...r, parts: undefined }, r.transcription) : r))
        .sort((a, b) => a.code.localeCompare(b.code));
      printGold(effort, rows);
      report.push(...rows);
    }
  } else {
    for (const effort of efforts) {
      console.log(`\n== effort ${effort}: ${set.length} questions ==`);
      const rows: GoldRow[] = [];
      await pool(set, CONCURRENCY, async (c) => {
        try {
          const t = await transcribeNow(c, effort, null);
          const base = { code: c.code, effort, seconds: t.seconds, cost: costOf(t.message.usage), usage: t.message.usage };
          rows.push(t.result.ok ? goldRowFor(c, base, t.result.scheme) : { ...base, error: t.result.error });
        } catch (e) {
          rows.push({ code: c.code, effort, error: errorText(e) });
        }
      });
      rows.sort((a, b) => a.code.localeCompare(b.code));
      printGold(effort, rows);
      report.push(...rows);
    }
  }
  if (OUT) {
    writeFileSync(
      OUT,
      JSON.stringify(
        { run: RUN_ID, model: MARKSCHEME_BUILD_MODEL, promptVersion: MARKSCHEME_PROMPT_VERSION, maxTokens: MAX_TOKENS, rows: report },
        null,
        2
      )
    );
    console.log(`\nFull comparison: ${OUT}`);
  }
}

// -- main -----------------------------------------------------------------------
async function main(): Promise<void> {
  switch (MODE) {
    case "dry":
      return dryRun();
    case "gold":
      return gold();
    case "apply":
      return runSync((await selectCandidates()).candidates);
    case "batch":
      return submitBatches((await selectCandidates()).candidates);
    case "collect":
      return collect();
    case "release":
      return release();
    case "rollback":
      return rollback(ROLLBACK_RUN!);
  }
}

main().catch((e) => {
  console.error(errorText(e));
  process.exit(1);
});
