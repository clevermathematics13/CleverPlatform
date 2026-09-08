import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Starting the Google sign-in, in the one order that survives a stale session.
 *
 * ## The bug this exists for
 *
 * Signing in failed on the first attempt and worked on the second, every
 * time, with `?error=auth_callback_failed` in between and this in the server
 * log:
 *
 *     Auth code exchange failed: PKCE code verifier not found in storage.
 *
 * `createBrowserClient` starts recovering the stored session in its
 * constructor -- `initialize()` is fired and not awaited. `signInWithOAuth`
 * is one of the few auth-js methods that does NOT await that promise: it goes
 * straight to `_getUrlForProvider`, which writes the PKCE code verifier to
 * `sb-<ref>-auth-token-code-verifier` and redirects to Google.
 *
 * So the two run concurrently. When the jar holds an expired session, the
 * recovery that is still in flight tries to refresh it, gets
 * `refresh_token_not_found`, and calls `_removeSession()` -- which deletes the
 * session AND `<storageKey>-code-verifier`. It lands during the `await` inside
 * `signInWithOAuth` (generating the PKCE challenge hashes, so it yields), and
 * takes the verifier that same click just wrote. The browser then leaves for
 * Google carrying no verifier, and /auth/callback has nothing to exchange the
 * code against.
 *
 * The second attempt worked because the first one's `_removeSession()` had
 * cleared the stale session: with nothing to recover there was nothing to
 * remove, and the verifier survived.
 *
 * ## The fix
 *
 * Await the client's initialization before writing the verifier.
 * `getSession()` awaits `initializePromise` and reads storage only, so by the
 * time it returns, recovery has finished and any stale session has already
 * been discarded. Nothing is left in flight to delete the verifier behind us.
 *
 * lib/supabase/middleware.ts documents the same deletion one layer up, on the
 * server, where it was fixed by not touching cookies on the callback route.
 * This is the remaining half of it, in the browser.
 */
export async function startGoogleSignIn(
  supabase: SupabaseClient,
  redirectTo: string
) {
  // Not for its return value. This is the wait.
  await supabase.auth.getSession();

  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}
