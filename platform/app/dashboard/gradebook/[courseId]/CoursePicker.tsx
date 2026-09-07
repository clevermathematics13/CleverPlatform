"use client";

/**
 * CoursePicker
 * ------------
 * The gradebook's course title, doubling as the control that switches class.
 *
 * Getting from 9A to 9C meant going back to /dashboard/gradebook and picking
 * again -- two navigations away from the thing you were already looking at.
 * The title is where the teacher's attention already is, and it already names
 * the class, so it is the honest place to hang the switch.
 *
 * Options are the same non-archived list the gradebook index shows, so the two
 * cannot disagree about which classes exist. An archived course's gradebook is
 * still reachable by URL, so the current course is pinned into the list even
 * when it is not in that set -- otherwise it would show as no selection at all.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type CourseOption = { id: string; name: string };

export function CoursePicker({
  current,
  courses,
}: {
  current: CourseOption;
  courses: CourseOption[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // One course, or none to move to: a control that opens a menu of itself is
  // worse than a plain heading.
  if (courses.length <= 1) {
    return <h1 className="text-3xl font-bold text-da-text font-serif">{current.name}</h1>;
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <h1>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Switch class"
          className="group flex items-baseline gap-2 rounded-md font-serif text-3xl font-bold text-da-text transition-colors hover:text-da-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-da-accent/60"
        >
          {current.name}
          <span
            className={`font-sans text-sm text-da-muted transition-transform group-hover:text-da-accent ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
      </h1>

      {open && (
        <div
          role="menu"
          aria-label="Switch class"
          className="absolute left-0 z-30 mt-2 min-w-56 overflow-hidden rounded-xl border border-da-border bg-da-surface shadow-lg shadow-black/40"
        >
          {courses.map((c) => {
            const isCurrent = c.id === current.id;
            return (
              <Link
                key={c.id}
                role="menuitem"
                href={`/dashboard/gradebook/${c.id}`}
                onClick={() => setOpen(false)}
                aria-current={isCurrent ? "page" : undefined}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isCurrent
                    ? "bg-da-accent/10 font-semibold text-da-accent"
                    : "text-da-text hover:bg-da-hover hover:text-da-accent"
                }`}
              >
                {c.name}
                {isCurrent && <span aria-hidden="true">✓</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
