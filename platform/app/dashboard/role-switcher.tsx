"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Role switcher for the two multi-role test accounts.
 *
 * The same choice /login/choose-role offers, moved to where it is needed
 * again. That page is reachable only in the seconds after signing in, so
 * picking "Student" used to be one-way: the student dashboard has no teacher
 * controls on it, and the only route back was signing out and in again.
 *
 * `set_test_account_role` is SECURITY DEFINER and checks auth.uid() against
 * the two allowed profile ids itself, so this button cannot grant a role to
 * anyone else even if it were rendered for them. `canSwitchRole` is about not
 * showing a control that would only ever fail.
 *
 * Distinct from the "View as" picker below it, which is a teacher previewing
 * a student's pages without changing who they are. This changes the account's
 * actual role, for every tab, until it is changed back.
 */
const ROLES: { value: "teacher" | "student" | "parent"; label: string; hint: string }[] = [
  { value: "teacher", label: "Teacher", hint: "Full access" },
  { value: "student", label: "Student", hint: "Assignments and feedback" },
  { value: "parent", label: "Parent", hint: "A linked student's progress" },
];

export function RoleSwitcher({ currentRole }: { currentRole: string }) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (role: string) => {
    if (switching || role === currentRole) return;
    setSwitching(role);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_test_account_role", { p_role: role });
    if (rpcError) {
      setError(rpcError.message);
      setSwitching(null);
      return;
    }
    // Back to /dashboard rather than staying put: the page currently open may
    // belong to the role being left behind, and landing on a redirect to
    // /login reads as the switch having failed.
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="border-t border-da-border pt-2 mt-1 px-3 pb-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-da-muted">
        Signed in as
      </p>
      <div role="radiogroup" aria-label="Account role" className="mt-1.5 grid grid-cols-3 gap-1">
        {ROLES.map((r) => {
          const active = r.value === currentRole;
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={r.hint}
              disabled={switching !== null}
              onClick={() => choose(r.value)}
              className={`rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${
                active
                  ? "border-da-accent/50 bg-da-accent/20 text-da-accent"
                  : "border-da-border text-da-muted hover:bg-da-hover hover:text-da-text"
              }`}
            >
              {switching === r.value ? "…" : r.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-da-muted">
        Changes this account&apos;s role everywhere, not just this tab.
      </p>
      {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
