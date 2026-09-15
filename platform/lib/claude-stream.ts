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
 *
 * 2026-09-15: the reconnect machinery below only ever ran when a connection
 * ENDED. A connection that BROKE rejected instead, and the rejection escaped
 * every layer of it -- so a teacher lost a finished 33,815-character packet to
 * a two-second network blip while the run sat on the server marked succeeded.
 * The reads and the reconnect fetch are guarded now; see readOneStream's loop
 * for the evidence and for why the guards are as narrow as they are.
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
 * Reads one SSE response until it signals completion/error, or the connection
 * ends OR breaks without either -- both of which report as "disconnected", so
 * the caller's single recovery path covers them equally. Increments
 * chunkCountRef for every frame successfully parsed, so a caller can resume
 * from exactly that position if the connection dropped mid-generation. A frame
 * left half-received when the socket died is simply dropped: it was never
 * counted, so the resume asks for it again.
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
    // JSON parse rather than hanging forever. If even that fails, the body was
    // not a whole JSON document either: that is a dead connection by another
    // name, so hand it to the caller's recovery path instead of throwing.
    try {
      return { status: "done", message: (await res.json()) as ClaudeResponse };
    } catch {
      return { status: "disconnected" };
    }
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    // A dropped connection reaches this reader in one of TWO shapes, and until
    // 2026-09-15 only one of them was handled:
    //
    //   - The socket ENDS. read() resolves with done:true, the loop breaks,
    //     and the caller reconnects and polls status. That path worked.
    //   - The socket BREAKS. read() REJECTS. In Chromium the rejection is
    //     literally `TypeError: network error` (verified directly against a
    //     killed socket -- as distinct from `Failed to fetch`, which is what a
    //     request that never left the browser looks like). That rejection used
    //     to escape this function, escape readClaudeStream's loop, and land in
    //     the caller's catch, which showed the teacher the raw string
    //     "network error" and threw the generation away.
    //
    // Production run a6d6801b (2026-09-15) is what that cost. The connection
    // dropped three times on one packet: the first two ENDED and recovered
    // silently via resume + status poll, the third BROKE -- and the packet the
    // workflow went on to finish 90 seconds later (33,815 chars,
    // status=succeeded, error=NULL) was discarded by a browser that already
    // knew how to go and fetch it. Same network event, opposite outcomes,
    // decided by nothing but which shape the browser happened to use.
    //
    // Both shapes now mean the same thing here: no live stream, ask the
    // server. The catch is wrapped around the read and NOTHING else -- frame
    // parsing, JSON.parse and onProgress stay outside it -- so a genuine bug
    // in this file still surfaces as a bug instead of becoming an endless,
    // silent reconnect loop.
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch {
      return { status: "disconnected" };
    }
    const { done, value } = chunk;
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
  // Null means "no live stream to read right now", which is the state between
  // a dropped connection and a successful reconnect. It has to be a distinct
  // state rather than "still holding the dead Response": readOneStream takes a
  // reader off res.body and never releases the lock, so reading the same
  // Response twice throws `ReadableStream is locked to a reader`. The old
  // `continue` after a failed reconnect did exactly that -- it looped straight
  // back to readOneStream(res) with the spent response -- and turned a
  // recoverable 404 from the resume route into a second raw browser error in
  // the teacher's face. Spent responses are dropped here instead.
  let res: Response | null = initialRes;
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
    if (res) {
      const live = res;
      // Spent the moment it is read: whether it ends, breaks or completes, its
      // body is locked from here on and must never be handed back to
      // readOneStream. Cleared BEFORE the await so every exit path below --
      // including a `continue` from a failed reconnect -- leaves it cleared.
      res = null;
      const outcome = await readOneStream(live, onProgress, chunkCountRef);

      if (outcome.status === "done") return outcome.message;
      if (outcome.status === "error") throw new Error(outcome.message);
    }

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

    // Say we are between connections. checkStatus() above has just pushed the
    // run's server-side phase, so without this the UI would sit on "Thinking
    // through the source material..." for the whole backoff and a recovering
    // generation would be indistinguishable from a frozen one. The resumed
    // stream's own frames overwrite this within a frame or two.
    onProgress({ phase: "reconnecting" });

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
    // Same lesson as the read loop in readOneStream: a reconnect that cannot
    // be made AT ALL (Chromium's `Failed to fetch` -- DNS gone, wifi dropped,
    // proxy refusing) must not be more fatal than one that comes back 404.
    // Both mean the same thing, "no live stream right now", and neither of
    // them is what decides this run's fate: the status poll is.
    let resumeRes: Response;
    try {
      resumeRes = await fetch(resumeUrl);
    } catch {
      const t = await checkStatus();
      if (t) return t;
      continue;
    }

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
