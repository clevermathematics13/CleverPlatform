import { OAuth2Client, Credentials } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GoogleOAuthError,
  getProviderConnectionStatus,
  getProviderConnectionStatusFor,
  loadProviderToken,
  loadProviderTokenFor,
  recordProviderAuthFailure,
  saveProviderToken,
  saveProviderTokenFor,
  type ConnectionStatus,
  type StoredGoogleToken,
} from "@/lib/google-oauth-store";

// Drive OAuth is for clevermathematics@gmail.com (owns the question docs).
// Classroom OAuth is for the school account (pcleneng@amersol.edu.pe).
// These are separate Google accounts with separate tokens.
//
// Previously this token lived in an httpOnly browser cookie, which meant
// every Drive-dependent route only worked while the connecting teacher's
// own browser session was live — no background job, no other device, no
// reconnect-once-and-forget. It now lives in public.google_oauth_tokens
// (provider = "google-drive"), the same DB-backed store Classroom already
// used, with the same auto-refresh-and-persist behaviour. Return shapes are
// unchanged, so call sites only had to follow the rename from the old
// *TokenToCookie / *TokenFromCookie names, which had outlived the cookie.

/**
 * Reading the question docs. What every Drive feature except the PowerSchool
 * export mirror needs, and what getDriveConnectionStatus reports against, so
 * that a token issued before the write scope existed is still "connected" for
 * those features rather than being reported broken.
 */
const READ_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
];

/**
 * Writing the PowerSchool exports into a folder the teacher made.
 *
 * Full drive, not drive.file, and not by choice: drive.file grants per-file
 * access to what the app itself created or the user picked through Google's
 * file picker, so an existing folder identified only by its id is invisible to
 * it -- a create with that parent comes back 404. There is no narrower scope
 * that reaches a folder a person made earlier, from a background job with no
 * browser to show a picker in.
 *
 * The token is therefore more powerful than what this app does with it, which
 * is: create or update one CSV per class and assessment inside one folder.
 */
export const DRIVE_WRITE_SCOPE = "https://www.googleapis.com/auth/drive";

/** Requested at authorisation time. Existing connections keep working for the
 *  read features until the teacher reconnects to add the write scope. */
const SCOPES = [...READ_SCOPES, DRIVE_WRITE_SCOPE];
const PROVIDER = "google-drive";
const REFRESH_MARGIN_MS = 120_000;

function getOAuth2Client(redirectUri?: string) {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? process.env.GOOGLE_REDIRECT_URI
  );
}

export function getDriveAuthUrl(redirectUri: string) {
  const oauth2Client = getOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    // "consent" every time: without it Google withholds the refresh token on
    // re-authorisation, which is the single most common cause of a
    // connection that works for one hour and then silently stops refreshing.
    prompt: "consent",
    login_hint: "clevermathematics@gmail.com",
    state: "google-drive",
  });
}

export async function exchangeDriveCodeForToken(
  code: string,
  redirectUri: string
) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Persist a freshly issued or refreshed Drive token. Replaces the old
 * cookie-based saveDriveToken — same name kept for compatibility
 * with the OAuth callback route, but now writes through to the DB.
 */
export async function saveDriveToken(tokens: Credentials): Promise<void> {
  await saveProviderToken(PROVIDER, tokens);
}

/**
 * Returns the stored Drive credential as a plain object shaped exactly like
 * what OAuth2Client#setCredentials expects, refreshing first if the access
 * token is expired or close to it. Every existing call site does
 * `getAuthedClient(await getDriveToken())` — that pattern keeps
 * working unchanged; the only difference is the token now comes from the DB
 * and may already have been silently refreshed before this returns.
 */
export async function getDriveToken(): Promise<Credentials | null> {
  const stored = await loadProviderToken(PROVIDER);
  if (!stored || (!stored.access_token && !stored.refresh_token)) return null;

  const credentials: Credentials = {
    access_token: stored.access_token ?? undefined,
    refresh_token: stored.refresh_token ?? undefined,
    id_token: stored.id_token ?? undefined,
    scope: stored.scope ?? undefined,
    token_type: stored.token_type ?? undefined,
    expiry_date: stored.expiry_date ?? undefined,
  };

  const expired =
    !stored.expiry_date || stored.expiry_date - Date.now() < REFRESH_MARGIN_MS;
  if (!expired) return credentials;

  if (!stored.refresh_token) {
    // Access token is stale and there is nothing to refresh it with.
    // Return what's stored rather than null — a caller further down the
    // chain will get a clean 401 from Google rather than a silent skip,
    // and that failure path already surfaces "reconnect Drive" messaging.
    return credentials;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(credentials);
  try {
    await oauth2Client.getAccessToken();
    await saveProviderToken(PROVIDER, oauth2Client.credentials);
    return oauth2Client.credentials;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordProviderAuthFailure(PROVIDER, message);
    // Same reasoning as above: hand back the stale credential rather than
    // null. The downstream Drive API call will fail with a clear 401/403
    // instead of this function silently pretending Drive isn't connected.
    return credentials;
  }
}

export async function clearDriveTokenCookie(): Promise<void> {
  const { clearProviderToken } = await import("@/lib/google-oauth-store");
  await clearProviderToken(PROVIDER);
}

export async function getDriveAccessToken(): Promise<string | null> {
  const token = await getDriveToken();
  if (!token) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(token);

  const { token: accessToken } = await oauth2Client.getAccessToken();
  return accessToken ?? null;
}

/** Same shape as Classroom's connection status, for a future shared status UI.
 *  Reported against the read scopes only -- see READ_SCOPES. */
export async function getDriveConnectionStatus(): Promise<ConnectionStatus> {
  return getProviderConnectionStatus(PROVIDER, READ_SCOPES);
}

/** Whether the stored token can write to Drive, which a token issued before
 *  DRIVE_WRITE_SCOPE existed cannot. Checked before a mirror is attempted so
 *  the teacher is told to reconnect rather than left reading a 403. */
export async function getDriveWriteStatus(): Promise<ConnectionStatus> {
  return getProviderConnectionStatus(PROVIDER, [DRIVE_WRITE_SCOPE]);
}

/**
 * The same, for a named teacher and an explicit client.
 *
 * The PowerSchool export mirror runs from a student's submit and from
 * background rebuilds. Neither has the teacher signed in, and the request
 * variants above resolve the token from whoever is -- which would find the
 * student's (empty) Google connection, or nothing at all. These take the
 * teacher's profile id and the service-role client instead.
 */
export async function getDriveWriteStatusFor(
  supabase: SupabaseClient,
  profileId: string
): Promise<ConnectionStatus> {
  return getProviderConnectionStatusFor(supabase, profileId, PROVIDER, [DRIVE_WRITE_SCOPE]);
}

/** A named teacher's Drive credential, refreshed and persisted through the
 *  given client. Mirrors getDriveToken's behaviour, including handing back a
 *  stale credential rather than null so the caller gets a clear 401 from
 *  Google instead of a silent skip. */
export async function getDriveTokenFor(
  supabase: SupabaseClient,
  profileId: string
): Promise<Credentials | null> {
  const stored: StoredGoogleToken | null = await loadProviderTokenFor(
    supabase,
    profileId,
    PROVIDER
  );
  if (!stored || (!stored.access_token && !stored.refresh_token)) return null;

  const credentials: Credentials = {
    access_token: stored.access_token ?? undefined,
    refresh_token: stored.refresh_token ?? undefined,
    id_token: stored.id_token ?? undefined,
    scope: stored.scope ?? undefined,
    token_type: stored.token_type ?? undefined,
    expiry_date: stored.expiry_date ?? undefined,
  };

  const expired = !stored.expiry_date || stored.expiry_date - Date.now() < REFRESH_MARGIN_MS;
  if (!expired || !stored.refresh_token) return credentials;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(credentials);
  try {
    await oauth2Client.getAccessToken();
    await saveProviderTokenFor(supabase, profileId, PROVIDER, oauth2Client.credentials);
    return oauth2Client.credentials;
  } catch {
    return credentials;
  }
}

/** An OAuth2 client for a named teacher. See getDriveTokenFor. */
export async function getDriveAuthClientFor(
  supabase: SupabaseClient,
  profileId: string
): Promise<OAuth2Client | null> {
  const token = await getDriveTokenFor(supabase, profileId);
  if (!token) return null;
  const client = getOAuth2Client();
  client.setCredentials(token);
  return client;
}

/** An OAuth2 client carrying the stored Drive credential, ready for
 *  google.drive({ auth }). Three admin routes each grew their own copy of
 *  this; new callers should use this one. */
export async function getDriveAuthClient(): Promise<OAuth2Client | null> {
  const token = await getDriveToken();
  if (!token) return null;
  const client = getOAuth2Client();
  client.setCredentials(token);
  return client;
}

export { GoogleOAuthError as DriveOAuthError };
