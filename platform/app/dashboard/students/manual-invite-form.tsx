"use client";

import { useActionState, useState } from "react";
import { addManualInvite } from "./actions";

export function ManualInviteForm({
  courses,
  defaultCourseId,
}: {
  courses: { id: string; name: string }[];
  defaultCourseId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (
      _prev: { error?: string; success?: boolean; inviteLink?: string } | null,
      formData: FormData
    ) => {
      setCopied(false);
      return await addManualInvite(formData);
    },
    null
  );

  const handleCopyInviteLink = async () => {
    if (!state?.inviteLink) return;
    await navigator.clipboard.writeText(`${window.location.origin}${state.inviteLink}`);
    setCopied(true);
  };

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">Manual Invite Exception</h3>
          <p className="text-xs text-amber-800">
            Use only if a student is missing from Google Classroom.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          {open ? "Hide manual invite" : "Manual invite"}
        </button>
      </div>

      {open && (
        <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="exception-email" className="block text-xs font-medium text-amber-900">
              Student Email
            </label>
            <input
              id="exception-email"
              name="email"
              type="email"
              required
              placeholder="student@amersol.edu.pe"
              className="mt-1 block w-64 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="exception-name" className="block text-xs font-medium text-amber-900">
              Full Name (optional)
            </label>
            <input
              id="exception-name"
              name="full_name"
              type="text"
              placeholder="Student name"
              className="mt-1 block w-56 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="exception-course" className="block text-xs font-medium text-amber-900">
              Course
            </label>
            <select
              id="exception-course"
              name="course_id"
              required
              defaultValue={defaultCourseId ?? ""}
              className="mt-1 block w-48 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
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
            className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {pending ? "Inviting..." : "Create Invite"}
          </button>

          {state?.error && <p className="w-full text-sm text-red-700">{state.error}</p>}
          {state?.success && state?.inviteLink && (
            <div className="w-full rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <p>Invite created.</p>
              <p className="mt-1 break-all font-mono text-xs text-green-900">{state.inviteLink}</p>
              <button
                type="button"
                onClick={handleCopyInviteLink}
                className="mt-2 rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800"
              >
                {copied ? "Copied" : "Copy Invite Link"}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
