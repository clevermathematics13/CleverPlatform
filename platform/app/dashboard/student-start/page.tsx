import { requireRole } from "@/lib/auth";

const ACTIVITY_URL = process.env.NEXT_PUBLIC_STUDENT_ACTIVITY_URL || "#";

export default async function StudentStartPage() {
  const profile = await requireRole("student");
  const hasActivity = ACTIVITY_URL !== "#";

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-bold text-gray-900">Student Start</h1>
      <p className="mt-2 text-sm text-gray-600">
        Hi {profile.display_name}. Use the link below to open your interactive activity.
      </p>

      <div className="mt-6">
        {hasActivity ? (
          <a
            href={ACTIVITY_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Open Interactive Activity
          </a>
        ) : (
          <span className="inline-flex cursor-not-allowed items-center rounded-lg bg-gray-400 px-4 py-2 text-sm font-medium text-white">
            Open Interactive Activity
          </span>
        )}
        {!hasActivity && (
          <p className="mt-2 text-xs text-gray-500">
            Activity link not set yet. Add NEXT_PUBLIC_STUDENT_ACTIVITY_URL to enable this button.
          </p>
        )}
      </div>
    </div>
  );
}
