import { OAuth2Client, Credentials } from "google-auth-library";
import {
  GoogleOAuthError,
  getProviderConnectionStatus,
  loadProviderToken,
  recordProviderAuthFailure,
  saveProviderToken,
  type ConnectionStatus,
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
// used, with the same auto-refresh-and-persist behaviour. Every function
// below keeps its original name and return shape so existing callers don't
// need to change.

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
];
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
 * cookie-based saveDriveTokenToCookie — same name kept for compatibility
 * with the OAuth callback route, but now writes through to the DB.
 */
export async function saveDriveTokenToCookie(tokens: Credentials): Promise<void> {
  await saveProviderToken(PROVIDER, tokens);
}

/**
 * Returns the stored Drive credential as a plain object shaped exactly like
 * what OAuth2Client#setCredentials expects, refreshing first if the access
 * token is expired or close to it. Every existing call site does
 * `getAuthedClient(await getDriveTokenFromCookie())` — that pattern keeps
 * working unchanged; the only difference is the token now comes from the DB
 * and may already have been silently refreshed before this returns.
 */
export async function getDriveTokenFromCookie(): Promise<Credentials | null> {
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
  const token = await getDriveTokenFromCookie();
  if (!token) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(token);

  const { token: accessToken } = await oauth2Client.getAccessToken();
  return accessToken ?? null;
}

/** Same shape as Classroom's connection status, for a future shared status UI. */
export async function getDriveConnectionStatus(): Promise<ConnectionStatus> {
  return getProviderConnectionStatus(PROVIDER, SCOPES);
}

export { GoogleOAuthError as DriveOAuthError };
