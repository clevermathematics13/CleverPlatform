"use client";

import { useState, useEffect } from "react";
import {
  getGoogleAuthUrl,
  isGoogleConnected,
  disconnectGoogle,
  fetchGoogleCourses,
  fetchGoogleStudents,
  importGoogleStudents,
} from "./google-classroom-actions";

interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
}

interface ClassroomStudent {
  userId: string;
  fullName: string;
  email: string;
}

export function GoogleClassroomImport({
  courses,
  initialConnected,
}: {
  courses: { id: string; name: string }[];
  initialConnected: boolean;
}) {
  const [connected, setConnected] = useState(initialConnected);
  const [gcCourses, setGcCourses] = useState<ClassroomCourse[]>([]);
  const [gcStudents, setGcStudents] = useState<ClassroomStudent[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [targetCourseId, setTargetCourseId] = useState("");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported?: number;
    skipped?: number;
    errors?: string[];
    error?: string;
  } | null>(null);

  // When connected changes (e.g. after OAuth redirect), load courses
  useEffect(() => {
    if (connected && gcCourses.length === 0) {
      setLoading(true);
      fetchGoogleCourses()
        .then(setGcCourses)
        .catch(() => setConnected(false))
        .finally(() => setLoading(false));
    }
  }, [connected, gcCourses.length]);

  async function handleConnect() {
    const url = await getGoogleAuthUrl();
    window.location.href = url;
  }

  async function handleDisconnect() {
    await disconnectGoogle();
    setConnected(false);
    setGcCourses([]);
    setGcStudents([]);
    setSelectedCourseId("");
    setSelectedEmails(new Set());
  }

  async function handleSelectGcCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setGcStudents([]);
    setSelectedEmails(new Set());
    setResult(null);

    if (!courseId) return;

    setLoadingStudents(true);
    try {
      const students = await fetchGoogleStudents(courseId);
      setGcStudents(students);
      // Select all by default
      setSelectedEmails(new Set(students.map((s) => s.email)));
    } finally {
      setLoadingStudents(false);
    }
  }

  function toggleEmail(email: string) {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selectedEmails.size === gcStudents.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(gcStudents.map((s) => s.email)));
    }
  }

  async function handleImport() {
    if (!targetCourseId || selectedEmails.size === 0) return;

    setImporting(true);
    setResult(null);

    const formData = new FormData();
    formData.set("course_id", targetCourseId);
    for (const email of selectedEmails) {
      formData.append("student_email", email);
      const student = gcStudents.find((s) => s.email === email);
      formData.append("student_name", student?.fullName ?? email.split("@")[0]);
    }

    try {
      const res = await importGoogleStudents(formData);
      setResult(res);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mt-10 rounded-xl border border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4">
        <span className="text-lg">📥</span>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Import from Google Classroom
          </h2>
          <p className="text-xs text-gray-500">
            Pull student rosters from your Google Classroom courses
          </p>
        </div>
      </div>

      <div className="border-t border-gray-200 px-6 py-4 space-y-4">
          {/* Step 1: Connect */}
          {!connected ? (
            <div>
              <p className="text-sm text-gray-600 mb-3">
                Sign in with your school Google account to access your Classroom
                rosters.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </button>
            </div>
          ) : (
            <>
              {/* Connected state */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Connected to Google Classroom
                </span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Disconnect
                </button>
              </div>

              {/* Step 2: Select Google Classroom course */}
              {loading ? (
                <p className="text-sm text-gray-500">
                  Loading your courses...
                </p>
              ) : gcCourses.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No active courses found in your Google Classroom.
                </p>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Google Classroom Course
                  </label>
                  <select
                    value={selectedCourseId}
                    onChange={(e) => handleSelectGcCourse(e.target.value)}
                    className="block w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select a course...</option>
                    {gcCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.section ? ` — ${c.section}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Step 3: Select students */}
              {loadingStudents && (
                <p className="text-sm text-gray-500">Loading students...</p>
              )}

              {gcStudents.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Students ({selectedEmails.size} / {gcStudents.length}{" "}
                      selected)
                    </label>
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      {selectedEmails.size === gcStudents.length
                        ? "Deselect all"
                        : "Select all"}
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {gcStudents.map((student) => (
                      <label
                        key={student.userId}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedEmails.has(student.email)}
                          onChange={() => toggleEmail(student.email)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {student.fullName}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {student.email}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>

                  {/* Step 4: Target course + import */}
                  <div className="mt-4 flex flex-wrap items-end gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Import into CleverPlatform course
                      </label>
                      <select
                        value={targetCourseId}
                        onChange={(e) => setTargetCourseId(e.target.value)}
                        className="block w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Select course...</option>
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleImport}
                      disabled={
                        importing ||
                        !targetCourseId ||
                        selectedEmails.size === 0
                      }
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {importing
                        ? "Importing..."
                        : `Import ${selectedEmails.size} student${selectedEmails.size !== 1 ? "s" : ""}`}
                    </button>
                  </div>
                </div>
              )}

              {/* Result */}
              {result && (
                <div
                  className={`rounded-lg p-3 text-sm ${result.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
                >
                  {result.error ? (
                    <p>{result.error}</p>
                  ) : (
                    <>
                      <p>
                        Invited {result.imported} student
                        {result.imported !== 1 ? "s" : ""}.
                        {(result.skipped ?? 0) > 0 &&
                          ` Skipped ${result.skipped}.`}
                        {" "}They&apos;ll be auto-enrolled when they log in.
                      </p>
                      {result.errors && result.errors.length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
                          {result.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
    </div>
  );
}
