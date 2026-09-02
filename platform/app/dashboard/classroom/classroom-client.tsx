"use client";

import { Fragment, useMemo, useState } from "react";
import {
  fetchCourseWork,
  fetchSubmissions,
  saveGrade,
  type SubmissionRow,
  type ClassroomCourseWithLink,
} from "./actions";
import type { CourseWorkItem } from "@/lib/google-classroom-work";

interface Analysis {
  work_status?: string;
  transcription?: string;
  assessment?: string;
  misconceptions?: string[];
  suggested_marks?: number | null;
  confidence?: string;
  confidence_notes?: string;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-green-500/15 text-green-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-red-500/15 text-red-300",
};

const STATE_LABELS: Record<string, string> = {
  TURNED_IN: "Turned in",
  RETURNED: "Returned",
  CREATED: "Assigned",
  NEW: "Not started",
  RECLAIMED_BY_STUDENT: "Reclaimed",
};

export function ClassroomClient({
  courses,
  initialError,
}: {
  courses: ClassroomCourseWithLink[];
  initialError?: string;
}) {
  const hasAnyLinks = courses.some((c) => c.linkedCourseName);
  const [showAllCourses, setShowAllCourses] = useState(!hasAnyLinks);
  const [courseId, setCourseId] = useState("");
  const [work, setWork] = useState<CourseWorkItem[]>([]);
  const [courseWorkId, setCourseWorkId] = useState("");
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loadingWork, setLoadingWork] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectedWork = work.find((w) => w.id === courseWorkId);

  const visibleCourses = useMemo(() => {
    if (showAllCourses || !hasAnyLinks) return courses;
    return courses.filter((c) => c.linkedCourseName);
  }, [courses, showAllCourses, hasAnyLinks]);

  async function onCourseChange(id: string) {
    setCourseId(id);
    setCourseWorkId("");
    setWork([]);
    setRows([]);
    setAnalyses({});
    setError("");
    if (!id) return;

    setLoadingWork(true);
    const res = await fetchCourseWork(id);
    setLoadingWork(false);
    if (res.error) setError(res.error);
    setWork(res.items);
  }

  async function onWorkChange(id: string) {
    setCourseWorkId(id);
    setRows([]);
    setAnalyses({});
    setError("");
    if (!id) return;

    setLoadingRows(true);
    const res = await fetchSubmissions(courseId, id);
    setLoadingRows(false);
    if (res.error) setError(res.error);
    setRows(res.rows);
  }

  async function analyse(row: SubmissionRow) {
    setBusy((b) => ({ ...b, [row.id]: true }));
    setError("");
    try {
      const res = await fetch("/api/classroom/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          courseWorkId,
          submissionId: row.id,
          maxPoints: selectedWork?.maxPoints ?? null,
          questionContext: selectedWork
            ? `${selectedWork.title}\n\n${selectedWork.description ?? ""}`.trim()
            : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed.");
        return;
      }
      setAnalyses((a) => ({ ...a, [row.id]: data.analysis as Analysis }));
      setExpanded(row.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  }

  async function applyMarks(row: SubmissionRow, marks: number) {
    setBusy((b) => ({ ...b, [row.id]: true }));
    const res = await saveGrade(courseId, courseWorkId, row.id, marks);
    setBusy((b) => ({ ...b, [row.id]: false }));
    if (!res.ok) {
      setError(res.error ?? "Could not save the mark.");
      return;
    }
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, draftGrade: marks } : r))
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Selectors */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-semibold text-da-text">
              Classroom course
            </label>
            {hasAnyLinks && (
              <button
                type="button"
                onClick={() => setShowAllCourses((v) => !v)}
                className="text-xs text-da-accent hover:underline"
              >
                {showAllCourses ? "Show linked classes only" : "Show all courses"}
              </button>
            )}
          </div>
          <select
            value={courseId}
            onChange={(e) => onCourseChange(e.target.value)}
            className="block w-full rounded-lg border border-da-border bg-da-surface px-3 py-2 text-sm font-medium text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
          >
            <option value="">Select a course...</option>
            {visibleCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.section ? ` — ${c.section}` : ""}
                {c.linkedCourseName ? ` (${c.linkedCourseName})` : ""}
              </option>
            ))}
          </select>
          {hasAnyLinks && !showAllCourses && (
            <p className="mt-1 text-xs text-da-muted">
              Showing classes linked on the{" "}
              <a href="/dashboard/students" className="underline hover:text-da-accent">
                Students page
              </a>
              .
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-da-text">
            Assignment
          </label>
          <select
            value={courseWorkId}
            onChange={(e) => onWorkChange(e.target.value)}
            disabled={!courseId || loadingWork}
            className="block w-full rounded-lg border border-da-border bg-da-surface px-3 py-2 text-sm font-medium text-da-text shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent disabled:bg-da-hover disabled:text-da-muted"
          >
            <option value="">
              {loadingWork ? "Loading..." : "Select an assignment..."}
            </option>
            {work.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
                {w.maxPoints ? ` (${w.maxPoints} marks)` : ""}
                {w.dueDate ? ` — due ${w.dueDate}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {courseId && !loadingWork && work.length === 0 && (
        <p className="text-sm text-da-muted">
          No coursework found in this course.
        </p>
      )}

      {loadingRows && (
        <p className="text-sm text-da-muted">Loading submissions...</p>
      )}

      {/* Submissions */}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-da-border bg-da-surface">
          <table className="min-w-full divide-y divide-da-border">
            <thead className="bg-da-hover">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-da-muted">
                  Student
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-da-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-da-muted">
                  Files
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-da-muted">
                  Clev&apos;s Marks
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-da-border">
              {rows.map((row) => {
                const analysis = analyses[row.id];
                const isOpen = expanded === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className="align-top">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-da-text">
                          {row.fullName}
                        </div>
                        <div className="text-xs text-da-muted">{row.email}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-da-text">
                        {STATE_LABELS[row.state ?? ""] ?? row.state ?? "—"}
                        {analysis?.work_status
                          ? ` - ${analysis.work_status}`
                          : ""}
                        {row.late && (
                          <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                            Late
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-da-text">
                        {row.attachments.length === 0 ? (
                          <span className="text-da-muted">None</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {row.attachments.map((a) => (
                              <li key={a.driveFileId}>
                                <a
                                  href={a.alternateLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-300 hover:text-blue-200"
                                >
                                  {a.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-da-text">
                        {row.assignedGrade ?? row.draftGrade ?? "—"}
                        {selectedWork?.maxPoints
                          ? ` / ${selectedWork.maxPoints}`
                          : ""}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {analysis && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded(isOpen ? null : row.id)
                              }
                              className="text-xs text-da-muted hover:text-da-text"
                            >
                              {isOpen ? "Hide" : "Show"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => analyse(row)}
                            disabled={
                              busy[row.id] || row.attachments.length === 0
                            }
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-da-hover"
                          >
                            {busy[row.id]
                              ? "Reading..."
                              : analysis
                                ? "Re-read"
                                : "Read work"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {analysis && isOpen && (
                      <tr className="bg-da-hover">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="space-y-4 text-sm">
                            <div className="flex flex-wrap items-center gap-3">
                              {analysis.confidence && (
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                    CONFIDENCE_STYLES[analysis.confidence] ??
                                    "bg-da-hover text-da-text"
                                  }`}
                                >
                                  {analysis.confidence} confidence
                                </span>
                              )}
                              {analysis.confidence_notes && (
                                <span className="text-xs text-da-muted">
                                  {analysis.confidence_notes}
                                </span>
                              )}
                              {analysis.suggested_marks != null && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    applyMarks(
                                      row,
                                      analysis.suggested_marks as number
                                    )
                                  }
                                  disabled={busy[row.id]}
                                  className="rounded-lg border border-blue-600 px-3 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                                >
                                  Apply {analysis.suggested_marks} as draft
                                  Clev&apos;s Marks
                                </button>
                              )}
                            </div>

                            {analysis.transcription && (
                              <div>
                                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-da-muted">
                                  Transcription
                                </h4>
                                <pre className="whitespace-pre-wrap rounded-lg border border-da-border bg-da-surface p-3 font-mono text-xs text-da-text">
                                  {analysis.transcription}
                                </pre>
                              </div>
                            )}

                            {analysis.assessment && (
                              <div>
                                <div className="mb-1 flex items-center gap-2">
                                  <h4 className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                                    Assessment
                                  </h4>
                                  {analysis.work_status && (
                                    <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
                                      {analysis.work_status}
                                    </span>
                                  )}
                                </div>
                                <p className="whitespace-pre-wrap text-da-text">
                                  {analysis.assessment}
                                </p>
                              </div>
                            )}

                            {analysis.misconceptions &&
                              analysis.misconceptions.length > 0 && (
                                <div>
                                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-da-muted">
                                    Misconceptions
                                  </h4>
                                  <ul className="list-inside list-disc space-y-0.5 text-da-text">
                                    {analysis.misconceptions.map((m, i) => (
                                      <li key={i}>{m}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
