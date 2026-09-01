"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ViewAsOption } from "@/lib/view-as";
import { foldText } from "@/lib/fold-text";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

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
    setQuery("");
    // A FULL navigation, not router.push. The sidebar and the banner are
    // rendered by the dashboard LAYOUT, and Next's App Router does not
    // re-render a layout when only search params change -- it reuses the
    // cached one. Since ?viewAs= is exactly a search-param change, a soft
    // push left the teacher's menus and picker on screen while the page
    // beneath had already switched to the student. Entering or leaving a
    // view is a rare, deliberate mode switch, so paying for a real page
    // load here is the right trade for a layout guaranteed to match.
    window.location.assign(qs ? `${pathname}?${qs}` : pathname);
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

  // Matches on name OR course, so "9c" narrows to a class just as well as
  // a name does.
  const needle = foldText(query.trim());
  const filtered = needle
    ? options.filter((o) => foldText(o.name).includes(needle) || foldText(o.courseName).includes(needle))
    : options;

  const byCourse = new Map<string, ViewAsOption[]>();
  for (const o of filtered) {
    const list = byCourse.get(o.courseName) ?? [];
    list.push(o);
    byCourse.set(o.courseName, list);
  }

  return (
    <div className="mb-2">
      <p className="mb-1 text-xs font-medium text-da-muted">View as:</p>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
        className="w-full rounded border border-da-border px-2 py-1 text-xs text-da-text transition-colors hover:bg-da-hover"
      >
        Student {open ? "▴" : "▾"}
      </button>

      {open && (
        <div className="mt-1 rounded border border-da-border bg-da-surface">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                setQuery("");
              }
              // Enter picks the top match, so a teacher can type a few
              // letters and go without reaching for the mouse.
              if (e.key === "Enter" && filtered.length > 0) {
                e.preventDefault();
                go(filtered[0].invitedStudentId);
              }
            }}
            placeholder="Search students…"
            aria-label="Search students"
            className="w-full rounded-t border-b border-da-border bg-transparent px-2 py-1.5 text-xs text-da-text placeholder:text-da-muted focus:outline-none focus:ring-1 focus:ring-da-accent"
          />
          <div className="max-h-64 overflow-y-auto">
          {options.length === 0 && (
            <p className="px-2 py-2 text-xs text-da-muted">No students on an active course.</p>
          )}
          {options.length > 0 && filtered.length === 0 && (
            <p className="px-2 py-2 text-xs text-da-muted">
              No student matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          {[...byCourse.entries()].map(([course, students]) => (
            <div key={course}>
              <p className="sticky top-0 z-10 bg-da-surface px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-da-muted">
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
        </div>
      )}
    </div>
  );
}
