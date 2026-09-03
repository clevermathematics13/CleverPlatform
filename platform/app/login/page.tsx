"use client";

import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { BouncingSphere } from "@/components/brand/BouncingSphere";

// The PKCE code verifier lives in a cookie shared by every tab on this
// origin. Starting a sign-in in a second tab overwrites the verifier an
// already-in-flight tab needs, so that first tab's redirect back from
// Google fails with "PKCE code verifier not found in storage" even though
// nothing was double-clicked. We can't reliably block this across tabs
// without real cross-tab messaging, so this just warns: a recent-enough
// localStorage timestamp (shared across tabs on this origin) means
// another tab may still be mid-flow.
const OAUTH_PENDING_KEY = "cleverplatform_oauth_pending_since";
const OAUTH_PENDING_WINDOW_MS = 2 * 60 * 1000;

function LoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";
  const invitedEmail = searchParams.get("invitedEmail");
  const [staySignedIn, setStaySignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [multiTabWarning, setMultiTabWarning] = useState(false);

  useEffect(() => {
    try {
      const pendingSince = Number(localStorage.getItem(OAUTH_PENDING_KEY) ?? 0);
      if (pendingSince > 0 && Date.now() - pendingSince < OAUTH_PENDING_WINDOW_MS) {
        setMultiTabWarning(true);
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) -- skip the warning.
    }
  }, []);

  const handleGoogleLogin = async () => {
    // Guard against a second click firing before the redirect happens --
    // each call generates its own PKCE code verifier and overwrites the
    // one stored for the in-flight attempt, so a double-fire here is a
    // real cause of "PKCE code verifier not found in storage" failures.
    if (signingIn) return;
    setSigningIn(true);
    try {
      localStorage.setItem(OAUTH_PENDING_KEY, String(Date.now()));
    } catch {
      // Not fatal -- the multi-tab warning just won't fire for this attempt.
    }
    const supabase = createClient();
    const callbackParams = new URLSearchParams({
      next: redirectTo,
      persistent: staySignedIn ? "1" : "0",
    });

    if (invitedEmail) {
      callbackParams.set("invitedEmail", invitedEmail);
    }

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?${callbackParams.toString()}`,
      },
    });
  };

  const getErrorMessage = (value: string) => {
    if (value === "auth_callback_failed") {
      return "Authentication failed. Please try again.";
    }

    if (value === "school_email_required") {
      return "Please sign in with your amersol.edu.pe school email.";
    }

    if (value === "student_not_invited") {
      return "This email is not on the invited student list yet. Please contact your teacher.";
    }

    if (value === "invite_email_mismatch") {
      return "Please sign in with the same email that received this invite link.";
    }

    return "An error occurred. Please try again.";
  };

  return (
    <div className="relative min-h-screen bg-da-bg">
      {/* One focal object, one action. Everything the visitor needs is one
          bar across the top; the orb has the rest of the viewport to bounce
          in, wall to wall, and passes behind the bar if it gets that high. */}
      <BouncingSphere />

      <header className="relative z-10 border-b border-da-border bg-da-surface/90 shadow-2xl shadow-black/55 wood-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <h1 className="flex items-center gap-5 text-da-text">
            <Logo size={56} variant="embossed" />
            <span className="hidden text-sm text-da-muted md:inline">Mathematics Learning Platform</span>
          </h1>

          <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={staySignedIn}
                onChange={(e) => setStaySignedIn(e.target.checked)}
                className="h-4 w-4 rounded border-da-border text-da-accent focus:ring-da-accent"
              />
              <span className="text-sm text-da-muted">Stay signed in</span>
            </label>
            <button
              onClick={handleGoogleLogin}
              disabled={signingIn}
              style={{ backgroundColor: "var(--color-da-accent)", color: "var(--color-da-on-accent)" }}
              className="flex items-center justify-center gap-3 rounded-lg border border-da-accent/40 px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:bg-da-amber focus:outline-none focus:ring-2 focus:ring-da-accent focus:ring-offset-2 focus:ring-offset-da-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {signingIn ? "Redirecting…" : "Sign in with Google"}
            </button>
            <a
              href="/register"
              className="text-sm font-medium text-da-accent transition-colors hover:text-da-amber"
            >
              Parent access: register with your code
            </a>
          </div>
        </div>
      </header>

      {(error || multiTabWarning || invitedEmail) && (
        <div className="relative z-10 mx-auto max-w-2xl space-y-3 px-4 pt-6">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
              {getErrorMessage(error)}
            </div>
          )}

          {!error && multiTabWarning && (
            <div className="rounded-md border border-amber-500/40 bg-amber-900/30 p-4 text-sm text-amber-100">
              It looks like a sign-in may already be in progress in another tab. Signing in from
              two tabs at once can make one of them fail — finish there if you can, or continue
              here to start fresh.
            </div>
          )}

          {invitedEmail && (
            <div className="rounded-md border border-da-border bg-da-bg/55 p-4 text-sm text-da-text">
              Invite email: <span className="font-semibold">{invitedEmail}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-da-muted">Loading...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
