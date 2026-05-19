export async function readJsonSafely<T = unknown>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Typed GET helper — throws ApiError on non-2xx responses. */
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await readJsonSafely<{ error?: string }>(res);
    throw new ApiError(res.status, body?.error ?? `GET ${url} failed: ${res.status}`);
  }
  const data = await readJsonSafely<T>(res);
  if (data === null) throw new ApiError(res.status, `GET ${url}: empty response`);
  return data;
}

/** Typed POST helper — throws ApiError on non-2xx responses. */
export async function apiPost<TBody, TResponse = unknown>(
  url: string,
  body: TBody,
): Promise<TResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await readJsonSafely<{ error?: string }>(res);
    throw new ApiError(res.status, errBody?.error ?? `POST ${url} failed: ${res.status}`);
  }
  const data = await readJsonSafely<TResponse>(res);
  return data as TResponse;
}

/** Typed PATCH helper — throws ApiError on non-2xx responses. */
export async function apiPatch<TBody, TResponse = unknown>(
  url: string,
  body: TBody,
): Promise<TResponse> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await readJsonSafely<{ error?: string }>(res);
    throw new ApiError(res.status, errBody?.error ?? `PATCH ${url} failed: ${res.status}`);
  }
  const data = await readJsonSafely<TResponse>(res);
  return data as TResponse;
}

