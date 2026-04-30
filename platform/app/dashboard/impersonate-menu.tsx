"use client";

import { startImpersonation, stopImpersonation } from "./impersonate-actions";

export function ImpersonateMenu({
  currentRole,
  impersonating,
  impersonatedStudentName,
}: {
  currentRole: string;
  impersonating: string | null;
  impersonatedStudentName: string | null;
}) {
  if (currentRole !== "teacher") return null;

  if (impersonating) {
    return (
      <form action={stopImpersonation}>
        <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <p className="text-xs font-medium text-amber-800">
            👁 Viewing as:{" "}
            <span className="font-bold">
              {impersonatedStudentName ?? "Student"}
            </span>
          </p>
          <button
            type="submit"
            className="mt-1 w-full rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200 transition-colors"
          >
            ← Back to Teacher view
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mb-2">
      <p className="mb-1 text-xs font-medium text-gray-500">View as:</p>
      <div className="flex gap-1">
        <form action={startImpersonation} className="flex-1">
          <input type="hidden" name="role" value="student" />
          <button
            type="submit"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Student
          </button>
        </form>
        <form action={startImpersonation} className="flex-1">
          <input type="hidden" name="role" value="parent" />
          <button
            type="submit"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Parent
          </button>
        </form>
      </div>
    </div>
  );
}
