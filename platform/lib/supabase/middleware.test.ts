import { beforeEach, describe, expect, it, vi } from "vitest";

// Track whether updateSession ever tried to recover a session, and hand the
// caller control over what getUser() reports back.
const getUser = vi.fn();
const createServerClient = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => {
    createServerClient(...args);
    return { auth: { getUser } };
  },
}));

import { NextRequest } from "next/server";
import { updateSession } from "./middleware";

function requestFor(url: string, cookies: Record<string, string> = {}) {
  const request = new NextRequest(new URL(url, "https://clevermathematics.com"));
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

describe("updateSession", () => {
  beforeEach(() => {
    getUser.mockReset();
    createServerClient.mockReset();
    getUser.mockResolvedValue({ data: { user: null } });
  });

  // The regression this file exists for. Running session recovery on the
  // OAuth callback made auth-js call _removeSession() whenever a stale
  // sb-<ref>-auth-token cookie was present, and _removeSession deletes
  // `<storageKey>-code-verifier` along with the session. The callback's
  // exchangeCodeForSession then had no PKCE verifier left to use, so the
  // FIRST sign-in attempt always failed with auth_callback_failed and the
  // second always worked -- the failed attempt had cleared the stale cookie
  // that caused it. The fix is to not touch cookies on this route at all.
  it("never touches the session on the OAuth callback, even with a stale auth cookie", async () => {
    const request = requestFor(
      "/auth/callback?code=abc123&next=/dashboard&persistent=0",
      { "sb-qnawglgnoojrlaivylou-auth-token": "stale-and-unrefreshable" }
    );

    await updateSession(request);

    expect(createServerClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("passes the callback through rather than redirecting it", async () => {
    const request = requestFor("/auth/callback?code=abc123");

    const response = await updateSession(request);

    // A redirect here would mean the route handler never runs and the code
    // never gets exchanged.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves the callback's cookies exactly as they arrived", async () => {
    const verifier = "sb-qnawglgnoojrlaivylou-auth-token-code-verifier";
    const request = requestFor("/auth/callback?code=abc123", {
      [verifier]: "the-verifier-the-handler-needs",
    });

    await updateSession(request);

    expect(request.cookies.get(verifier)?.value).toBe(
      "the-verifier-the-handler-needs"
    );
  });

  it("still recovers the session on ordinary routes", async () => {
    await updateSession(requestFor("/dashboard"));

    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
