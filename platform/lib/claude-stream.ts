/**
 * claude-stream.ts
 * -----------------------------------------------------------------------------
 * Reading what POST /api/claude actually returns.
 *
 * That route stopped being a JSON endpoint in #164: it starts a durable
 * workflow and streams Server-Sent Events back (lib/workflow-sse.ts). Every
 * caller that kept doing `await response.json()` has been broken since, and
 * fails with a message nobody can act on --
 *
 *     Unexpected token 'e', "event: pro"... is not valid JSON
 *
 * -- because the first bytes off the wire are `event: progress`. The reader
 * below was written for the Activity Generator and has survived production:
 * it parses the frames, keeps reconnecting through the ~121s idle timeout
 * that cuts these connections, and races every reconnect against
 * /api/claude/status so a run that finished on the server is never lost just
 * because a socket died. Moved out of activity-generator.tsx unchanged so the
 * other five callers stop reinventing (or, as it turned out, skipping) it.
 *
 * The `done` frame carries `{ message: <the old JSON body> }`, so a caller
 * that used to write
 *
 *     const data = (await response.json()) as ClaudeResponse;
 *
 * now writes
 *
 *     const data = await readClaudeStream(response);
 *
 * and everything downstream of that line is unchanged.
 * -----------------------------------------------------------------------------
 */

import type { ClaudeResponse } from "@/lib/assignments";

/**
 * The run outlived the page's patience, not the other way round.
 *
 * Thrown only when the status route has been READ successfully and still says
 * running. Callers should treat it as "come back later", never as a failure:
 * the packet is still coming.
 */
export class GenerationStillRunningError extends Error {
  readonly stillRunning = true;
  constructor(message: string) {
    super(message);
    this.name = "GenerationStillRunningError";
  }
}

/** What the generator is doing right now, for callers that show progress. */
export type GenerationProgress = { phase: string; charCount?: number };

type StreamOutcome =
  | { status: "done"; message: ClaudeResponse }
  | { status: "error"; message: string }
  | { status: "disconnected" };

/**
 * Reads one SSE response until it signals completion/error, or the
 * connection ends without either. Increments chunkCountRef for every frame
 * successfully parsed, so a caller can resume from exactly that position if
 * the connection dropped mid-generation.
 *
 * Frames look like:
 *   event: progress\ndata: {"phase":"resolving-attachments"}\n\n
 *   event: progress\ndata: {"phase":"first-half:thinking"}\n\n
 *   event: progress\ndata: {"phase":"first-half:writing","charCount":1234}\n\n
 *   event: progress\ndata: {"phase":"second-half:thinking"}\n\n
 *   event: progress\ndata: {"phase":"second-half:writing","charCount":5678}\n\n
 *   event: done\ndata: {"message": <full ClaudeResponse>}\n\n
 *   event: error\ndata: {"message": "..."}\n\n
 */
async function readOneStream(
  res: Response,
  onProgress: (info: GenerationProgress) => void,
  chunkCountRef: { current: number },
): Promise<StreamOutcome> {
  const reader = res.body?.getReader();
  if (!reader) {
    // No streaming body support in this environment — fall back to a plain
    // JSON parse rather than hanging forever.
    return { status: "done", message: (await res.json()) as ClaudeResponse };
  }

  const decoder = new TextDecoder();
  let buffer = "";

  // EVERY exit from this loop is a RETURNED value, never a throw. That is the
  // single most load-bearing line in this file.
  //
  // Chromium rejects a pending reader.read() with TypeError("network error")
  // -- that exact lowercase string -- the moment the response body is cut
  // mid-stream: a closing lid, a dropped wifi connection, a VPN flap, an RST.
  // It used to propagate straight out of here, past the status poll below,
  // past the reconnect, past the deadline, and out of readClaudeStream into
  // the caller's catch, where the Activity Generator printed it in a red box.
  //
  // That is backwards in the worst way. Every one of those recovery
  // mechanisms is reachable ONLY when this function RETURNS -- they consume a
  // StreamOutcome, and a throw is not one. So the whole "poll ground truth so
  // a finished packet is never lost" design, which the block comment below
  // describes at length, was bypassed in exactly the case it exists for: the
  // socket dying abruptly rather than politely. The run itself was usually
  // alive and went on to write its packet to nuanced_generation_runs, which
  // nobody ever read.
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawFrame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const eventMatch = rawFrame.match(/^event: (.+)$/m);
        const dataMatch = rawFrame.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;

        let data: unknown;
        try {
          data = JSON.parse(dataMatch[1]);
        } catch {
          continue;
        }
        chunkCountRef.current++;

        if (eventMatch[1] === "progress") {
          onProgress(data as GenerationProgress);
        } else if (eventMatch[1] === "done") {
          await cancelQuietly(reader);
          return { status: "done", message: (data as { message: ClaudeResponse }).message };
        } else if (eventMatch[1] === "error") {
          await cancelQuietly(reader);
          // NOT terminal on its own. lib/workflow-sse.ts re-badges ANY failure
          // of its own server-side reader as an error frame, so this can be an
          // infrastructure string about a run that is still going. The caller
          // checks the database before believing it.
          return { status: "error", message: (data as { message?: string }).message ?? "Claude API error" };
        }
      }

      if (done) break;
    }
  } catch {
    // Transport died. Not a generation failure, and not this function's to
    // judge -- hand the caller a disconnect and let the status poll decide.
    return { status: "disconnected" };
  } finally {
    // releaseLock() alone would leave the body neither drained nor cancelled,
    // and the old code never released at all: a failed resume re-entered this
    // function with the same Response, and getReader() threw on the still
    // locked stream one iteration later.
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancelQuietly on the done/error paths.
    }
  }

  await cancelQuietly(reader);
  return { status: "disconnected" };
}

/** Cancel a reader without letting the cancellation itself become an error. */
async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The stream is already gone, which is the outcome we wanted anyway.
  }
}

// Reconnecting is now a best-effort way to keep live progress flowing, NOT
// how the result is delivered. Two production failures made that split
// necessary (2026-08-17 logs):
//
//   1. Connections were being cut at ~121s by an idle timeout, not at the
//      route's 300s maxDuration. The old budget of 6 fixed reconnects was
//      sized on the 300s assumption ("covers ~30 minutes"); it actually
//      covered 12, and that is exactly when the user saw an error.
//   2. Worse, the old code treated running out of reconnects as terminal
//      failure and discarded everything - even though the workflow had
//      finished successfully and the packet was sitting on the server.
//
// So: keep reconnecting until a wall-clock deadline, with backoff, and in
// parallel poll /api/claude/status/[generationId] for ground truth. A
// completed run is picked up by the poller no matter how many sockets died,
// and a genuinely failed run is reported within one poll interval instead of
// after a long retry budget.
const GENERATION_DEADLINE_MS = 25 * 60 * 1000;
const STATUS_POLL_INTERVAL_MS = 4000;
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 8000];

type RunStatus = {
  status: "running" | "succeeded" | "failed" | "unknown" | "unreachable";
  phase?: string | null;
  passCount?: number | null;
  charCount?: number | null;
  text?: string | null;
  error?: string | null;
};

/**
 * Ground truth, or an honest admission that we could not reach it.
 *
 * The distinction matters more than it looks. This used to return null for a
 * 500, a 401 and a network failure alike, which is the same value it returns
 * for "no such run" -- so an unreachable status route was indistinguishable
 * from a run that never existed. Anything deciding to give up on a packet has
 * to be able to tell those apart.
 */
async function fetchRunStatus(generationId: string): Promise<RunStatus | null> {
  try {
    const res = await fetch(`/api/claude/status/${generationId}`);
    if (!res.ok) return { status: "unreachable" };
    return (await res.json()) as RunStatus;
  } catch {
    return { status: "unreachable" };
  }
}

/** Wraps a completed run's raw text back into the ClaudeResponse shape the
 *  caller already knows how to unwrap. */
function asClaudeResponse(text: string, stopReason: string | null): ClaudeResponse {
  return {
    content: [{ type: "text", text }],
    stop_reason: stopReason,
  } as unknown as ClaudeResponse;
}

/**
 * Reads the SSE stream /api/claude returns. If the connection drops before a
 * 'done'/'error' frame, reconnects via /api/claude/resume/[runId] - but
 * always races that against a status poll, so the outcome never depends on a
 * socket surviving.
 */
export async function readClaudeStream(
  initialRes: Response,
  /** Optional: most callers only want the finished text. */
  onProgress: (info: GenerationProgress) => void = () => {},
): Promise<ClaudeResponse> {
  const runId = initialRes.headers.get("x-workflow-run-id");
  const generationId = initialRes.headers.get("x-generation-id");
  const chunkCountRef = { current: 0 };
  const startedAt = Date.now();
  let res = initialRes;
  let reconnectIndex = 0;
  let lastPolledAt = 0;
  // Successful reads of the status route. The deadline below refuses to fire
  // until at least one of these has happened, so an offline laptop cannot be
  // mistaken for a stalled generation.
  let provenStatusReads = 0;

  // Checks the server's view of the run. Returns a terminal result if there
  // is one, otherwise null (still running / not yet known).
  async function checkStatus(): Promise<ClaudeResponse | null> {
    if (!generationId) return null;
    lastPolledAt = Date.now();
    const status = await fetchRunStatus(generationId);
    if (!status) return null;

    // An unreachable status route says nothing about the run. Do not let it
    // advance the deadline's evidence count, and never treat it as failure.
    if (status.status === "unreachable") return null;

    provenStatusReads++;
    if (status.status === "succeeded" && status.text) {
      return asClaudeResponse(status.text, "end_turn");
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? "Generation failed on the server.");
    }
    if (status.phase) {
      onProgress({ phase: status.phase, charCount: status.charCount ?? undefined });
    }
    return null;
  }

  while (true) {
    const outcome = await readOneStream(res, onProgress, chunkCountRef);

    if (outcome.status === "done") return outcome.message;

    if (outcome.status === "error") {
      // An error frame is a CLAIM, and the database is the verdict.
      // lib/workflow-sse.ts synthesizes one of these from any failure of its
      // own server-side reader, so the message can be raw infrastructure text
      // about a run that is still going -- or has already succeeded.
      const terminalAfterError = await checkStatus();
      if (terminalAfterError) return terminalAfterError;
      if (provenStatusReads === 0) {
        // Never got a readable row, so this frame is the only evidence there
        // is. Believe it.
        throw new Error(outcome.message);
      }
      // Otherwise the row was readable and did not say failed: the run is
      // alive and the frame was about the socket. Fall through to the
      // reconnect path below, which is what a disconnect does anyway.
    }

    // Disconnected without a completion signal. Before deciding anything,
    // ask the server what actually happened - the run may well have
    // finished while this socket was dying.
    const terminal = await checkStatus();
    if (terminal) return terminal;

    // The deadline is about a stalled RUN, so it may only fire on evidence
    // that the run is stalled. Date.now() counts time the laptop spent
    // suspended, and a wall clock alone cannot tell "generating for 25
    // minutes" from "shut for 25 minutes" -- the second is the case the
    // teacher was promised would work.
    if (Date.now() - startedAt > GENERATION_DEADLINE_MS && provenStatusReads > 0) {
      throw new GenerationStillRunningError(
        `This generation has been going for over ${Math.round(GENERATION_DEADLINE_MS / 60000)} minutes. It is still running on the server and will finish without this page open - reopen the tab later to collect it.`,
      );
    }

    if (!runId) {
      // Without a run id there is nothing to reconnect to, but a generation id
      // is still pollable -- and polling is the durable path. Only give up
      // when there is neither.
      if (!generationId) {
        throw new Error(
          "The connection closed before generation finished, and no resumable run ID was available to reconnect.",
        );
      }
      await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
      continue;
    }

    const backoff = RECONNECT_BACKOFF_MS[Math.min(reconnectIndex, RECONNECT_BACKOFF_MS.length - 1)];
    reconnectIndex++;
    await new Promise((r) => setTimeout(r, backoff));

    // A slow reconnect shouldn't starve the status poller.
    if (Date.now() - lastPolledAt > STATUS_POLL_INTERVAL_MS) {
      const t = await checkStatus();
      if (t) return t;
    }

    const resumeUrl =
      `/api/claude/resume/${runId}?startIndex=${chunkCountRef.current}` +
      (generationId ? `&generationId=${generationId}` : "");
    // Offline, this rejects with TypeError("Failed to fetch") -- which used to
    // escape readClaudeStream entirely, never reaching the !ok handling
    // written directly below it for exactly this situation.
    let resumeRes: Response | null = null;
    try {
      resumeRes = await fetch(resumeUrl);
    } catch {
      resumeRes = null;
    }

    if (!resumeRes || !resumeRes.ok) {
      // A failed reconnect is not fatal while the run itself may be healthy:
      // fall through, let the deadline and the status poll decide.
      const t = await checkStatus();
      if (t) return t;
      continue;
    }
    res = resumeRes;
  }
}
