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
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
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
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">No courses yet. Create one above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <div
              key={course.id}
              className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col"
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
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
                      <h2 className="text-lg font-bold text-gray-900 leading-tight">{course.name}</h2>
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => { setEditingId(course.id); setDeletingId(null); setShowCreate(false); }}
                          className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => { setDeletingId(course.id); setEditingId(null); setShowCreate(false); }}
                          className="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {course.description && (
                      <p className="mt-1 text-sm text-gray-500 line-clamp-2">{course.description}</p>
                    )}

                    {/* Stats */}
                    <div className="mt-3 flex gap-4">
                      <span className="flex items-center gap-1 text-sm text-gray-600">
                        <span className="text-base">👥</span>
                        <span className="font-semibold">{course.studentCount}</span>
                        <span className="text-gray-400">student{course.studentCount !== 1 ? "s" : ""}</span>
                      </span>
                      <span className="flex items-center gap-1 text-sm text-gray-600">
                        <span className="text-base">📝</span>
                        <span className="font-semibold">{course.testCount}</span>
                        <span className="text-gray-400">test{course.testCount !== 1 ? "s" : ""}</span>
                      </span>
                    </div>
                  </div>

                  {/* Card footer links */}
                  <div className="flex border-t border-gray-100">
                    <Link
                      href={`/dashboard/students?course=${course.id}`}
                      className="flex-1 px-4 py-2.5 text-center text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800 transition-colors rounded-bl-xl"
                    >
                      Students →
                    </Link>
                    <div className="w-px bg-gray-100" />
                    <Link
                      href={`/dashboard/gradebook?course=${course.id}`}
                      className="flex-1 px-4 py-2.5 text-center text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800 transition-colors rounded-br-xl"
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
        <label className="block text-sm font-medium text-gray-700">
          Course name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. IBDP AAHL"
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — e.g. IB Analysis & Approaches Higher Level"
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Create course"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
