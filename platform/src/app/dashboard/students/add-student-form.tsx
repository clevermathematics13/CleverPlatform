"use client";

import { useActionState } from "react";
import { addStudent } from "./actions";

export function AddStudentForm({
  courses,
  defaultCourseId,
}: {
  courses: { id: string; name: string }[];
  defaultCourseId?: string;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) => {
      return await addStudent(formData);
    },
    null
  );

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-4" suppressHydrationWarning>
      <div suppressHydrationWarning>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-gray-700"
        >
          Student Email
        </label>
        <input
          type="email"
          name="email"
          id="email"
          required
          placeholder="student@example.com"
          className="mt-1 block w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          suppressHydrationWarning
        />
      </div>
      <div>
        <label
          htmlFor="course_id"
          className="block text-sm font-medium text-gray-700"
        >
          Course
        </label>
        <select
          name="course_id"
          id="course_id"
          required
          defaultValue={defaultCourseId ?? ""}
          className="mt-1 block w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select course...</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Enrolling..." : "Enroll Student"}
      </button>

      {state?.error && (
        <p className="w-full text-sm text-red-600">{state.error}</p>
      )}
      {state?.success && (
        <p className="w-full text-sm text-green-600">
          Student enrolled successfully!
        </p>
      )}
    </form>
  );
}
