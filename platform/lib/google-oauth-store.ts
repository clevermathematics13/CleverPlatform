import type { Credentials } from "google-auth-library";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared server-side store for Google OAuth tokens, keyed by
 * (profile_id, provider) in public.google_oauth_tokens.
 *
 * Extracted from what was originally lib/google-classroom.ts's own
 * save/load/refresh logic. Classroom tokens have lived here since they were
 * first built; Drive tokens lived in an httpOnly cookie instead, which meant
 * every Drive-dependent route (question image extraction, LaTeX OCR, the
 * Drive picker, ExamBuilder's PDF fetch) only worked while the connecting
 * teacher's browser session was live — no background job, no other browser,
 * no reconnect-once-and-forget. Moving Drive onto this same store removes
 * that constraint the same way it was already removed for Classroom.
 *
 * One row per (profile_id, provider): a single teacher can hold both a
 * "google-classroom" row and a "google-drive" row at once, refreshed and
 * persisted independently.
 */

export type OAuthErrorCode =
  | "not_connected"
  | "reauth_required"
  | "insufficient_scope"
  | "rate_limited"
  | "upstream_error";

export class GoogleOAuthError extends Error {
  code: OAuthErrorCode;
  provider: string;
  constructor(provider: string, code: OAuthErrorCode, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
    this.provider = provider;
  }
}

export interface StoredGoogleToken {
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  scope: string | null;
  token_type: string | null;
  expiry_date: number | null;
  google_email: string | null;
}

export interface ConnectionStatus {
  connected: boolean;
  email: string | null;
  scopes: string[];
  missingScopes: string[];
  expiresAt: string | null;
  /** True when a refresh token is absent — the connection cannot self-heal. */
  fragile: boolean;
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

/**
 * Persist a freshly issued or refreshed token set for one provider. Merges —
 * never clobbers an existing refresh_token with null, because Google only
 * returns a refresh_token on the very first consent grant (or when `prompt:
 * "consent"` forces a fresh one); a routine access-token refresh omits it.
 */
export async function saveProviderToken(
  provider: string,
  tokens: Credentials
): Promise<void> {
  const profileId = await currentProfileId();
  if (!profileId) {
    throw new GoogleOAuthError(provider, "not_connected", "No signed-in user.");
  }

  const supabase = await createClient();
  const existing = await loadProviderToken(provider);

  const row = {
    profile_id: profileId,
    provider,
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
    throw new GoogleOAuthError(
      provider,
      "upstream_error",
      `Could not persist Google token: ${error.message}`
    );
  }
}

export async function loadProviderToken(
  provider: string
): Promise<StoredGoogleToken | null> {
  const profileId = await currentProfileId();
  if (!profileId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select(
      "access_token, refresh_token, id_token, scope, token_type, expiry_date, google_email"
    )
    .eq("profile_id", profileId)
    .eq("provider", provider)
    .maybeSingle();

  if (error || !data) return null;
  return data as StoredGoogleToken;
}

export async function clearProviderToken(provider: string): Promise<void> {
  const profileId = await currentProfileId();
  if (!profileId) return;
  const supabase = await createClient();
  await supabase
    .from("google_oauth_tokens")
    .delete()
    .eq("profile_id", profileId)
    .eq("provider", provider);
}

export async function recordProviderAuthFailure(
  provider: string,
  message: string
): Promise<void> {
  const profileId = await currentProfileId();
  if (!profileId) return;
  const supabase = await createClient();
  await supabase
    .from("google_oauth_tokens")
    .update({ last_error: message.slice(0, 500) })
    .eq("profile_id", profileId)
    .eq("provider", provider);
}

export async function getProviderConnectionStatus(
  provider: string,
  requiredScopes: string[]
): Promise<ConnectionStatus> {
  const token = await loadProviderToken(provider);
  if (!token) {
    return {
      connected: false,
      email: null,
      scopes: [],
      missingScopes: requiredScopes,
      expiresAt: null,
      fragile: true,
    };
  }
  const granted = (token.scope ?? "").split(/\s+/).filter(Boolean);
  return {
    connected: Boolean(token.refresh_token || token.access_token),
    email: token.google_email,
    scopes: granted,
    missingScopes: requiredScopes.filter((s) => !granted.includes(s)),
    expiresAt: token.expiry_date ? new Date(token.expiry_date).toISOString() : null,
    fragile: !token.refresh_token,
  };
}
