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
  classMemberCount: number;
  classIsFullyArchived: boolean;
}

export function CourseFilterBar({ courses, activeCourseId, classMemberCount, classIsFullyArchived }: Props) {
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
        </select>
      </label>

      {activeCourseId && (
        <>
          <div className="h-5 w-px bg-da-border" />

          {classMemberCount === 0 ? (
            <span className="text-xs text-da-muted">No students in this class yet.</span>
          ) : confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-da-text">
                {classIsFullyArchived
                  ? `Unarchive all ${classMemberCount} student${classMemberCount !== 1 ? "s" : ""} in this class?`
                  : `Archive all ${classMemberCount} student${classMemberCount !== 1 ? "s" : ""} in this class? They'll be hidden but not deleted.`}
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
                  ? "rounded-lg border border-green-300 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 transition-colors"
                  : "rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
              }
            >
              {classIsFullyArchived ? "Unarchive class" : "Archive class"}
            </button>
          )}

          {error && <span className="text-xs text-red-600">{error}</span>}
        </>
      )}
    </div>
  );
}
