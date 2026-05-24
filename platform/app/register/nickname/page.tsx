"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NicknamePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = nickname.trim();
    if (!trimmed) {
      setError("Please enter a nickname.");
      return;
    }
    if (trimmed.length > 30) {
      setError("Nickname must be 30 characters or less.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("You must be logged in.");
        setLoading(false);
        return;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ nickname: trimmed })
        .eq("id", user.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
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
            Welcome to CleverPlatform!
          </h1>
          <p className="mt-2 text-sm text-da-muted">
            Choose a nickname — this is how you&apos;ll appear in class.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="nickname"
              className="block text-sm font-medium text-da-text"
            >
              Your nickname
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Sali, CJ, Min"
              maxLength={30}
              autoFocus
              className="mt-1 block w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
            />
            <p className="mt-1 text-xs text-da-muted">
              This can be your first name, a shortened name, or whatever you&apos;d
              like your teacher and classmates to call you.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !nickname.trim()}
            className="w-full rounded-lg border border-da-accent/40 bg-da-accent px-4 py-3 text-sm font-semibold text-[#2b1408] shadow-sm transition-colors hover:bg-da-amber focus:outline-none focus:ring-2 focus:ring-da-accent focus:ring-offset-2 focus:ring-offset-da-surface disabled:opacity-50"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
