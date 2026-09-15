/**
 * readClaudeStream's job is to make the outcome of a generation independent of
 * whether any one socket survives. It nearly did.
 *
 * On 2026-09-15 a teacher lost a finished Nuanced Analysis packet to a network
 * blip. The server-side record shows nothing wrong at all -- run
 * a6d6801b-8ca6-4b69-a78e-70210aa8e669 in nuanced_generation_runs finished
 * status=succeeded, char_count=33815, error=NULL -- and the Vercel log shows
 * the connection dropping THREE times on that one packet:
 *
 *   11:18:49  connection 1 dies -> status poll -> resume 200   (recovered)
 *   11:20:53  connection 2 dies -> status poll -> resume 200   (recovered)
 *   ~11:22    connection 3 dies -> nothing. The client threw.
 *   11:22:10  the run succeeds server-side, delivered to nobody.
 *
 * The difference between the drops that recovered and the one that did not was
 * only ever the SHAPE of the failure. A socket that ends resolves read() with
 * done:true; a socket that breaks REJECTS it, in Chromium with the literal
 * message "network error". The first was handled, the second escaped every
 * layer of the reconnect machinery and was printed to the teacher raw.
 *
 * So these tests are written in that vocabulary: each one builds a body that
 * fails in a specific shape and asserts that the packet still arrives. They
 * use fake timers because the reconnect backoff sleeps for seconds at a time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readClaudeStream } from "@/lib/claude-stream";

// ---- fixtures --------------------------------------------------------------

const RUN_ID = "wrun_01M2JCHA0M1JMS563BW3XMN6FV";
const GENERATION_ID = "a6d6801b-8ca6-4b69-a78e-70210aa8e669";

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const PROGRESS = frame("progress", { phase: "pass-1" });
const DONE = frame("done", {
  message: { content: [{ type: "text", text: "{\"title\":\"packet\"}" }], stop_reason: "end_turn" },
});

/**
 * A Response whose body hands out `frames` one read at a time and then fails
 * in the given shape. Pull-based on purpose: enqueueing everything up front
 * and erroring in start() errors the stream before a single frame can be read,
 * which is not what a socket dying mid-stream looks like.
 */
function streamingResponse(
  frames: string[],
  ending: "break" | "end",
  headers: Record<string, string> = { "x-workflow-run-id": RUN_ID, "x-generation-id": GENERATION_ID },
): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(encoder.encode(frames[i++]));
        return;
      }
      // "break" is Chromium's behaviour when the socket is severed: the
      // pending read() rejects. "end" is a clean close: read() resolves
      // done:true.
      if (ending === "break") controller.error(new TypeError("network error"));
      else controller.close();
    },
  });
  return new Response(body, { headers });
}

function statusBody(status: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ status, phase: "pass-1", charCount: 0, ...extra }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stubs global fetch with a queue of handlers keyed by URL prefix, and records
 * every URL requested so a test can assert on the reconnect handshake.
 */
function stubFetch(handler: (url: string, callIndex: number) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const index = calls.length;
    calls.push(url);
    return Promise.resolve(handler(url, index));
  });
  return calls;
}

/**
 * Drives a readClaudeStream promise to settlement while fake timers are in
 * play. The reconnect path sleeps on RECONNECT_BACKOFF_MS (1s..8s) and polls
 * in between, so nothing resolves unless the clock is pushed forward; without
 * this helper every test below would hang until Vitest's timeout.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.then(
    (v) => { done = true; return v; },
    (e) => { done = true; throw e; },
  );
  // Swallow the rejection on the tracking copy so advancing timers does not
  // trip an unhandled rejection before the test awaits it.
  void tracked.catch(() => {});
  for (let i = 0; i < 200 && !done; i++) {
    await vi.advanceTimersByTimeAsync(1000);
  }
  return tracked;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---- the regression --------------------------------------------------------

describe("readClaudeStream, when the connection BREAKS rather than ends", () => {
  it("recovers the finished packet instead of throwing the browser's raw error", async () => {
    // Exactly the production shape: some progress flows, the socket is
    // severed, and by the time the client asks, the run has succeeded.
    const initial = streamingResponse([PROGRESS], "break");
    stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) {
        return statusBody("succeeded", { text: "{\"title\":\"the packet\"}" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await settle(readClaudeStream(initial));

    expect(result.content?.[0]?.text).toBe("{\"title\":\"the packet\"}");
  });

  it("does not surface `network error` to the caller", async () => {
    const initial = streamingResponse([], "break");
    stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) return statusBody("succeeded", { text: "recovered" });
      throw new Error(`unexpected fetch: ${url}`);
    });

    // The whole point: this used to reject with TypeError: network error.
    await expect(settle(readClaudeStream(initial))).resolves.toBeTruthy();
  });

  it("reconnects and reads the done frame off the resumed stream", async () => {
    const initial = streamingResponse([PROGRESS], "break");
    const calls = stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) return statusBody("running");
      if (url.startsWith("/api/claude/resume/")) return streamingResponse([DONE], "end");
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await settle(readClaudeStream(initial));

    expect(result.content?.[0]?.text).toContain("packet");
    // One frame was parsed off the broken stream, so the resume must ask for
    // the next one -- not replay from zero and not skip past it.
    expect(calls.some((u) => u.includes(`/api/claude/resume/${RUN_ID}?startIndex=1`))).toBe(true);
  });
});

describe("readClaudeStream, on a clean end-of-stream", () => {
  it("still recovers, exactly as it did before the break case was handled", async () => {
    const initial = streamingResponse([PROGRESS], "end");
    stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) return statusBody("succeeded", { text: "recovered" });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await settle(readClaudeStream(initial));

    expect(result.content?.[0]?.text).toBe("recovered");
  });
});

describe("readClaudeStream, when the reconnect itself fails", () => {
  it("survives a resume fetch that rejects outright", async () => {
    const initial = streamingResponse([PROGRESS], "break");
    let resumeAttempts = 0;
    stubFetch((url) => {
      if (url.startsWith("/api/claude/resume/")) {
        resumeAttempts++;
        // What a dropped wifi connection does to a request that never leaves.
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.startsWith("/api/claude/status/")) {
        return resumeAttempts >= 2
          ? statusBody("succeeded", { text: "recovered after two failed reconnects" })
          : statusBody("running");
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await settle(readClaudeStream(initial));

    expect(result.content?.[0]?.text).toBe("recovered after two failed reconnects");
    expect(resumeAttempts).toBeGreaterThanOrEqual(2);
  });

  it("survives a resume that 404s, without tripping over the spent response", async () => {
    // The old code looped back to readOneStream with the SAME Response after a
    // non-2xx resume. Its body was already locked to a reader, so the retry
    // threw `ReadableStream is locked to a reader` -- swapping one raw browser
    // error for another. Two 404s in a row is what forces that second read.
    const initial = streamingResponse([PROGRESS], "break");
    let resumeAttempts = 0;
    stubFetch((url) => {
      if (url.startsWith("/api/claude/resume/")) {
        resumeAttempts++;
        return new Response(JSON.stringify({ error: "no such run" }), { status: 404 });
      }
      if (url.startsWith("/api/claude/status/")) {
        return resumeAttempts >= 2 ? statusBody("succeeded", { text: "recovered" }) : statusBody("running");
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await settle(readClaudeStream(initial));

    expect(result.content?.[0]?.text).toBe("recovered");
    expect(resumeAttempts).toBeGreaterThanOrEqual(2);
  });
});

describe("readClaudeStream, on outcomes that must still be reported", () => {
  it("throws the server's own message when the run genuinely failed", async () => {
    const initial = streamingResponse([PROGRESS], "break");
    stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) {
        return statusBody("failed", { error: "Your credit balance is too low" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    // A real failure must not be swallowed by the new guards -- this is the
    // one message the teacher genuinely needs to see.
    await expect(settle(readClaudeStream(initial))).rejects.toThrow("Your credit balance is too low");
  });

  it("throws an error frame's message without reconnecting", async () => {
    const initial = streamingResponse([frame("error", { message: "max_tokens reached" })], "end");
    stubFetch((url) => {
      throw new Error(`should not have fetched anything, got ${url}`);
    });

    await expect(settle(readClaudeStream(initial))).rejects.toThrow("max_tokens reached");
  });

  it("returns a done frame immediately, with no status poll at all", async () => {
    const initial = streamingResponse([PROGRESS, DONE], "end");
    const calls = stubFetch((url) => {
      throw new Error(`should not have fetched anything, got ${url}`);
    });

    const result = await settle(readClaudeStream(initial));

    expect(result.content?.[0]?.text).toBe("{\"title\":\"packet\"}");
    expect(calls).toHaveLength(0);
  });
});

describe("readClaudeStream resume bookkeeping", () => {
  it("resumes from the number of WHOLE frames parsed, never counting a half-received one", async () => {
    const initial = streamingResponse(
      [PROGRESS + PROGRESS, PROGRESS, 'event: progress\ndata: {"phase":"tru'],
      "break",
    );
    const calls = stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) return statusBody("running");
      if (url.startsWith("/api/claude/resume/")) return streamingResponse([DONE], "end");
      throw new Error(`unexpected fetch: ${url}`);
    });

    await settle(readClaudeStream(initial));

    expect(calls).toContain(
      `/api/claude/resume/${RUN_ID}?startIndex=3&generationId=${GENERATION_ID}`,
    );
  });

  it("says so plainly when there is no run to resume", async () => {
    const initial = streamingResponse([PROGRESS], "break", { "x-generation-id": GENERATION_ID });
    stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) return statusBody("running");
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(settle(readClaudeStream(initial))).rejects.toThrow(/no resumable run ID/);
  });
});

describe("readClaudeStream progress reporting", () => {
  it("reports a reconnecting phase so a recovering run does not look frozen", async () => {
    const initial = streamingResponse([PROGRESS], "break");
    stubFetch((url) => {
      if (url.startsWith("/api/claude/status/")) return statusBody("running");
      if (url.startsWith("/api/claude/resume/")) return streamingResponse([DONE], "end");
      throw new Error(`unexpected fetch: ${url}`);
    });

    const phases: string[] = [];
    await settle(readClaudeStream(initial, (info) => phases.push(info.phase)));

    expect(phases).toContain("pass-1");
    expect(phases).toContain("reconnecting");
  });
});
