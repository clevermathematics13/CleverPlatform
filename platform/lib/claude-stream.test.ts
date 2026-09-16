/**
 * claude-stream.test.ts
 * -----------------------------------------------------------------------------
 * The one behaviour worth pinning here: a dead socket must never be reported
 * as a failed generation.
 *
 * The bug these cover was reproduced in Chromium. When a fetch response body
 * is cut mid-read, reader.read() rejects with TypeError("network error") --
 * that exact lowercase string, which is what a teacher saw in a red box on
 * production. It escaped because every recovery mechanism in this module
 * (status poll, reconnect, deadline) is reachable only when readOneStream
 * RETURNS a StreamOutcome, and a throw is not one.
 *
 * So these tests drive readClaudeStream with streams that fail the way the
 * real ones fail, and assert it resolves from the database instead.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readClaudeStream, GenerationStillRunningError } from "./claude-stream";

const GEN_ID = "gen-1";
const RUN_ID = "run-1";

/** A Response whose body yields the given frames, then fails the way a cut
 *  connection fails: the pending read rejects rather than ending politely. */
function severedResponse(frames: string[], error: Error): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(encoder.encode(frames[i++]));
        return;
      }
      controller.error(error);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "x-workflow-run-id": RUN_ID, "x-generation-id": GEN_ID },
  });
}

function frameResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "x-workflow-run-id": RUN_ID, "x-generation-id": GEN_ID },
  });
}

function doneFrame(text: string): string {
  return `event: done\ndata: ${JSON.stringify({
    message: { content: [{ type: "text", text }], stop_reason: "end_turn" },
  })}\n\n`;
}

/** Stubs global fetch: status route answers from `statuses` in order, and any
 *  resume request answers with `resume`. */
function stubFetch(statuses: unknown[], resume?: () => Response | Promise<Response>) {
  let n = 0;
  const spy = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/api/claude/status/")) {
      const body = statuses[Math.min(n++, statuses.length - 1)];
      if (body === "unreachable") return new Response("boom", { status: 500 });
      if (body === "offline") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (u.includes("/api/claude/resume/")) {
      if (!resume) return new Response("no", { status: 500 });
      return resume();
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a severed socket is not a failed generation", () => {
  it("recovers the packet when Chromium rejects the read with 'network error'", async () => {
    // The exact production failure.
    stubFetch([{ status: "succeeded", text: '{"title":"Recovered"}' }]);
    const res = severedResponse(
      [`event: progress\ndata: {"phase":"pass-1:writing"}\n\n`],
      new TypeError("network error"),
    );

    const out = await readClaudeStream(res);
    expect(out.content?.[0]?.text).toBe('{"title":"Recovered"}');
  });

  it("recovers when the read rejects with 'Failed to fetch'", async () => {
    stubFetch([{ status: "succeeded", text: "ok" }]);
    const res = severedResponse([], new TypeError("Failed to fetch"));
    await expect(readClaudeStream(res)).resolves.toBeTruthy();
  });

  it("never lets the transport error itself reach the caller", async () => {
    // Even when the run really did fail, the message must come from the
    // database, not from Chromium.
    stubFetch([{ status: "failed", error: "The model returned unparseable JSON." }]);
    const res = severedResponse([], new TypeError("network error"));
    await expect(readClaudeStream(res)).rejects.toThrow("unparseable JSON");
    await expect(readClaudeStream(severedResponse([], new TypeError("network error")))).rejects.not.toThrow(
      /network error/,
    );
  });

  it("keeps polling while the run is still going, then delivers", async () => {
    stubFetch([
      { status: "running", phase: "pass-1:writing", charCount: 120 },
      { status: "running", phase: "pass-1:writing", charCount: 900 },
      { status: "succeeded", text: "finished-late" },
    ]);
    const phases: string[] = [];
    const out = await readClaudeStream(severedResponse([], new TypeError("network error")), (p) =>
      phases.push(p.phase),
    );
    expect(out.content?.[0]?.text).toBe("finished-late");
    expect(phases).toContain("pass-1:writing");
  });
});

describe("an error frame is a claim, not a verdict", () => {
  it("ignores a server-side stream error when the row says the run succeeded", async () => {
    // workflow-sse.ts re-badges its own reader failures as event: error.
    stubFetch([{ status: "succeeded", text: "packet-survived" }]);
    const res = frameResponse([`event: error\ndata: {"message":"terminated"}\n\n`]);
    const out = await readClaudeStream(res);
    expect(out.content?.[0]?.text).toBe("packet-survived");
  });

  it("still reports a genuine failure the database confirms", async () => {
    stubFetch([{ status: "failed", error: "Credit balance is too low." }]);
    const res = frameResponse([`event: error\ndata: {"message":"terminated"}\n\n`]);
    await expect(readClaudeStream(res)).rejects.toThrow("Credit balance");
  });

  it("believes the frame when the database was never readable", async () => {
    stubFetch(["unreachable"]);
    const res = frameResponse([`event: error\ndata: {"message":"real failure"}\n\n`]);
    await expect(readClaudeStream(res)).rejects.toThrow("real failure");
  });
});

describe("the happy path still works", () => {
  it("returns the done frame without consulting anything", async () => {
    const spy = stubFetch([]);
    const out = await readClaudeStream(frameResponse([doneFrame("straight-through")]));
    expect(out.content?.[0]?.text).toBe("straight-through");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("an unreachable status route is not evidence of anything", () => {
  it("does not report failure when the browser is offline", async () => {
    // Offline: the status poll throws, the resume fetch throws. Nothing here
    // says the RUN is unhealthy, so nothing may be reported as a failure.
    // It should keep trying rather than resolve or reject.
    stubFetch(["offline"], () => {
      throw new TypeError("Failed to fetch");
    });
    const res = severedResponse([], new TypeError("network error"));
    const settled = await Promise.race([
      readClaudeStream(res).then(() => "settled", () => "rejected"),
      new Promise((r) => setTimeout(() => r("still-trying"), 1200)),
    ]);
    expect(settled).toBe("still-trying");
  });
});

describe("GenerationStillRunningError", () => {
  it("is distinguishable from a real failure", () => {
    const e = new GenerationStillRunningError("still going");
    expect(e).toBeInstanceOf(Error);
    expect(e.stillRunning).toBe(true);
    expect(e.name).toBe("GenerationStillRunningError");
  });
});
