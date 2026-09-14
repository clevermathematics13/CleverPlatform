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
        return { status: "done", message: (data as { message: ClaudeResponse }).message };
      } else if (eventMatch[1] === "error") {
        return { status: "error", message: (data as { message?: string }).message ?? "Claude API error" };
      }
    }

    if (done) break;
  }

  return { status: "disconnected" };
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
  status: "running" | "succeeded" | "failed" | "unknown";
  phase?: string | null;
  passCount?: number | null;
  charCount?: number | null;
  text?: string | null;
  error?: string | null;
};

async function fetchRunStatus(generationId: string): Promise<RunStatus | null> {
  try {
    const res = await fetch(`/api/claude/status/${generationId}`);
    if (!res.ok) return null;
    return (await res.json()) as RunStatus;
  } catch {
    return null;
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

  // Checks the server's view of the run. Returns a terminal result if there
  // is one, otherwise null (still running / not yet known).
  async function checkStatus(): Promise<ClaudeResponse | null> {
    if (!generationId) return null;
    lastPolledAt = Date.now();
    const status = await fetchRunStatus(generationId);
    if (!status) return null;

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
    if (outcome.status === "error") throw new Error(outcome.message);

    // Disconnected without a completion signal. Before deciding anything,
    // ask the server what actually happened - the run may well have
    // finished while this socket was dying.
    const terminal = await checkStatus();
    if (terminal) return terminal;

    if (Date.now() - startedAt > GENERATION_DEADLINE_MS) {
      throw new Error(
        "Generation has been running for over 25 minutes without completing. The run may still finish on the server - reopen this page shortly and it can be recovered. If it keeps happening, reduce the scope of the request.",
      );
    }

    if (!runId) {
      throw new Error(
        "The connection closed before generation finished, and no resumable run ID was available to reconnect.",
      );
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
    const resumeRes = await fetch(resumeUrl);

    if (!resumeRes.ok) {
      // A failed reconnect is not fatal while the run itself may be healthy:
      // fall through, let the deadline and the status poll decide.
      const t = await checkStatus();
      if (t) return t;
      continue;
    }
    res = resumeRes;
  }
}
