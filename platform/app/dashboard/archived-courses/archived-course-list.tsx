"use client";

import { useState } from "react";
import Link from "next/link";
import { unarchiveCourse, deleteCourse, updateCourse } from "../courses/actions";

interface CourseRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  studentCount: number;
  testCount: number;
}

export function ArchivedCourseList({ courses }: { courses: CourseRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleUnarchive(id: string) {
    setIsLoading(true);
    setGlobalError(null);
    const fd = new FormData();
    fd.set("id", id);
    const result = await unarchiveCourse(fd);
    setIsLoading(false);
    if (result.error) setGlobalError(result.error);
  }

  async function handleUpdate(id: string, name: string, description: string) {
    setIsLoading(true);
    setGlobalError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("name", name);
    fd.set("description", description);
    const result = await updateCourse(fd);
    setIsLoading(false);
    if (result.error) setGlobalError(result.error);
    else setEditingId(null);
  }

  async function handleDelete(id: string) {
    setIsLoading(true);
    setGlobalError(null);
    const fd = new FormData();
    fd.set("id", id);
    const result = await deleteCourse(fd);
    setIsLoading(false);
    if (result.error) setGlobalError(result.error);
    else setDeletingId(null);
  }

  return (
    <div className="mt-6 space-y-6">
      {globalError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {globalError}
        </p>
      )}

      {courses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-da-border bg-da-surface/70 p-12 text-center">
          <p className="text-sm text-da-muted">
            No archived courses. Archive a course from the{" "}
            <Link href="/dashboard/courses" className="text-da-accent hover:underline">
              Courses page
            </Link>{" "}
            to see it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <div
              key={course.id}
              className="flex flex-col rounded-xl border border-da-border bg-da-surface/60 opacity-90 shadow-sm shadow-black/35"
            >
              {editingId === course.id ? (
                <div className="p-5 flex-1">
                  <ArchivedCourseForm
                    initialName={course.name}
                    initialDescription={course.description ?? ""}
                    onCancel={() => setEditingId(null)}
                    onSave={(name, description) => handleUpdate(course.id, name, description)}
                    isPending={isLoading}
                  />
                </div>
              ) : deletingId === course.id ? (
                <div className="p-5 flex-1">
                  <p className="text-sm font-medium text-gray-900 mb-1">
                    Permanently delete &ldquo;{course.name}&rdquo;?
                  </p>
                  <p className="text-xs text-gray-500 mb-4">
                    This unenrolls all {course.studentCount} student
                    {course.studentCount !== 1 ? "s" : ""} and cannot be undone. If this course
                    still has tests attached, deletion will be blocked.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(course.id)}
                      disabled={isLoading}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {isLoading ? "Deleting…" : "Yes, delete permanently"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(null)}
                      className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-5 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-lg font-bold leading-tight text-da-text">{course.name}</h2>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-da-hover px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-da-muted">
                          Archived
                        </span>
                        <button
                          type="button"
                          onClick={() => { setEditingId(course.id); setDeletingId(null); }}
                          className="rounded p-1 text-da-muted hover:bg-da-hover hover:text-da-text transition-colors"
                          title="Rename / edit"
                        >
                          ✏️
                        </button>
                      </div>
                    </div>

                    {course.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-da-muted">{course.description}</p>
                    )}

                    <div className="mt-3 flex gap-4">
                      <span className="flex items-center gap-1 text-sm text-da-text">
                        <span className="text-base">👥</span>
                        <span className="font-semibold">{course.studentCount}</span>
                        <span className="text-da-muted">student{course.studentCount !== 1 ? "s" : ""}</span>
                      </span>
                      <span className="flex items-center gap-1 text-sm text-da-text">
                        <span className="text-base">📝</span>
                        <span className="font-semibold">{course.testCount}</span>
                        <span className="text-da-muted">test{course.testCount !== 1 ? "s" : ""}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex border-t border-da-border/70">
                    <button
                      type="button"
                      onClick={() => handleUnarchive(course.id)}
                      disabled={isLoading}
                      className="flex-1 rounded-bl-xl px-4 py-2.5 text-center text-xs font-semibold text-da-accent transition-colors hover:bg-da-hover hover:text-da-amber disabled:opacity-50"
                    >
                      {isLoading ? "Unarchiving…" : "Unarchive"}
                    </button>
                    <div className="w-px bg-da-border/70" />
                    <button
                      type="button"
                      onClick={() => setDeletingId(course.id)}
                      disabled={isLoading}
                      className="flex-1 rounded-br-xl px-4 py-2.5 text-center text-xs font-semibold text-red-400 transition-colors hover:bg-red-900/20 hover:text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Same shape as the CourseForm on the active Courses page, kept as its own
 * copy here rather than a shared import: this one is always in "edit"
 * mode (archived courses are only ever renamed, never created from this
 * page), so the isEdit branching and create-specific copy on the other
 * component would just be dead weight here.
 */
function ArchivedCourseForm({
  initialName,
  initialDescription,
  onSave,
  onCancel,
  isPending,
}: {
  initialName: string;
  initialDescription: string;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(name, description);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-da-text">
          Course name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mt-1 block w-full rounded-lg border border-da-border bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-da-text">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
          className="mt-1 block w-full rounded-lg border border-da-border bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-black shadow-md shadow-black/40 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-amber-500/40 disabled:text-black/50 disabled:shadow-none"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-da-border px-4 py-2.5 text-sm font-medium text-da-text transition-colors hover:bg-da-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
