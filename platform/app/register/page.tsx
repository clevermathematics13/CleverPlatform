"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Parent registration by one-time code.
 *
 * SECURITY: the client must never read or write `registration_codes` directly.
 * The table previously carried `SELECT USING (true)` / `UPDATE USING (true)`
 * policies for the `public` role, which let any holder of the anon key
 * enumerate every live code together with its `student_id`.
 *
 * Redemption now happens entirely inside `redeem_registration_code(p_code)`,
 * a SECURITY DEFINER function that derives the caller from `auth.uid()`,
 * validates and burns the code, creates the `parent_links` row and promotes
 * the profile to 'parent' in a single transaction. It returns a uniform
 * `{ ok: false, error: 'invalid' }` for wrong / used / expired codes so that
 * codes cannot be probed.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const trimmedCode = code.trim().toUpperCase();

      // Step 1: Create the account. The code is carried in user metadata so
      // that a later sign-in can complete redemption if email confirmation
      // is required and no session is issued here.
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { registration_code: trimmedCode },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      // Step 2: Without a session we cannot redeem yet (email confirmation on).
      if (!authData.session) {
        setNotice(
          "Account created. Please confirm your email address, then sign in to finish linking your account."
        );
        return;
      }

      // Step 3: Ensure a profile row exists. Role and email are forced
      // server-side by the profiles insert trigger — anything sent here for
      // those columns is ignored by design.
      const userId = authData.user?.id;
      if (userId) {
        await supabase.from("profiles").upsert(
          {
            id: userId,
            email,
            display_name: email.split("@")[0],
          },
          { onConflict: "id" }
        );
      }

      // Step 4: Redeem atomically. This is the only privileged step.
      const { data: result, error: rpcError } = await supabase.rpc(
        "redeem_registration_code",
        { p_code: trimmedCode }
      );

      if (rpcError) {
        setError("Could not complete registration. Please try again.");
        return;
      }

      // The RPC returns jsonb, which supabase-js types as `Json`. Narrow it
      // explicitly rather than reaching into an untyped value.
      const redeemed =
        typeof result === "object" &&
        result !== null &&
        (result as { ok?: boolean }).ok === true;

      if (!redeemed) {
        setError("Invalid or expired registration code.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-da-bg px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-da-border bg-da-surface/90 p-8 shadow-2xl shadow-black/55 wood-surface">
        <div className="text-center">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-da-text">
            Parent Registration
          </h1>
          <p className="mt-2 text-sm text-da-muted">
            Enter the registration code provided by the teacher
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-md border border-da-accent/40 bg-da-accent/10 p-4 text-sm text-da-text">
            {notice}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-6">
          <div>
            <label
              htmlFor="code"
              className="block text-sm font-medium text-da-text"
            >
              Registration Code
            </label>
            <input
              id="code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. ABC123"
              className="mt-1 block w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-da-text"
            >
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="parent@example.com"
              className="mt-1 block w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-da-text"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="mt-1 block w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg border border-da-accent/40 bg-da-accent px-4 py-3 text-sm font-semibold text-da-on-accent shadow-sm transition-colors hover:bg-da-amber focus:outline-none focus:ring-2 focus:ring-da-accent focus:ring-offset-2 focus:ring-offset-da-surface disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Register"}
          </button>
        </form>

        <div className="text-center">
          <a
            href="/login"
            className="text-sm font-medium text-da-accent hover:text-da-amber"
          >
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
