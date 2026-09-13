/**
 * What the teacher reads when their sign-in has lapsed, in place of the
 * server's "Not authenticated".
 *
 * That string is true and useless: it is what lib/auth.ts returns when
 * supabase.auth.getUser() finds no user, which on these screens means the
 * access token expired while the tab sat open -- not that anything was
 * rejected or lost. Exported so a banner can recognise it and offer the way
 * back, since the teacher cannot be expected to infer "sign in again" from it.
 */
export const SESSION_EXPIRED_MESSAGE = "Your sign-in has expired. Sign in again to continue.";

/**
 * fetch() + JSON parse in one step, with a readable error instead of a raw
 * JSON.parse crash when the server (or the platform in front of it) returns
 * something that isn't JSON — e.g. a 413/502 arriving as plain text before
 * our route handler ever runs. The full body is logged to the console so a
 * failure like that is diagnosable from devtools without guessing.
 */
export async function fetchJson(
  input: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(input, init);
  const text = await res.text();
  if (!text) return { ok: res.ok, status: res.status, data: {} };
  try {
    const data = JSON.parse(text);
    // Only this exact pairing is rewritten. A 401 carrying anything else --
    // "Profile not found" from getApiUser, say -- is a different fault and
    // keeps its own wording.
    if (res.status === 401 && data?.error === "Not authenticated") {
      return { ok: false, status: 401, data: { ...data, error: SESSION_EXPIRED_MESSAGE } };
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    console.error(`Non-JSON response from ${input} (status ${res.status}):`, text.slice(0, 2000));
    return {
      ok: false,
      status: res.status,
      data: { error: `Server returned status ${res.status}: ${text.slice(0, 200)}` },
    };
  }
}
