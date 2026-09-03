"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/brand/Logo";

type TestRole = "parent" | "student" | "teacher";

const ROLE_OPTIONS: { value: TestRole; label: string; description: string }[] = [
  { value: "parent", label: "Parent", description: "View a linked student's progress" },
  { value: "student", label: "Student", description: "Assignments, feedback, and the student dashboard" },
  { value: "teacher", label: "Admin", description: "Full teacher access" },
];

function ChooseRoleForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const [choosing, setChoosing] = useState<TestRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(role: TestRole) {
    if (choosing) return;
    setChoosing(role);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_test_account_role", {
      p_role: role,
    });
    if (rpcError) {
      setError(rpcError.message);
      setChoosing(null);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-da-bg px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-da-border bg-da-surface/90 p-8 shadow-2xl shadow-black/55 wood-surface">
        <div className="text-center">
          <h1 className="text-da-text">
            <Logo size={30} variant="embossed" />
          </h1>
          <p className="mt-3 text-sm text-da-muted">
            This account can sign in as more than one role. Choose one for this session.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => choose(opt.value)}
              disabled={choosing !== null}
              className="w-full rounded-lg border border-da-border bg-da-hover px-4 py-3 text-left transition-colors hover:border-da-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-semibold text-da-text">
                {choosing === opt.value ? "Signing in..." : opt.label}
              </p>
              <p className="text-xs text-da-muted">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ChooseRolePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-da-muted">
          Loading...
        </div>
      }
    >
      <ChooseRoleForm />
    </Suspense>
  );
}
