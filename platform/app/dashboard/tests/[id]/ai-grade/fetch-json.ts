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
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    console.error(`Non-JSON response from ${input} (status ${res.status}):`, text.slice(0, 2000));
    return {
      ok: false,
      status: res.status,
      data: { error: `Server returned status ${res.status}: ${text.slice(0, 200)}` },
    };
  }
}
