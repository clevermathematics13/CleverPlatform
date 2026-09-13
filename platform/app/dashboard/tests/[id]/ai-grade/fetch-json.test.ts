/**
 * fetch-json.test.ts
 * -----------------------------------------------------------------------------
 * Regression test for the marking screen reporting an expired sign-in as
 * "Not authenticated".
 *
 * The bug, seen on 10 Sep 2026: a teacher accepted 41 AI-suggested marks. The
 * accept succeeded -- all 41 reached Clev's Marks -- and the refresh fired
 * immediately afterwards came back 401, because the access token had lapsed
 * while the tab sat open. Every call site passed `data.error` straight into
 * the red banner, so the screen showed "Not authenticated" above "41 mark(s)
 * written to Clev's Marks." with nothing to say which was true or what to do.
 *
 * The server string is correct and unusable: lib/auth.ts returns it whenever
 * supabase.auth.getUser() finds no user. Rewriting it here, once, fixes every
 * caller of fetchJson at the same time -- but only for that exact pairing, so
 * a 401 raised for any other reason keeps the wording its route chose.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, SESSION_EXPIRED_MESSAGE } from "./fetch-json";

/** A stand-in for one fetch() result; only what fetchJson actually reads. */
function respond(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("rewrites the 401 a lapsed session produces into something actionable", async () => {
    respond(401, JSON.stringify({ error: "Not authenticated" }));

    const { ok, status, data } = await fetchJson("/api/tests/t1/ai-grade");

    expect(ok).toBe(false);
    expect(status).toBe(401);
    expect(data.error).toBe(SESSION_EXPIRED_MESSAGE);
    // The teacher has to be told to sign in; "Not authenticated" never did.
    expect(data.error).not.toBe("Not authenticated");
  });

  it("leaves a 401 raised for any other reason with its own wording", async () => {
    // getApiUser returns this one, and it is a different fault: the session is
    // valid, the profile row is missing. Telling that teacher to sign in again
    // would send them round a loop that cannot fix it.
    respond(401, JSON.stringify({ error: "Profile not found" }));

    const { data } = await fetchJson("/api/gradebook/self-assessment-export");

    expect(data.error).toBe("Profile not found");
  });

  it("passes a successful response through untouched", async () => {
    respond(200, JSON.stringify({ appliedCount: 41 }));

    const { ok, status, data } = await fetchJson("/api/tests/t1/ai-grade/accept");

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data.appliedCount).toBe(41);
  });

  it("still explains a non-JSON body rather than throwing", async () => {
    // A 413 or 502 arrives as plain text before the route handler runs.
    respond(502, "<html>Bad gateway</html>");

    const { ok, data } = await fetchJson("/api/tests/t1/ai-grade");

    expect(ok).toBe(false);
    expect(String(data.error)).toContain("502");
  });

  it("does not mistake a 403 for an expired session", async () => {
    // getApiTeacher answers Forbidden when the role is wrong. That is not
    // fixed by signing in again either.
    respond(403, JSON.stringify({ error: "Forbidden" }));

    const { data } = await fetchJson("/api/tests/t1/ai-grade");

    expect(data.error).toBe("Forbidden");
  });
});
