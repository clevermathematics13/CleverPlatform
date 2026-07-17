import { getWritable, FatalError } from "workflow";
import Anthropic from "@anthropic-ai/sdk";
import { createClient as createServiceSupabaseClient } from "@supabase/supabase-js";

/**
 * generateNuancedAnalysis — durable workflow for the AI Activity Generator.
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: the previous /api/claude route ran one long, buffered
 * Claude call inside a single Vercel Function invocation. An 11-attachment,
 * two-syllabus-topic generation hit Vercel's ~300s function ceiling and got
 * killed mid-generation — the client never received any bytes, so it saw a
 * bare "Failed to fetch" instead of a real error.
 *
 * IMPORTANT CORRECTION FROM THE FIRST ATTEMPT AT THIS FIX: Vercel Workflows
 * remove the ceiling on TOTAL workflow duration (a workflow can span steps
 * and sleeps for months), but each individual STEP is still its own Vercel
 * Function invocation, bound by this project's same ~300s ceiling. Wrapping
 * the old single giant Claude call in one "use step" function would have
 * hit exactly the same wall. See https://github.com/vercel/workflow/discussions/1106
 * for confirmation of this from Vercel's own workflow maintainers.
 *
 * THE ACTUAL FIX: split generation into two bounded Claude calls, each
 * comfortably under the per-step ceiling:
 *   1. First pass generates roughly the first half of the requested scope
 *      (or all of it, if the request is small) and is explicitly told it's
 *      fine to stop partway with valid partial JSON.
 *   2. Second pass receives the first pass's draft back as context and
 *      either completes it or, if it's already complete, returns it as-is.
 * The two passes reuse the identical resolved attachment blocks with a
 * prompt-cache breakpoint (see callClaude), so the second pass doesn't pay
 * to re-ingest the same PDFs/images from scratch — this is what keeps the
 * *combined* two-call wall-clock time close to the original single call's
 * time, rather than roughly doubling it.
 *
 * Progress (attachment resolution, thinking, writing, for each pass) streams
 * out over the workflow's default writable/readable stream in real time —
 * durable and resumable (survives more than a dropped TCP connection, e.g.
 * a closed laptop lid), unlike a hand-rolled SSE response.
 *
 * platform/app/api/claude/route.ts starts this workflow and pipes its
 * (typed, object) readable stream through a small transform into the same
 * SSE wire format the client already parses — see that file for the exact
 * event shapes.
 */

const UPLOADS_BUCKET = "uploads";

// If Anthropic ever changes recommended model names, update here and in
// platform/app/api/claude/route.ts's now-removed direct call (kept in git
// history) — there's currently no shared constant for this across the repo.
const MODEL = "claude-sonnet-5";
const MAX_TOKENS_PER_PASS = 32000;

// How often to emit a 'progress' chunk while Claude is still in its
// thinking phase (no visible text yet). Thinking deltas fire very
// frequently — sending one chunk per delta would flood the stream for no
// UI benefit, so only every Nth delta is forwarded as a "still working" pulse.
const THINKING_PROGRESS_EVERY_N_DELTAS = 40;

const FIRST_PASS_HINT = [
  "",
  "",
  "[Multi-pass generation note: if fully completing this request would require an unusually long response, it's fine to generate roughly the first half now — for example through Part 2, or about half of the total requested scope — and stop there with valid JSON containing just those sections. A second pass will continue seamlessly from where you leave off, so there's no need to rush or compress the remaining content to fit in one pass. If the full request is reasonably short, just complete it normally in this one pass.]",
].join("\n");

const CONTINUATION_INSTRUCTION = [
  "Above is a draft of this Nuanced Analysis packet from a first generation pass, as a raw JSON object — it may be complete, or it may only cover part of what was requested.",
  "",
  "If it already fully and completely addresses everything requested (all parts, all required sections per the DESIGN RULES in your system prompt), return it back unchanged as the final JSON — there's no need to regenerate anything.",
  "",
  "Otherwise, continue it: add the remaining parts/sections that are still missing, in the same voice and thread as what's already there, without repeating or contradicting anything already written.",
  "",
  "Either way, respond with ONLY a single, complete, final JSON object for the ENTIRE packet — merging the prior draft's content with anything you add. Same JSON schema and rules as before. No markdown, no preamble.",
].join("\n");

// ── Content block types (mirrors the shapes the client sends / route resolves) ──

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };
type DocumentBlock = { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };
type ImageRefBlock = { type: "image_ref"; path: string; mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
type DocumentRefBlock = { type: "document_ref"; path: string };

type IncomingBlock = TextBlock | ImageBlock | DocumentBlock | ImageRefBlock | DocumentRefBlock;
type ResolvedBlock = TextBlock | ImageBlock | DocumentBlock;

export type IncomingMessage = { role: "user" | "assistant"; content: string | IncomingBlock[] };
type ResolvedMessage = { role: "user" | "assistant"; content: string | ResolvedBlock[] };

export type NuancedAnalysisChunk =
  | { type: "progress"; phase: string; charCount?: number }
  | { type: "done"; text: string; stopReason: string | null }
  | { type: "error"; message: string };

export type NuancedAnalysisResult = { text: string; stopReason: string | null; error: string | null };

function getServiceSupabase() {
  return createServiceSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────

/**
 * Downloads and base64-encodes every image_ref/document_ref block in
 * `messages`, returning both the resolved messages and the storage paths
 * touched (for later cleanup). Runs with the Supabase service-role key —
 * steps execute outside the original request's cookie session, so the
 * cookie-based client the route handler used isn't available here (same
 * pattern already used by app/api/generate-packet/route.ts).
 */
async function resolveAttachments(
  messages: IncomingMessage[],
): Promise<{ resolved: ResolvedMessage[]; paths: string[] }> {
  "use step";

  const supabase = getServiceSupabase();
  const paths: string[] = [];

  async function resolveBlock(block: IncomingBlock): Promise<ResolvedBlock> {
    if (block.type === "text" || block.type === "image" || block.type === "document") {
      return block;
    }
    const { data, error } = await supabase.storage.from(UPLOADS_BUCKET).download(block.path);
    if (error || !data) {
      // Not retryable — the path won't start existing on a retry.
      throw new FatalError(
        `Could not read attachment "${block.path}" from storage (it may have expired or already been used): ${error?.message ?? "not found"}`,
      );
    }
    paths.push(block.path);
    const arrayBuffer = await data.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    if (block.type === "image_ref") {
      return { type: "image", source: { type: "base64", media_type: block.mimeType, data: base64 } };
    }
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  }

  const resolved = await Promise.all(
    messages.map(async (m) => ({
      role: m.role,
      content: Array.isArray(m.content) ? await Promise.all(m.content.map(resolveBlock)) : m.content,
    })),
  );

  return { resolved, paths };
}

/** Appends the multi-pass hint to the last user message's content, so only
 *  the first pass gets told it's allowed to stop partway. */
function withFirstPassHint(resolved: ResolvedMessage[]): ResolvedMessage[] {
  const lastIndex = resolved.length - 1;
  const last = resolved[lastIndex];
  if (!last || last.role !== "user") return resolved;

  const hinted: ResolvedMessage = {
    role: "user",
    content: Array.isArray(last.content)
      ? [...last.content, { type: "text", text: FIRST_PASS_HINT }]
      : `${last.content}${FIRST_PASS_HINT}`,
  };
  return [...resolved.slice(0, lastIndex), hinted];
}

/** Marks the last content block of the last message as an ephemeral
 *  prompt-cache breakpoint. Both passes send the identical resolved
 *  attachment blocks, so this lets the second pass skip re-processing most
 *  of that content instead of paying full price to re-ingest it. */
function withCacheBreakpoint(resolved: ResolvedMessage[]): ResolvedMessage[] {
  const lastIndex = resolved.length - 1;
  const last = resolved[lastIndex];
  if (!last || !Array.isArray(last.content) || last.content.length === 0) return resolved;

  const blockIndex = last.content.length - 1;
  const cached: ResolvedMessage = {
    role: last.role,
    content: last.content.map((block, i) =>
      i === blockIndex ? { ...block, cache_control: { type: "ephemeral" as const } } : block,
    ),
  };
  return [...resolved.slice(0, lastIndex), cached];
}

/** Runs one bounded Claude call, streaming progress chunks to the workflow's
 *  default writable stream as it goes, and returns the generated text. */
async function callClaude(
  system: string,
  resolved: ResolvedMessage[],
  passLabel: "first-half" | "second-half",
): Promise<{ text: string; stopReason: string | null }> {
  "use step";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new FatalError("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });
  const messagesWithCache = withCacheBreakpoint(resolved);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS_PER_PASS,
    system,
    messages: messagesWithCache as Anthropic.MessageParam[],
  });

  const writable = getWritable<NuancedAnalysisChunk>();
  const writer = writable.getWriter();

  try {
    let thinkingDeltaCount = 0;
    stream.on("thinking", () => {
      thinkingDeltaCount++;
      if (thinkingDeltaCount % THINKING_PROGRESS_EVERY_N_DELTAS === 1) {
        void writer.write({ type: "progress", phase: `${passLabel}:thinking` });
      }
    });
    stream.on("text", (_delta, snapshot) => {
      void writer.write({ type: "progress", phase: `${passLabel}:writing`, charCount: snapshot.length });
    });

    const response = await stream.finalMessage();

    const blocksSummary = response.content
      .map((b) => (b.type === "text" ? `text(${b.text.length} chars)` : b.type))
      .join(", ");
    console.log(
      `[nuanced-analysis-workflow] ${passLabel} stop_reason=${response.stop_reason} blocks=[${blocksSummary}] usage=${JSON.stringify(response.usage)}`,
    );

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return { text: textBlock?.text ?? "", stopReason: response.stop_reason };
  } finally {
    writer.releaseLock();
  }
}

async function writeChunk(chunk: NuancedAnalysisChunk) {
  "use step";

  const writable = getWritable<NuancedAnalysisChunk>();
  const writer = writable.getWriter();
  try {
    await writer.write(chunk);
  } finally {
    writer.releaseLock();
  }
}

async function closeStream() {
  "use step";
  await getWritable<NuancedAnalysisChunk>().close();
}

async function cleanupAttachments(paths: string[]) {
  "use step";
  if (paths.length === 0) return;
  const supabase = getServiceSupabase();
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).remove(paths);
  if (error) console.error("[nuanced-analysis-workflow] cleanup failed for", paths, error.message);
}

// ── Workflow ──────────────────────────────────────────────────────────────

export async function generateNuancedAnalysis(
  system: string,
  messages: IncomingMessage[],
): Promise<NuancedAnalysisResult> {
  "use workflow";

  await writeChunk({ type: "progress", phase: "resolving-attachments" });

  let resolved: ResolvedMessage[];
  let paths: string[];
  try {
    const result = await resolveAttachments(messages);
    resolved = result.resolved;
    paths = result.paths;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve attachments";
    await writeChunk({ type: "error", message });
    await closeStream();
    return { text: "", stopReason: null, error: message };
  }

  let firstPass: { text: string; stopReason: string | null };
  try {
    firstPass = await callClaude(system, withFirstPassHint(resolved), "first-half");
  } catch (err) {
    await cleanupAttachments(paths);
    const message = err instanceof Error ? err.message : "Generation failed (first pass)";
    await writeChunk({ type: "error", message });
    await closeStream();
    return { text: "", stopReason: null, error: message };
  }

  const continuationMessages: ResolvedMessage[] = [
    ...resolved,
    { role: "assistant", content: firstPass.text },
    { role: "user", content: CONTINUATION_INSTRUCTION },
  ];

  let secondPass: { text: string; stopReason: string | null };
  try {
    secondPass = await callClaude(system, continuationMessages, "second-half");
  } catch (err) {
    await cleanupAttachments(paths);
    const message = err instanceof Error ? err.message : "Generation failed (second pass)";
    await writeChunk({ type: "error", message });
    await closeStream();
    return { text: "", stopReason: null, error: message };
  }

  await cleanupAttachments(paths);
  await writeChunk({ type: "done", text: secondPass.text, stopReason: secondPass.stopReason });
  await closeStream();

  return { text: secondPass.text, stopReason: secondPass.stopReason, error: null };
}
