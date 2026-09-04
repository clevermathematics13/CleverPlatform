"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SettingsClient({
  initialShowHiddenStudents,
}: {
  initialShowHiddenStudents: boolean;
}) {
  const router = useRouter();
  const [showHiddenStudents, setShowHiddenStudents] = useState(initialShowHiddenStudents);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !showHiddenStudents;
    setShowHiddenStudents(next);
    setSaving(true);
    setError(null);
    const res = await fetch("/api/teacher-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show_hidden_students: next }),
    });
    setSaving(false);
    if (!res.ok) {
      setShowHiddenStudents(!next);
      setError("Could not save this setting.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
      {error && (
        <div className="mb-3 rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
          {error}
        </div>
      )}
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block font-semibold text-da-text">Show hidden students</span>
          <span className="block text-xs text-da-muted">
            Include hidden roster entries (e.g. test accounts) in student counts and lists
            across the dashboard, gradebook, courses, and parents pages.
          </span>
        </span>
        <input
          type="checkbox"
          checked={showHiddenStudents}
          onChange={toggle}
          disabled={saving}
          className="h-5 w-5 shrink-0 rounded border-da-border text-da-accent focus:ring-da-accent"
        />
      </label>
    </div>
  );
}
