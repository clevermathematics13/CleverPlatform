"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ViewAsOption } from "@/lib/view-as";

/**
 * Teacher's "View as" picker. Navigating is the whole mechanism: choosing a
 * student just sets ?viewAs=<invitedStudentId> on the current URL, and
 * leaving removes it. Because the state lives in the URL rather than a
 * cookie, it is scoped to this TAB -- another tab stays on whatever view
 * its own URL says, teacher or a different student.
 */
export function ImpersonateMenu({
  currentRole,
  viewingName,
  viewingCourse,
  viewingHasAccount,
  options,
}: {
  currentRole: string;
  viewingName: string | null;
  viewingCourse: string | null;
  viewingHasAccount: boolean;
  options: ViewAsOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  if (currentRole !== "teacher") return null;

  const go = (invitedStudentId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (invitedStudentId) params.set("viewAs", invitedStudentId);
    else params.delete("viewAs");
    // Other pages' params (scanId, viewStudent) belong to the teacher view
    // and mean something different once impersonating, so they are dropped
    // on entering or leaving rather than carried into the wrong context.
    params.delete("scanId");
    params.delete("viewStudent");
    const qs = params.toString();
    setOpen(false);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  if (viewingName) {
    return (
      <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2">
        <p className="text-xs font-medium text-amber-300">
          &#128065; Viewing as: <span className="font-bold">{viewingName}</span>
          {viewingCourse ? <span className="font-normal"> &middot; {viewingCourse}</span> : null}
        </p>
        {!viewingHasAccount && (
          <p className="mt-1 text-[11px] leading-snug text-amber-200/80">
            This student has not signed in yet, so anything tied to their account is still empty.
          </p>
        )}
        <p className="mt-1 text-[11px] text-amber-200/70">This tab only.</p>
        <button
          type="button"
          onClick={() => go(null)}
          className="mt-1.5 w-full rounded bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/30"
        >
          &larr; Back to Teacher view
        </button>
      </div>
    );
  }

  const byCourse = new Map<string, ViewAsOption[]>();
  for (const o of options) {
    const list = byCourse.get(o.courseName) ?? [];
    list.push(o);
    byCourse.set(o.courseName, list);
  }

  return (
    <div className="mb-2">
      <p className="mb-1 text-xs font-medium text-da-muted">View as:</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-da-border px-2 py-1 text-xs text-da-text transition-colors hover:bg-da-hover"
      >
        Student {open ? "▴" : "▾"}
      </button>

      {open && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded border border-da-border bg-da-surface">
          {options.length === 0 && (
            <p className="px-2 py-2 text-xs text-da-muted">No students on an active course.</p>
          )}
          {[...byCourse.entries()].map(([course, students]) => (
            <div key={course}>
              <p className="sticky top-0 bg-da-surface px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-da-muted">
                {course}
              </p>
              {students.map((s) => (
                <button
                  key={s.invitedStudentId}
                  type="button"
                  onClick={() => go(s.invitedStudentId)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs text-da-text transition-colors hover:bg-da-hover"
                >
                  <span className="truncate">{s.name}</span>
                  {!s.hasAccount && (
                    <span
                      className="shrink-0 text-[10px] text-da-muted"
                      title="Has not signed in yet"
                    >
                      no login
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
