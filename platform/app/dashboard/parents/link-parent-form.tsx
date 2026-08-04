"use client";

import { useActionState } from "react";
import { linkParent } from "./actions";

export type StudentOption = {
  studentId: string;
  studentName: string;
  courseName: string;
};

export function LinkParentForm({ students }: { students: StudentOption[] }) {
  const [state, formAction, pending] = useActionState(linkParent, null);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-6">
      <h2 className="text-xl font-bold text-blue-900">Link a Parent</h2>
      <p className="mt-1 text-base text-blue-700">
        Enter the parent&apos;s email and pick their student. If the parent has
        already signed in to CleverPlatform, they&apos;re linked immediately.
        If not, they&apos;ll be promoted to the parent role and linked
        automatically the first time they sign in — no further action needed
        from you.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="parent-email" className="block text-xs font-medium text-blue-900">
            Parent Email
          </label>
          <input
            id="parent-email"
            name="parent_email"
            type="email"
            required
            placeholder="parent@example.com"
            className="mt-1 block w-64 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="parent-student" className="block text-xs font-medium text-blue-900">
            Student
          </label>
          <select
            id="parent-student"
            name="student_id"
            required
            defaultValue=""
            className="mt-1 block w-64 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select student...</option>
            {students.map((s) => (
              <option key={s.studentId} value={s.studentId}>
                {s.studentName} ({s.courseName})
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? "Linking..." : "Link Parent"}
        </button>

        {state?.error && <p className="w-full text-sm text-red-700">{state.error}</p>}
        {state?.success && (
          <p className="w-full text-sm text-green-700">{state.message}</p>
        )}
      </form>
    </div>
  );
}
