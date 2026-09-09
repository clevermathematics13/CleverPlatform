import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startGoogleSignIn } from "./google-sign-in";

/**
 * The "sign in twice, every time" bug, reproduced.
 *
 * These run the real @supabase/ssr browser client and the real auth-js
 * against a fake `document.cookie` and a fake `fetch`. That matters: the bug
 * is a race inside those libraries, so a test that stubbed them would only
 * confirm my reading of them. This confirms the behaviour.
 *
 * The witness is `signs in the way that used to fail` -- if it ever stops
 * failing, the library changed and startGoogleSignIn's wait may no longer be
 * needed. See lib/supabase/google-sign-in.ts for the mechanism.
 */

const REF = "examplerefexamplerefe";
const STORAGE_KEY = `sb-${REF}-auth-token`;
const VERIFIER_KEY = `${STORAGE_KEY}-code-verifier`;
const REDIRECT = "https://example.com/auth/callback?next=%2Fdashboard&persistent=0";

// ---- a cookie jar with real Max-Age semantics ---------------------------

const jar = new Map<string, string>();

function writeCookie(raw: string) {
  const [pair, ...attributes] = raw.split(";").map((s) => s.trim());
  const eq = pair.indexOf("=");
  const name = pair.slice(0, eq);
  const value = pair.slice(eq + 1);

  const maxAge = attributes
    .map((a) => a.split("="))
    .find(([k]) => k.toLowerCase() === "max-age")?.[1];

  // A deletion is `value=""; Max-Age=0`, which is exactly what auth-js sends
  // when it gives up on a session -- and what takes the verifier with it.
  if (maxAge !== undefined && Number(maxAge) <= 0) jar.delete(name);
  else jar.set(name, value);
}

const redirectedTo: string[] = [];

const fakeDocument = {
  get cookie() {
    return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  },
  set cookie(raw: string) {
    writeCookie(raw);
  },
  addEventListener() {},
  removeEventListener() {},
  visibilityState: "visible",
};

const fakeWindow = {
  document: fakeDocument,
  location: {
    href: "https://example.com/login",
    origin: "https://example.com",
    assign(url: string) {
      redirectedTo.push(url);
    },
  },
  history: { state: null, replaceState() {} },
  addEventListener() {},
  removeEventListener() {},
};

/** A session whose refresh token the server will refuse. */
function expiredSession(): string {
  const payload = JSON.stringify({
    access_token: "stale.access.token",
    refresh_token: "stale-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 7200,
    user: { id: "11111111-1111-1111-1111-111111111111", aud: "authenticated" },
  });
  return `base64-${Buffer.from(payload, "utf8").toString("base64url")}`;
}

const globals = globalThis as Record<string, unknown>;
const originals: Record<string, unknown> = {};

beforeAll(() => {
  for (const key of ["window", "document", "location", "fetch"]) {
    originals[key] = globals[key];
  }
  globals.window = fakeWindow;
  globals.document = fakeDocument;
  globals.location = fakeWindow.location;
  globals.fetch = async (input: unknown) => {
    // The only call these tests provoke: the refresh that fails and makes
    // auth-js throw the session away.
    if (String(input).includes("grant_type=refresh_token")) {
      return new Response(
        JSON.stringify({
          code: 400,
          error_code: "refresh_token_not_found",
          msg: "Invalid Refresh Token: Refresh Token Not Found",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
});

afterAll(() => {
  for (const [key, value] of Object.entries(originals)) globals[key] = value;
});

beforeEach(() => {
  jar.clear();
  redirectedTo.length = 0;
  // auth-js logs the refresh failure itself; that is the log line production
  // showed, not a test problem.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh client, not the module singleton: each case starts clean. */
async function browserClient(): Promise<SupabaseClient> {
  const { createBrowserClient } = await import("@supabase/ssr");
  return createBrowserClient(`https://${REF}.supabase.co`, "anon-key", {
    isSingleton: false,
  }) as unknown as SupabaseClient;
}

/** Long enough for the background recovery and its refresh call to finish. */
async function letRecoveryFinish() {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

describe("starting the Google sign-in with a stale session in the jar", () => {
  it("signs in the way that used to fail: the verifier is deleted", async () => {
    jar.set(STORAGE_KEY, expiredSession());
    const supabase = await browserClient();

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: REDIRECT },
    });
    await letRecoveryFinish();

    expect(redirectedTo).toHaveLength(1);
    // The browser has left for Google, and the verifier the callback will ask
    // for is gone. This is auth_callback_failed.
    expect(jar.has(VERIFIER_KEY)).toBe(false);
  });

  it("startGoogleSignIn keeps the verifier", async () => {
    jar.set(STORAGE_KEY, expiredSession());
    const supabase = await browserClient();

    await startGoogleSignIn(supabase, REDIRECT);
    await letRecoveryFinish();

    expect(redirectedTo).toHaveLength(1);
    expect(jar.get(VERIFIER_KEY)).toBeTruthy();
  });

  it("startGoogleSignIn still clears the stale session it waited for", async () => {
    jar.set(STORAGE_KEY, expiredSession());
    const supabase = await browserClient();

    await startGoogleSignIn(supabase, REDIRECT);
    await letRecoveryFinish();

    expect(jar.has(STORAGE_KEY)).toBe(false);
  });
});

describe("with no stale session", () => {
  // The control. Without this, the failing case above proves only that
  // something in the harness eats the verifier.
  it("the verifier survives either way", async () => {
    const plain = await browserClient();
    await plain.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: REDIRECT },
    });
    await letRecoveryFinish();
    expect(jar.get(VERIFIER_KEY)).toBeTruthy();

    jar.clear();
    redirectedTo.length = 0;

    const waited = await browserClient();
    await startGoogleSignIn(waited, REDIRECT);
    await letRecoveryFinish();
    expect(jar.get(VERIFIER_KEY)).toBeTruthy();
  });
});
