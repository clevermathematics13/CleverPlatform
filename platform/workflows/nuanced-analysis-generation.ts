import { getWritable, FatalError } from "workflow";
import Anthropic from "@anthropic-ai/sdk";
import { createClient as createServiceSupabaseClient } from "@supabase/supabase-js";

/**
 * generateNuancedAnalysis - durable workflow for the AI Activity Generator.
 * ---------------------------------------------------------------------
 * HISTORY OF THIS FILE'S BUGS, so they don't get reintroduced:
 *
 * 1. Originally one giant buffered Claude call in a plain route handler. Hit
 *    Vercel's function ceiling; client saw a bare "Failed to fetch".
 *
 * 2. Moved to Vercel Workflows. Workflows remove the ceiling on TOTAL
 *    workflow duration, but each individual STEP is still its own function
 *    invocation bound by the same ~300s ceiling.
 *
 * 3. Split into two fixed passes. This is the bug this rewrite fixes.
 *    Production logs (2026-08-17) showed:
 *      - first-half:  output_tokens=30852, text=37785 chars
 *      - second-half: output_tokens=16721, text=37785 chars
 *    Identical character counts: pass 1 already produced the COMPLETE packet
 *    and pass 2 spent another ~5 minutes reproducing it verbatim, adding
 *    nothing. Worse, ~two thirds of pass 1's output tokens were extended
 *    thinking (Sonnet 5 has adaptive thinking on by default and this file
 *    never constrained it), so a single pass regularly ran past 300s:
 *      05:39:20 step 504 Task timed out after 300 seconds
 *      05:48:25 step 504  (workflow retry, restarts the call from scratch)
 *      05:57:31 step 504  (retry again)
 *    Each retry re-ran the whole Claude call, so a timeout cost ~9 minutes
 *    and never converged.
 *
 * THE FIX, in three parts:
 *
 *   a) THINKING IS BOUNDED. See CORRECTION below for why this is
 *      output_config.effort rather than a fixed token budget.
 *
 *   b) A PASS CANNOT HIT THE HARD CEILING. SOFT_DEADLINE_MS aborts the
 *      Anthropic stream well before the platform would kill the invocation,
 *      keeping whatever text arrived. A slow pass therefore degrades into a
 *      resumable partial draft instead of a 504 that retries from zero.
 *
 *   c) CONTINUATION IS CONDITIONAL. After each pass, isComplete() checks
 *      whether the model finished cleanly AND emitted parseable JSON. If so
 *      the workflow stops immediately. A continuation pass runs only when
 *      the draft is genuinely unfinished. In the common case this halves
 *      wall-clock time and removes the verbatim-reproduction step that was
 *      corrupting prompts and renumbering questions.
 *
 * CORRECTION (2026-08-17, same day): the first version of this fix used
 * `thinking: { type: "enabled", budget_tokens: N }` to bound reasoning. That
 * is the FIXED-BUDGET thinking interface, and claude-sonnet-5 rejects it
 * outright with a 400:
 *   "thinking.type.enabled" is not supported for this model. Use
 *   "thinking.type.adaptive" and "output_config.effort" to control
 *   thinking behavior.
 * claude-sonnet-5 only accepts ADAPTIVE thinking: `thinking: { type:
 * "adaptive" }` plus a sibling top-level `output_config: { effort: ... }`
 * (not nested inside `thinking`). There is no token-count knob on this
 * model - EFFORT_LEVEL ("low"|"medium"|"high"|"xhigh"|"max") is the
 * equivalent control, and "high" is the closest match to the original
 * 12k-token intent from testing. Every request failed pass-1 with this bug
 * (see nuanced_generation_runs: status=failed, char_count=0), which is also
 * why the error surfacing fix below exists - the client only ever showed
 * "Generation failed (pass-1)", the literal fallback string, because the
 * real 400 message never made it past a truthiness check.
 *
 * Every pass's raw output is logged to nuanced_generation_logs, and run
 * status is mirrored into nuanced_generation_runs so the client can poll
 * ground truth via /api/claude/status/[generationId] rather than inferring
 * run health from whether an SSE socket happens to still be open.
 *
 * CORRECTION 2 (2026-08-17, later the same day): a run hit soft_deadline
 * again with 0 chars, but this time with new diagnostic logging attached:
 *   connected=true connectMs=10003 thinkingDeltas=0 writingDeltas=0
 *   textCharsKept=0 streamErrorSeen=none
 * This ruled out a network stall - the connection opened normally in 10s
 * and stayed open with zero SDK-level errors for the full 235s. The cause
 * is a documented Anthropic behaviour: with adaptive thinking (display
 * defaulting to "summarized"), the model can reason silently for an
 * extended period with no thinking_delta or text streaming out at all,
 * especially at higher effort on cold-start, attachment-heavy prompts (see
 * e.g. github.com/anthropics/claude-code/issues/56356 for another report of
 * the same "reasoning is happening, nothing streams" pattern). Two changes:
 *   - THINKING_DISPLAY set to "omitted" - per Anthropic's own guidance this
 *     reduces time-to-first-token, since the model skips producing a
 *     human-readable thinking summary before starting the visible response.
 *     This file already discarded thinking text either way (progress
 *     pulses only ever signalled that thinking was happening, never showed
 *     it), so there is no functional loss.
 *   - SOFT_DEADLINE_MS raised from 235s to 270s, giving genuinely-thinking
 *     requests more room before this file gives up on them, while keeping
 *     ~30s of margin below the platform's 300s step ceiling.
 */

const UPLOADS_BUCKET = "uploads";

const MODEL = "claude-sonnet-5";

// claude-sonnet-5 only supports adaptive thinking (thinking.type must be
// "adaptive"; the fixed budget_tokens interface is rejected with a 400 -
// see the CORRECTION note above). "high" is the closest available control to
// the original 12k-token intent: enough room to plan a multi-section IB
// packet without licensing unbounded reasoning. Valid values are "low",
// "medium", "high", "xhigh", "max".
const EFFORT_LEVEL: Anthropic.OutputConfig["effort"] = "high";

// A full packet's JSON has measured at roughly 10-12k tokens; this leaves
// comfortable headroom for a complete packet in one pass without licensing
// an unbounded one.
const MAX_TOKENS_PER_PASS = 24000;

// Abort the Anthropic stream at this point and keep the partial text. Must
// stay comfortably below the platform's per-invocation ceiling (300s) with
// enough slack for the surrounding step work (logging, status writes).
//
// RAISED from 235_000 (2026-08-17, same day as the deadline was first
// added): a run logged connected=true, connectMs=10003, thinkingDeltas=0,
// writingDeltas=0, textCharsKept=0, streamErrorSeen=none after the full
// 235s. That is not a network stall - the connection opened normally and
// stayed open the whole time with zero SDK-level error. It matches a
// documented Anthropic behaviour: with adaptive thinking, the model can
// reason silently for an extended period before any thinking_delta or text
// content streams out, particularly at higher effort levels on cold-start,
// attachment-heavy prompts. See THINKING_DISPLAY below for the other half
// of this fix. 270s leaves ~30s of margin below the platform's 300s step
// ceiling for post-stream cleanup (logGeneration, recordRunStatus) while
// giving genuinely-thinking requests meaningfully more room than 235s did.
const SOFT_DEADLINE_MS = 270_000;

// Controls whether thinking content streams as visible thinking_delta
// events ("summarized", the SDK default) or is generated but not streamed
// ("omitted", only a signature streams). Set to "omitted" because Anthropic's
// own adaptive-thinking guidance states this reduces time-to-first-token:
// the model doesn't pause to produce a human-readable summary of its
// reasoning before starting the visible text response. This file was
// already discarding thinking content anyway (progress pulses only report
// that SOME thinking is happening, never the text itself), so there is no
// loss from omitting it - only a chance at faster, more visible progress
// during exactly the silent-thinking window that caused the soft_deadline
// failures above.
const THINKING_DISPLAY: Anthropic.ThinkingConfigAdaptive["display"] = "omitted";

// Hard stop on continuation passes, so a model that never returns valid
// JSON can't loop forever.
const MAX_PASSES = 4;

// Both kinds of delta fire very frequently - Anthropic's streaming API can
// emit a text delta every few characters, so one SSE frame per delta floods
// the proxying connection with far more frames than a "still working"
// indicator needs. Only every Nth delta is forwarded as a pulse.
const THINKING_PROGRESS_EVERY_N_DELTAS = 40;
const WRITING_PROGRESS_EVERY_N_DELTAS = 40;

const FIRST_PASS_HINT = [
  "",
  "",
  "[Multi-pass generation note: aim to complete this request fully in this one response. If fully completing it would require an unusually long response, it is fine to generate as much as you can and stop with valid JSON containing just the sections you finished - a continuation pass will pick up from exactly where you leave off, so never compress, summarise, or rush content in order to fit everything into this pass.]",
].join("\n");

const CONTINUATION_INSTRUCTION = [
  "Above is a draft of this Nuanced Analysis packet from a previous generation pass, as a raw JSON object. It stopped before it was finished.",
  "",
  "Continue it: add the remaining parts and sections that are still missing, in the same voice and thread as what is already there, without repeating or contradicting anything already written.",
  "",
  "CRITICAL - when reproducing the prior draft's content in your final JSON, copy every existing question's prompt text VERBATIM and IN FULL, including its final instruction sentence (the sentence containing the IB command term: Find, Show that, Compare, Sketch, State, Hence, ...). Do not summarise, shorten, paraphrase, or truncate any reproduced prompt, and never drop the command-term sentence from the end of a prompt - a question whose prompt sets up a scenario but never issues an instruction is broken and unusable. Every question and subpart in your final JSON must end with an explicit instruction sentence.",
  "",
  "Likewise, do not drop, merge, reorder, or renumber any question, subpart, or section that already exists in the prior draft. The final packet must contain every question from the prior draft, unchanged and in the same order, plus whatever you add after them. If any prompts contain their own question numbers, the final visible numbering must be consecutive with no gaps and no duplicates.",
  "",
  "Respond with ONLY a single, complete, final JSON object for the ENTIRE packet - merging the prior draft's content with anything you add. Same JSON schema and rules as before. No markdown, no preamble.",
].join("\n");

// -- Content block types (mirrors the shapes the client sends / route resolves) --

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

type PassLabel = string;
type PassOutcome = { text: string; stopReason: string | null };

/**
 * Pulls a human-readable message out of whatever a failed step throws.
 *
 * WHY THIS EXISTS: the client showed the literal fallback string
 * "Generation failed (pass-1)" - with no indication a 400 invalid_request
 * error (wrong thinking-config shape) was the actual cause - because a
 * plain `err instanceof Error ? err.message : fallback` check isn't enough
 * here. Two things can defeat it:
 *   1. The Vercel Workflow runtime retries a failing step automatically
 *      (its own logs: "Max retries reached, bubbling error to parent
 *      workflow"), and the object it re-throws to the workflow body after
 *      exhausting retries is not guaranteed to be the original Error
 *      instance with a populated .message - it may be a wrapper whose own
 *      .message is empty while the real cause lives in .cause, a nested
 *      .error.message, or only in its .toString()/stack.
 *   2. Anthropic's own APIError can likewise carry the useful text in
 *      err.error.error.message (the parsed response body) rather than the
 *      top-level .message in some SDK versions/paths.
 * This checks several plausible locations before falling back, so a future
 * API error is at minimum visible enough to diagnose from the run's stored
 * error column without needing a Vercel log dive.
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;

  if (err && typeof err === "object") {
    const withCause = err as { cause?: unknown };
    if (withCause.cause instanceof Error && withCause.cause.message) {
      return withCause.cause.message;
    }
    const withNestedError = err as { error?: { message?: unknown; error?: { message?: unknown } } };
    if (typeof withNestedError.error?.message === "string" && withNestedError.error.message) {
      return withNestedError.error.message;
    }
    if (typeof withNestedError.error?.error?.message === "string" && withNestedError.error.error.message) {
      return withNestedError.error.error.message;
    }
    if (err instanceof Error && typeof err.stack === "string" && err.stack.trim()) {
      // Better than nothing: the raw stack often contains the upstream
      // API's JSON error body even when .message is empty.
      return err.stack.split("\n")[0] || fallback;
    }
  }

  if (typeof err === "string" && err) return err;

  return fallback;
}

function getServiceSupabase() {
  return createServiceSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// -- Completeness detection -------------------------------------------------

/**
 * Pulls the outermost {...} out of a model response that may be wrapped in
 * prose or markdown fences. Deliberately simple and dependency-free: this
 * runs inside a workflow step, and it only needs to answer "did the model
 * emit a syntactically whole JSON object", not to fully validate the schema
 * (the client's parseAssignmentDraftJson does that).
 */
function extractOutermostJson(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * A pass is complete when the model chose to stop on its own AND left behind
 * a parseable JSON object. Either condition failing means a continuation
 * pass is warranted:
 *   - stopReason "max_tokens" or "soft_deadline": ran out of room mid-draft
 *   - unparseable JSON: truncated mid-structure even if it claimed end_turn
 */
function isComplete(outcome: PassOutcome): boolean {
  if (outcome.stopReason !== "end_turn") return false;
  const json = extractOutermostJson(outcome.text);
  if (!json) return false;
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

// -- Steps -----------------------------------------------------------------

/**
 * Downloads and base64-encodes every image_ref/document_ref block in
 * `messages`, returning both the resolved messages and the storage paths
 * touched (for later cleanup). Runs with the Supabase service-role key -
 * steps execute outside the original request's cookie session, so the
 * cookie-based client the route handler used isn't available here.
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
      // Not retryable - the path won't start existing on a retry.
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

/** Appends the multi-pass hint to the last user message, so only the opening
 *  pass is told it may stop partway. */
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
 *  prompt-cache breakpoint, so a continuation pass doesn't pay full price to
 *  re-ingest the same PDFs and images. Note the default ephemeral TTL is 5
 *  minutes: this only pays off because SOFT_DEADLINE_MS now caps a pass at
 *  under 4 minutes. Under the old unbounded design the first pass routinely
 *  ran longer than the TTL, which is why production logs showed
 *  cache_read_input_tokens=0 on every single continuation. */
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

/**
 * Runs one bounded Claude call, streaming progress chunks as it goes.
 *
 * Returns stopReason "soft_deadline" when SOFT_DEADLINE_MS elapsed and the
 * stream was aborted; callers treat that exactly like "max_tokens" - an
 * unfinished draft to be continued, not an error.
 */
async function callClaude(
  system: string,
  resolved: ResolvedMessage[],
  passLabel: PassLabel,
): Promise<PassOutcome> {
  "use step";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new FatalError("ANTHROPIC_API_KEY not set");

  // maxRetries and timeout are set explicitly rather than left at SDK
  // defaults (timeout: 10 minutes, maxRetries: 2) for two reasons:
  //   1. The SDK's own docs warn request timeouts are retried by default,
  //      "so in a worst-case scenario you may wait much longer than this
  //      timeout" - and that retrying happens silently inside the SDK, with
  //      no visibility from this file. A run that logged 0 chars after the
  //      full SOFT_DEADLINE_MS could plausibly have been the SDK silently
  //      retrying a stalled connection the whole time.
  //   2. SOFT_DEADLINE_MS (235s) is well under the 10-minute SDK default,
  //      so this file's own deadline was always going to fire first in
  //      practice - but a low per-request timeout here means a genuinely
  //      stalled connection gets retried (and logged) quickly, rather than
  //      sitting silently until the outer deadline finally cuts it off.
  //      timeout only bounds each individual fetch attempt - the SDK's
  //      fetchWithTimeout clears the timer as soon as fetch() resolves
  //      (i.e. once HTTP headers arrive), so an already-connected, actively
  //      streaming response is unaffected regardless of how slowly Claude
  //      produces tokens.
  const client = new Anthropic({
    apiKey,
    maxRetries: 2,
    timeout: 60_000,
    fetch: async (url, init) => {
      const attemptStartedAt = Date.now();
      try {
        return await fetch(url, init);
      } catch (err) {
        // A network-level failure here (not an HTTP error status - those
        // don't throw) is exactly the silent-stall case this logging
        // exists for. The SDK will retry it per maxRetries above; this
        // makes each attempt visible instead of only the final outcome.
        console.warn(
          `[nuanced-analysis-workflow] ${passLabel} fetch to Anthropic failed after ${Date.now() - attemptStartedAt}ms:`,
          err instanceof Error ? err.message : err,
        );
        throw err;
      }
    },
  });
  const messagesWithCache = withCacheBreakpoint(resolved);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS_PER_PASS,
    thinking: { type: "adaptive", display: THINKING_DISPLAY },
    output_config: { effort: EFFORT_LEVEL },
    system,
    messages: messagesWithCache as Anthropic.MessageParam[],
  });

  const writable = getWritable<NuancedAnalysisChunk>();
  const writer = writable.getWriter();

  // Progress writes used to be fire-and-forget (`void writer.write(...)`)
  // while releaseLock() ran in a finally block the instant finalMessage()
  // resolved - so in-flight writes could be dropped or reject after the lock
  // was gone. Every write is tracked and settled before the lock is released.
  const pendingWrites: Promise<unknown>[] = [];
  function emit(chunk: NuancedAnalysisChunk) {
    pendingWrites.push(writer.write(chunk).catch(() => undefined));
  }

  let latestSnapshot = "";
  let timedOut = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const passStartedAt = Date.now();
  let connectedAt: number | null = null;
  let thinkingDeltaCount = 0;
  let writingDeltaCount = 0;
  let streamErrorSeen: string | null = null;

  try {
    // WHY THESE THREE LISTENERS EXIST (added 2026-08-17): a run failed with
    // stop_reason=soft_deadline and 0 chars after the full 235s budget, with
    // nothing in the logs to say whether the request ever reached Anthropic
    // at all. Two very different problems produce that same symptom:
    //   1. The HTTP request itself never connected/stalled - plausible given
    //      the Anthropic SDK's documented behaviour that "request timeouts
    //      are retried by default" (maxRetries: 2), which happens silently
    //      inside the SDK with no visibility from this code.
    //   2. The request connected fine and Claude was genuinely thinking (or
    //      stuck) in silence for the full budget - large-attachment,
    //      cold-start prompts at effort:"high" can plausibly run long.
    // 'connect' fires on HTTP response headers, before any content -
    // logging it splits these two cases cleanly next time this happens.
    // 'error' is a distinct event from the promise rejection callClaude
    // already catches; without a listener here, an error surfaced only via
    // the event (rather than by rejecting stream.finalMessage()) would have
    // been silently dropped instead of ending up in extractErrorMessage().
    stream.on("connect", () => {
      connectedAt = Date.now();
      console.log(
        `[nuanced-analysis-workflow] ${passLabel} connected after ${connectedAt - passStartedAt}ms`,
      );
    });

    stream.on("error", (err) => {
      streamErrorSeen = err instanceof Error ? err.message : String(err);
      console.error(`[nuanced-analysis-workflow] ${passLabel} stream error event:`, err);
    });

    stream.on("thinking", () => {
      thinkingDeltaCount++;
      if (thinkingDeltaCount % THINKING_PROGRESS_EVERY_N_DELTAS === 1) {
        emit({ type: "progress", phase: `${passLabel}:thinking` });
      }
    });

    stream.on("text", (_delta, snapshot) => {
      latestSnapshot = snapshot;
      writingDeltaCount++;
      if (writingDeltaCount % WRITING_PROGRESS_EVERY_N_DELTAS === 1) {
        emit({ type: "progress", phase: `${passLabel}:writing`, charCount: snapshot.length });
      }
    });

    deadlineTimer = setTimeout(() => {
      timedOut = true;
      // Every field needed to tell "never connected" apart from "connected
      // but silent" apart from "connected, thinking happened, but produced
      // no visible text" is logged together here rather than split across
      // separate lines, so a future occurrence is diagnosable from one line.
      // NOTE: with THINKING_DISPLAY = "omitted" (see above), thinkingDeltas
      // will legitimately always read 0 - omitted mode never streams
      // thinking_delta events at all, only a final signature. A 0 here no
      // longer distinguishes "not thinking" from "thinking but not shown";
      // connectMs and streamErrorSeen remain the meaningful signals.
      console.log(
        `[nuanced-analysis-workflow] ${passLabel} soft deadline reached at ${SOFT_DEADLINE_MS}ms - ` +
          `connected=${connectedAt !== null} ` +
          `connectMs=${connectedAt !== null ? connectedAt - passStartedAt : "n/a"} ` +
          `thinkingDeltas=${thinkingDeltaCount} writingDeltas=${writingDeltaCount} ` +
          `textCharsKept=${latestSnapshot.length} streamErrorSeen=${streamErrorSeen ?? "none"}`,
      );
      stream.abort();
    }, SOFT_DEADLINE_MS);

    let response: Anthropic.Message | null = null;
    try {
      response = await stream.finalMessage();
    } catch (err) {
      // An abort we triggered ourselves is an expected outcome, not a
      // failure: hand the partial draft back for continuation. Anything
      // else is a real error and must propagate.
      if (!timedOut) throw err;
    }

    if (timedOut || !response) {
      emit({ type: "progress", phase: `${passLabel}:deadline-reached`, charCount: latestSnapshot.length });
      return { text: latestSnapshot, stopReason: "soft_deadline" };
    }

    const blocksSummary = response.content
      .map((b) => (b.type === "text" ? `text(${b.text.length} chars)` : b.type))
      .join(", ");
    console.log(
      `[nuanced-analysis-workflow] ${passLabel} stop_reason=${response.stop_reason} blocks=[${blocksSummary}] usage=${JSON.stringify(response.usage)}`,
    );

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return { text: textBlock?.text ?? latestSnapshot, stopReason: response.stop_reason };
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    await Promise.allSettled(pendingWrites);
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

/**
 * Mirrors run state into nuanced_generation_runs. This is what
 * /api/claude/status/[generationId] reads, and it is the whole reason the
 * client no longer has to guess whether a silent connection means "still
 * working" or "died 8 minutes ago". Best-effort: a status-write failure must
 * never take down a generation that is otherwise fine.
 */
async function recordRunStatus(
  generationId: string,
  patch: {
    status?: "running" | "succeeded" | "failed";
    phase?: string;
    passCount?: number;
    charCount?: number;
    resultText?: string | null;
    error?: string | null;
  },
) {
  "use step";
  try {
    const supabase = getServiceSupabase();
    const row: Record<string, unknown> = { run_id: generationId };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.phase !== undefined) row.phase = patch.phase;
    if (patch.passCount !== undefined) row.pass_count = patch.passCount;
    if (patch.charCount !== undefined) row.char_count = patch.charCount;
    if (patch.resultText !== undefined) row.result_text = patch.resultText;
    if (patch.error !== undefined) row.error = patch.error;

    const { error } = await supabase
      .from("nuanced_generation_runs")
      .upsert(row, { onConflict: "run_id" });
    if (error) {
      console.error("[nuanced-analysis-workflow] run status upsert failed:", error.message);
    }
  } catch (e) {
    console.error(
      "[nuanced-analysis-workflow] run status step failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Persists the raw output of one generation pass to nuanced_generation_logs.
 * WHY: a generation that's never explicitly saved ("Save as Nuanced
 * Analysis") used to leave no trace at all - when a downloaded packet later
 * turned out to have truncated prompts, there was no raw JSON left to
 * diagnose against. Best-effort by design.
 */
async function logGeneration(
  pass: string,
  text: string,
  stopReason: string | null,
  errorMessage: string | null,
) {
  "use step";
  try {
    const supabase = getServiceSupabase();
    const { error } = await supabase.from("nuanced_generation_logs").insert({
      source: "activity-generator-workflow",
      pass,
      model: MODEL,
      stop_reason: stopReason,
      char_count: text.length,
      raw_text: text,
      error: errorMessage,
    });
    if (error) {
      console.error("[nuanced-analysis-workflow] generation log insert failed:", error.message);
    }
  } catch (e) {
    console.error(
      "[nuanced-analysis-workflow] generation log step failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

// -- Workflow --------------------------------------------------------------

export async function generateNuancedAnalysis(
  generationId: string,
  system: string,
  messages: IncomingMessage[],
): Promise<NuancedAnalysisResult> {
  "use workflow";

  async function fail(message: string, paths: string[] | null) {
    if (paths) await cleanupAttachments(paths);
    await recordRunStatus(generationId, { status: "failed", phase: "failed", error: message });
    await writeChunk({ type: "error", message });
    await closeStream();
    return { text: "", stopReason: null, error: message };
  }

  await recordRunStatus(generationId, { status: "running", phase: "resolving-attachments" });
  await writeChunk({ type: "progress", phase: "resolving-attachments" });

  let resolved: ResolvedMessage[];
  let paths: string[];
  try {
    const result = await resolveAttachments(messages);
    resolved = result.resolved;
    paths = result.paths;
  } catch (err) {
    const message = extractErrorMessage(err, "Failed to resolve attachments");
    return fail(message, null);
  }

  // Pass 1, then continuation passes only for as long as the draft is
  // genuinely unfinished. In the common case this loop runs exactly once.
  let conversation: ResolvedMessage[] = withFirstPassHint(resolved);
  let outcome: PassOutcome = { text: "", stopReason: null };
  let passNumber = 0;

  while (passNumber < MAX_PASSES) {
    passNumber++;
    const passLabel = passNumber === 1 ? "pass-1" : `pass-${passNumber}-continuation`;

    await recordRunStatus(generationId, { phase: passLabel, passCount: passNumber });

    try {
      outcome = await callClaude(system, conversation, passLabel);
      await logGeneration(passLabel, outcome.text, outcome.stopReason, null);
    } catch (err) {
      const message = extractErrorMessage(err, `Generation failed (${passLabel})`);
      // Logged once here, in addition to whatever the workflow runtime
      // already logged, specifically so a future "fallback string with no
      // detail" report can be cross-checked against the raw shape rather
      // than guessed at again.
      console.error(`[nuanced-analysis-workflow] ${passLabel} failed, raw error:`, err);
      await logGeneration(passLabel, "", null, message);
      return fail(message, paths);
    }

    await recordRunStatus(generationId, { charCount: outcome.text.length });

    if (isComplete(outcome)) break;

    if (!outcome.text.trim()) {
      return fail(
        `Generation produced no usable output on ${passLabel} (stop reason: ${outcome.stopReason ?? "unknown"}).`,
        paths,
      );
    }

    if (passNumber === MAX_PASSES) {
      console.warn(
        `[nuanced-analysis-workflow] exhausted ${MAX_PASSES} passes without a complete draft; returning the best available text (${outcome.text.length} chars, stop_reason=${outcome.stopReason})`,
      );
      break;
    }

    // Trailing whitespace on an assistant turn is rejected by the API.
    conversation = [
      ...resolved,
      { role: "assistant", content: outcome.text.trimEnd() },
      { role: "user", content: CONTINUATION_INSTRUCTION },
    ];
  }

  await cleanupAttachments(paths);
  await recordRunStatus(generationId, {
    status: "succeeded",
    phase: "done",
    charCount: outcome.text.length,
    resultText: outcome.text,
    error: null,
  });
  await writeChunk({ type: "done", text: outcome.text, stopReason: outcome.stopReason });
  await closeStream();

  return { text: outcome.text, stopReason: outcome.stopReason, error: null };
}
