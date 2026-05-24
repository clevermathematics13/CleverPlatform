"use client";

import { useState } from "react";
import Link from "next/link";
import { createCourse, updateCourse, deleteCourse } from "./actions";

interface CourseRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  studentCount: number;
  testCount: number;
}

export function CourseList({ courses }: { courses: CourseRow[] }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleCreate(name: string, description: string) {
    setIsLoading(true);
    setGlobalError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("description", description);
    const result = await createCourse(fd);
    setIsLoading(false);
    if (result.error) setGlobalError(result.error);
    else setShowCreate(false);
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
      {/* Create Course Button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setShowCreate(true); setEditingId(null); setGlobalError(null); }}
          className="inline-flex items-center gap-2 rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] shadow-sm transition-colors hover:bg-da-amber"
        >
          + New Course
        </button>
      </div>

      {globalError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {globalError}
        </p>
      )}

      {/* Create Form */}
      {showCreate && (
        <CourseForm
          onCancel={() => setShowCreate(false)}
          onSave={handleCreate}
          isPending={isLoading}
        />
      )}

      {/* Course Cards */}
      {courses.length === 0 && !showCreate ? (
        <div className="rounded-xl border border-dashed border-da-border bg-da-surface/70 p-12 text-center">
          <p className="text-sm text-da-muted">No courses yet. Create one above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <div
              key={course.id}
              className="flex flex-col rounded-xl border border-da-border bg-da-surface/85 shadow-sm shadow-black/35"
            >
              {editingId === course.id ? (
                <div className="p-5 flex-1">
                  <CourseForm
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
                    Delete &ldquo;{course.name}&rdquo;?
                  </p>
                  <p className="text-xs text-gray-500 mb-4">
                    This will remove the course and unenroll all {course.studentCount} student
                    {course.studentCount !== 1 ? "s" : ""}. This cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(course.id)}
                      disabled={isLoading}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {isLoading ? "Deleting…" : "Yes, delete"}
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
                  {/* Card body */}
                  <div className="p-5 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-lg font-bold leading-tight text-da-text">{course.name}</h2>
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => { setEditingId(course.id); setDeletingId(null); setShowCreate(false); }}
                          className="rounded p-1 text-da-muted hover:bg-da-hover hover:text-da-text transition-colors"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => { setDeletingId(course.id); setEditingId(null); setShowCreate(false); }}
                          className="rounded p-1 text-da-muted hover:bg-red-900/25 hover:text-red-300 transition-colors"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {course.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-da-muted">{course.description}</p>
                    )}

                    {/* Stats */}
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

                  {/* Card footer links */}
                  <div className="flex border-t border-da-border/70">
                    <Link
                      href={`/dashboard/students?course=${course.id}`}
                      className="flex-1 rounded-bl-xl px-4 py-2.5 text-center text-xs font-semibold text-da-accent transition-colors hover:bg-da-hover hover:text-da-amber"
                    >
                      Students →
                    </Link>
                    <div className="w-px bg-da-border/70" />
                    <Link
                      href={`/dashboard/gradebook?course=${course.id}`}
                      className="flex-1 rounded-br-xl px-4 py-2.5 text-center text-xs font-semibold text-da-accent transition-colors hover:bg-da-hover hover:text-da-amber"
                    >
                      Gradebook →
                    </Link>
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

function CourseForm({
  initialName = "",
  initialDescription = "",
  onSave,
  onCancel,
  isPending,
}: {
  initialName?: string;
  initialDescription?: string;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const isEdit = Boolean(initialName);

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
          placeholder="e.g. IBDP AAHL"
          className="mt-1 block w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-sm text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-da-text">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — e.g. IB Analysis & Approaches Higher Level"
          className="mt-1 block w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-sm text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber disabled:opacity-50"
        >
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Create course"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-da-border px-4 py-2 text-sm font-medium text-da-text transition-colors hover:bg-da-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
