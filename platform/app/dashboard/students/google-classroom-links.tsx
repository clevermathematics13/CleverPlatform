"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  fetchGoogleCourses,
  linkClassroomCourse,
  unlinkClassroomCourse,
  type ClassroomLink,
} from "./google-classroom-actions";

interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
}

export function GoogleClassroomLinks({
  courses,
  initialConnected,
  initialLinks,
}: {
  courses: { id: string; name: string }[];
  initialConnected: boolean;
  initialLinks: ClassroomLink[];
}) {
  const router = useRouter();
  const [links, setLinks] = useState<ClassroomLink[]>(initialLinks);
  const [gcCourses, setGcCourses] = useState<ClassroomCourse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGcCourseId, setSelectedGcCourseId] = useState("");
  const [selectedCpCourseId, setSelectedCpCourseId] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialConnected && gcCourses.length === 0) {
      setLoading(true);
      fetchGoogleCourses()
        .then(setGcCourses)
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConnected]);

  const linkedGcCourseIds = new Set(links.map((l) => l.googleCourseId));
  const availableGcCourses = gcCourses.filter(
    (c) => !linkedGcCourseIds.has(c.id) || c.id === selectedGcCourseId
  );

  async function handleLink() {
    if (!selectedGcCourseId || !selectedCpCourseId) return;
    const gc = gcCourses.find((c) => c.id === selectedGcCourseId);
    if (!gc) return;

    setSaving(true);
    setError("");

    const formData = new FormData();
    formData.set("course_id", selectedCpCourseId);
    formData.set("google_course_id", gc.id);
    formData.set("google_course_name", gc.name);
    if (gc.section) formData.set("google_course_section", gc.section);

    try {
      const res = await linkClassroomCourse(formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSelectedGcCourseId("");
      setSelectedCpCourseId("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlink(link: ClassroomLink) {
    setRemovingId(link.id);
    setError("");
    try {
      const res = await unlinkClassroomCourse(link.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      router.refresh();
    } finally {
      setRemovingId(null);
    }
  }

  if (!initialConnected) {
    return null;
  }

  return (
    <div className="mt-6 rounded-xl border border-da-border bg-da-surface">
      <div className="flex items-center gap-3 px-6 py-4">
        <span className="text-lg">🔗</span>
        <div>
          <h2 className="text-sm font-semibold text-da-text">
            Linked classes
          </h2>
          <p className="text-xs text-da-muted">
            Match each Google Classroom course to a CleverPlatform course.
            This is the mapping the Classroom grading page and roster import
            use — set it up once per class.
          </p>
        </div>
      </div>

      <div className="border-t border-da-border px-6 py-4 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {links.length > 0 && (
          <ul className="divide-y divide-da-border rounded-lg border border-da-border overflow-hidden">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex items-center justify-between gap-3 bg-da-hover/40 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-da-text truncate">
                    {link.courseName}
                  </p>
                  <p className="text-xs text-da-muted truncate">
                    ← {link.googleCourseName}
                    {link.googleCourseSection ? ` — ${link.googleCourseSection}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnlink(link)}
                  disabled={removingId === link.id}
                  className="shrink-0 text-xs text-da-muted hover:text-da-danger disabled:opacity-50"
                >
                  {removingId === link.id ? "Removing..." : "Unlink"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {loading ? (
          <p className="text-sm text-da-muted">Loading your Google Classroom courses...</p>
        ) : gcCourses.length === 0 ? (
          <p className="text-sm text-da-muted">
            No Google Classroom courses found on your connected account.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-da-text">
                Google Classroom course
              </label>
              <select
                value={selectedGcCourseId}
                onChange={(e) => setSelectedGcCourseId(e.target.value)}
                className="block w-64 rounded-lg border border-da-border bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
              >
                <option value="">Select a course...</option>
                {availableGcCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.section ? ` — ${c.section}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <span className="pb-2 text-da-muted">→</span>

            <div>
              <label className="mb-1 block text-xs font-semibold text-da-text">
                CleverPlatform course
              </label>
              <select
                value={selectedCpCourseId}
                onChange={(e) => setSelectedCpCourseId(e.target.value)}
                className="block w-48 rounded-lg border border-da-border bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
              >
                <option value="">Select a course...</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleLink}
              disabled={saving || !selectedGcCourseId || !selectedCpCourseId}
              className="da-btn"
              style={{
                background: "var(--color-da-accent)",
                borderColor: "var(--color-da-accent)",
                color: "var(--color-da-bg)",
              }}
            >
              {saving ? "Linking..." : "Link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
