"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveClassStudents, unarchiveClassStudents } from "./actions";

interface Course {
  id: string;
  name: string;
}

interface Props {
  courses: Course[];
  activeCourseId: string | null;
  activeCourseName?: string | null;
  classMemberCount: number;
  classIsFullyArchived: boolean;
}

export function CourseFilterBar({ courses, activeCourseId, activeCourseName, classMemberCount, classIsFullyArchived }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCourseChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setConfirming(false);
    setError(null);
    router.push(value ? `/dashboard/students?course=${value}` : "/dashboard/students");
  }

  function handleArchiveToggle() {
    if (!activeCourseId) return;
    setError(null);
    const fd = new FormData();
    fd.set("course_id", activeCourseId);

    startTransition(async () => {
      const action = classIsFullyArchived ? unarchiveClassStudents : archiveClassStudents;
      const result = await action(fd);
      if (result?.error) {
        setError(result.error);
      } else {
        setConfirming(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-da-border bg-da-surface/70 px-4 py-3">
      <label className="flex items-center gap-2 text-sm font-medium text-da-text">
        Course
        <select
          value={activeCourseId ?? ""}
          onChange={handleCourseChange}
          className="rounded-lg border border-da-border bg-da-bg/70 px-3 py-1.5 text-sm text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {/* An archived course is deliberately absent from `courses`, but if
              one is currently selected it still needs an option to render
              against -- otherwise the select falls back to "All courses" and
              the Unarchive button becomes unreachable. */}
          {activeCourseId && !courses.some((c) => c.id === activeCourseId) && (
            <option value={activeCourseId}>{activeCourseName ?? "(archived class)"} — archived</option>
          )}
        </select>
      </label>

      {activeCourseId && (
        <>
          <div className="h-5 w-px bg-da-border" />

          {classMemberCount === 0 && !classIsFullyArchived ? (
            <span className="text-xs text-da-muted">No students in this class yet.</span>
          ) : confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-da-text">
                {classIsFullyArchived
                  ? "Unarchive this class? It'll reappear in course pickers and the student list."
                  : "Archive this class? It'll be hidden from course pickers and the student list. Students are kept, not deleted."}
              </span>
              <button
                type="button"
                onClick={handleArchiveToggle}
                disabled={isPending}
                className={
                  classIsFullyArchived
                    ? "rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                    : "rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                }
              >
                {isPending
                  ? classIsFullyArchived
                    ? "Unarchiving…"
                    : "Archiving…"
                  : classIsFullyArchived
                    ? "Yes, unarchive class"
                    : "Yes, archive class"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={
                classIsFullyArchived
                  ? "rounded-lg border border-green-400/40 px-3 py-1.5 text-xs font-semibold text-green-300 hover:bg-green-500/15 transition-colors"
                  : "rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/15 transition-colors"
              }
            >
              {classIsFullyArchived ? "Unarchive class" : "Archive class"}
            </button>
          )}

          {error && <span className="text-xs text-red-300">{error}</span>}
        </>
      )}
    </div>
  );
}
