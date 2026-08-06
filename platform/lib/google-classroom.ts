import { classroom_v1, classroom } from "@googleapis/classroom";
import { OAuth2Client, Credentials } from "google-auth-library";
import { createClient } from "@/lib/supabase/server";

/* -------------------------------------------------------------------------- */
/*  Scopes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Default scopes: read-only roster access.
 *
 * To widen (coursework push, grade return) set GOOGLE_CLASSROOM_SCOPES in Vercel
 * to a space-separated list. Changing scopes here alone is not enough — the same
 * scopes must be registered on the OAuth consent screen in Google Cloud Console,
 * or Google rejects the authorisation request with `invalid_scope`.
 */
const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
];

const SCOPE_OVERRIDE = (process.env.GOOGLE_CLASSROOM_SCOPES ?? "")
  .split(/\s+/)
  .filter(Boolean);

export const SCOPES: string[] =
  SCOPE_OVERRIDE.length > 0 ? SCOPE_OVERRIDE : DEFAULT_SCOPES;

const PROVIDER = "google-classroom";

/* -------------------------------------------------------------------------- */
/*  Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type ClassroomErrorCode =
  | "not_connected"
  | "reauth_required"
  | "insufficient_scope"
  | "rate_limited"
  | "upstream_error";

export class ClassroomError extends Error {
  code: ClassroomErrorCode;
  constructor(code: ClassroomErrorCode, message: string) {
    super(message);
    this.name = "ClassroomError";
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/*  OAuth client                                                               */
/* -------------------------------------------------------------------------- */

function getOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ClassroomError(
      "upstream_error",
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured."
    );
  }
  return new OAuth2Client(
    clientId,
    clientSecret,
    redirectUri ?? process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(redirectUri?: string, state = PROVIDER) {
  return getOAuth2Client(redirectUri).generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    // `consent` is required every time: without it Google withholds the refresh
    // token on re-authorisation, which is the single most common cause of a
    // connection that works for one hour and then dies.
    prompt: "consent",
    include_granted_scopes: true,
    state,
  });
}

export async function exchangeCodeForToken(code: string, redirectUri?: string) {
  const { tokens } = await getOAuth2Client(redirectUri).getToken(code);
  return tokens;
}

/* -------------------------------------------------------------------------- */
/*  Token store (Supabase, not cookies)                                        */
/* -------------------------------------------------------------------------- */

export interface StoredToken {
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  scope: string | null;
  token_type: string | null;
  expiry_date: number | null;
  google_email: string | null;
}

async function currentProfileId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function decodeEmailFromIdToken(idToken?: string | null): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const parsed = JSON.parse(json) as { email?: string };
    return parsed.email ?? null;
  } catch {
    return null;
  }
}

/** Persist a freshly issued or refreshed token set. Merges — never clobbers an
 *  existing refresh_token with null, because Google only returns it once. */
export async function saveToken(tokens: Credentials): Promise<void> {
  const profileId = await currentProfileId();
  if (!profileId) throw new ClassroomError("not_connected", "No signed-in user.");

  const supabase = await createClient();
  const existing = await loadToken();

  const row = {
    profile_id: profileId,
    provider: PROVIDER,
    access_token: tokens.access_token ?? existing?.access_token ?? null,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
    id_token: tokens.id_token ?? existing?.id_token ?? null,
    scope: tokens.scope ?? existing?.scope ?? null,
    token_type: tokens.token_type ?? existing?.token_type ?? "Bearer",
    expiry_date: tokens.expiry_date ?? existing?.expiry_date ?? null,
    google_email:
      decodeEmailFromIdToken(tokens.id_token) ?? existing?.google_email ?? null,
    last_error: null,
    last_refreshed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("google_oauth_tokens")
    .upsert(row, { onConflict: "profile_id,provider" });

  if (error) {
    throw new ClassroomError(
      "upstream_error",
      `Could not persist Google token: ${error.message}`
    );
  }
}

export async function loadToken(): Promise<StoredToken | null> {
  const profileId = await currentProfileId();
  if (!profileId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select(
      "access_token, refresh_token, id_token, scope, token_type, expiry_date, google_email"
    )
    .eq("profile_id", profileId)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (error || !data) return null;
  return data as StoredToken;
}

export async function clearToken(): Promise<void> {
  const profileId = await currentProfileId();
  if (!profileId) return;
  const supabase = await createClient();
  await supabase
    .from("google_oauth_tokens")
    .delete()
    .eq("profile_id", profileId)
    .eq("provider", PROVIDER);
}

async function recordAuthFailure(message: string): Promise<void> {
  const profileId = await currentProfileId();
  if (!profileId) return;
  const supabase = await createClient();
  await supabase
    .from("google_oauth_tokens")
    .update({ last_error: message.slice(0, 500) })
    .eq("profile_id", profileId)
    .eq("provider", PROVIDER);
}

/* -------------------------------------------------------------------------- */
/*  Connection status                                                          */
/* -------------------------------------------------------------------------- */

export interface ConnectionStatus {
  connected: boolean;
  email: string | null;
  scopes: string[];
  missingScopes: string[];
  expiresAt: string | null;
  /** True when a refresh token is absent — the connection cannot self-heal. */
  fragile: boolean;
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const token = await loadToken();
  if (!token) {
    return {
      connected: false,
      email: null,
      scopes: [],
      missingScopes: SCOPES,
      expiresAt: null,
      fragile: true,
    };
  }
  const granted = (token.scope ?? "").split(/\s+/).filter(Boolean);
  return {
    connected: Boolean(token.refresh_token || token.access_token),
    email: token.google_email,
    scopes: granted,
    missingScopes: SCOPES.filter((s) => !granted.includes(s)),
    expiresAt: token.expiry_date
      ? new Date(token.expiry_date).toISOString()
      : null,
    fragile: !token.refresh_token,
  };
}

/** Back-compat shim for existing callers. */
export async function isConnected(): Promise<boolean> {
  return (await getConnectionStatus()).connected;
}

/* -------------------------------------------------------------------------- */
/*  Authenticated client                                                       */
/* -------------------------------------------------------------------------- */

const REFRESH_MARGIN_MS = 120_000;

export async function getClassroomClient(): Promise<classroom_v1.Classroom> {
  const token = await loadToken();
  if (!token || (!token.access_token && !token.refresh_token)) {
    throw new ClassroomError(
      "not_connected",
      "Google Classroom is not connected for this account."
    );
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: token.access_token ?? undefined,
    refresh_token: token.refresh_token ?? undefined,
    id_token: token.id_token ?? undefined,
    scope: token.scope ?? undefined,
    token_type: token.token_type ?? undefined,
    expiry_date: token.expiry_date ?? undefined,
  });

  // Persist every silent refresh. Without this the refreshed access token lives
  // only in memory and every cold Lambda starts from an expired credential.
  oauth2Client.on("tokens", (fresh) => {
    void saveToken(fresh).catch(() => undefined);
  });

  const expired =
    !token.expiry_date || token.expiry_date - Date.now() < REFRESH_MARGIN_MS;

  if (expired) {
    if (!token.refresh_token) {
      throw new ClassroomError(
        "reauth_required",
        "The Google access token expired and no refresh token is stored. Reconnect Google Classroom."
      );
    }
    try {
      await oauth2Client.getAccessToken();
      await saveToken(oauth2Client.credentials);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordAuthFailure(message);
      if (/invalid_grant|unauthorized_client|invalid_client/i.test(message)) {
        throw new ClassroomError(
          "reauth_required",
          "Google revoked this authorisation. Reconnect Google Classroom."
        );
      }
      throw new ClassroomError("upstream_error", message);
    }
  }

  return classroom({ version: "v1", auth: oauth2Client });
}

/* -------------------------------------------------------------------------- */
/*  Retry wrapper                                                              */
/* -------------------------------------------------------------------------- */

interface HttpishError {
  code?: number | string;
  status?: number;
  response?: { status?: number };
  message?: string;
}

function statusOf(err: unknown): number | null {
  const e = err as HttpishError;
  const raw = e?.response?.status ?? e?.status ?? e?.code;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof ClassroomError) throw err;
      const status = statusOf(err);
      if (status === 401) {
        throw new ClassroomError(
          "reauth_required",
          "Google rejected the stored credential. Reconnect Google Classroom."
        );
      }
      if (status === 403) {
        throw new ClassroomError(
          "insufficient_scope",
          "This Google account has not granted the scope required for that call."
        );
      }
      if (status !== 429 && (status === null || status < 500)) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  if (lastErr instanceof ClassroomError) throw lastErr;
  const status = statusOf(lastErr);
  throw new ClassroomError(
    status === 429 ? "rate_limited" : "upstream_error",
    lastErr instanceof Error ? lastErr.message : "Google Classroom request failed."
  );
}

/* -------------------------------------------------------------------------- */
/*  Public data helpers                                                        */
/* -------------------------------------------------------------------------- */

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  courseState?: string;
  enrollmentCode?: string;
}

export interface ClassroomStudent {
  userId: string;
  fullName: string;
  email: string;
  photoUrl?: string;
}

export async function listCourses(): Promise<ClassroomCourse[]> {
  const api = await getClassroomClient();
  const out: ClassroomCourse[] = [];
  let pageToken: string | undefined;

  do {
    const res = await withRetry(() =>
      api.courses.list({
        teacherId: "me",
        courseStates: ["ACTIVE"],
        pageSize: 100,
        pageToken,
      })
    );
    for (const c of res.data.courses ?? []) {
      if (!c.id || !c.name) continue;
      out.push({
        id: c.id,
        name: c.name,
        section: c.section ?? undefined,
        courseState: c.courseState ?? undefined,
        enrollmentCode: c.enrollmentCode ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

export async function listStudentsInCourse(
  courseId: string
): Promise<ClassroomStudent[]> {
  const api = await getClassroomClient();
  const students: ClassroomStudent[] = [];
  let pageToken: string | undefined;

  do {
    const res = await withRetry(() =>
      api.courses.students.list({ courseId, pageSize: 100, pageToken })
    );
    for (const s of res.data.students ?? []) {
      const email = s.profile?.emailAddress;
      if (!email || !s.userId) continue;
      students.push({
        userId: s.userId,
        fullName: s.profile?.name?.fullName ?? email,
        email,
        photoUrl: s.profile?.photoUrl ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return students;
}

/** Cheap liveness probe — proves the stored credential still works right now. */
export async function pingClassroom(): Promise<{ ok: boolean; detail: string }> {
  try {
    const api = await getClassroomClient();
    const res = await withRetry(() =>
      api.courses.list({ teacherId: "me", pageSize: 1 })
    );
    return {
      ok: true,
      detail: `Reachable — ${res.data.courses?.length ?? 0} course(s) visible on first page.`,
    };
  } catch (err) {
    return {
      ok: false,
      detail:
        err instanceof ClassroomError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown failure.",
    };
  }
}
