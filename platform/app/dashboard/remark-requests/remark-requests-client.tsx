"use client";

import { useMemo, useState } from "react";
import type { ReflectionMarkScheme } from "@/lib/reflection-types";
import {
  TEACHER_NOTE_MAX,
  buildRemarkQueue,
  remarkMarkMoved,
  remarkNowAgrees,
} from "@/lib/remark-requests";
import type { TeacherRemarkEntry } from "@/lib/remark-requests-service";
import { studentViewHref } from "@/lib/reflection-links";
import { MarkSchemePart } from "@/components/reflection/MarkSchemePart";

interface RemarkRequestsClientProps {
  waiting: TeacherRemarkEntry[];
  resolved: TeacherRemarkEntry[];
  schemes: Record<string, ReflectionMarkScheme>;
  resolvedWindowDays: number;
}

/** A date as the server and the browser both print it -- a locale-formatted
 *  one would differ between the two and break hydration. */
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * The waiting requests, grouped by test and then by part in paper order, so
 * one part's mark scheme is printed once above everything asked about it.
 * An answered request leaves the list in place -- no refresh, which would
 * re-render and re-typeset every other card on a page that can hold a
 * hundred of them.
 */
export function RemarkRequestsClient({ waiting, resolved, schemes, resolvedWindowDays }: RemarkRequestsClientProps) {
  const [open, setOpen] = useState(waiting);
  const [answered, setAnswered] = useState(resolved);
  const [status, setStatus] = useState<string | null>(null);
  const queue = useMemo(() => buildRemarkQueue(open), [open]);

  const onAnswered = (entry: TeacherRemarkEntry, warning: string | null) => {
    setOpen((prev) => prev.filter((e) => e.id !== entry.id));
    setAnswered((prev) => [entry, ...prev]);
    const what =
      entry.status === "changed"
        ? `ClevMarks changed from ${entry.marksAtRequest} to ${entry.resolvedMarks}`
        : `ClevMarks stand at ${entry.resolvedMarks}`;
    setStatus(`${entry.studentName}, ${entry.testName} ${entry.partLabel}: ${what}.${warning ? ` ${warning}` : ""}`);
  };

  return (
    <div className="space-y-8">
      {status && (
        <p className="rounded-lg border border-da-border bg-da-surface px-4 py-2 text-sm text-da-text">{status}</p>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-da-text">Waiting ({open.length})</h2>
        {open.length === 0 && (
          <p className="rounded-lg border border-da-border/50 bg-da-surface px-4 py-3 text-sm text-da-muted">
            No re-mark requests are waiting for you.
          </p>
        )}
        {queue.map((test) => {
          const hidden = test.parts[0]?.requests[0]?.testHidden ?? false;
          return (
            <div key={test.testId} className="rounded-xl border border-da-border bg-da-surface p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-lg font-bold text-da-text">{test.testName}</h3>
                <span className="text-sm text-da-muted">{test.count} waiting</span>
                {hidden && (
                  <span className="rounded bg-da-hover px-1.5 py-0.5 text-xs text-da-muted">hidden from students</span>
                )}
                <a
                  href={`/dashboard/tests/${test.testId}/ai-grade`}
                  className="ml-auto text-xs text-da-accent hover:underline"
                >
                  Marking screen ↗
                </a>
              </div>
              {test.parts.map((part) => {
                const first = part.requests[0];
                const scheme = schemes[part.testItemId];
                return (
                  <div key={part.testItemId} className="border-t border-da-border/40 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-bold text-da-amber">{first.partLabel}</span>
                      <span className="text-xs text-da-muted">max {first.maxMarks}</span>
                      <span className="text-xs text-da-muted">
                        {part.requests.length === 1 ? "1 request" : `${part.requests.length} requests`}
                      </span>
                    </div>
                    {scheme && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-da-muted hover:text-da-text">
                          Mark scheme (as the student sees it)
                        </summary>
                        <MarkSchemePart scheme={scheme} />
                      </details>
                    )}
                    <ul className="mt-2 space-y-3">
                      {part.requests.map((entry) => (
                        <RequestCard key={entry.id} entry={entry} onAnswered={onAnswered} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      <details className="rounded-xl border border-da-border bg-da-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-da-text">
          Answered in the last {resolvedWindowDays} days ({answered.length})
        </summary>
        {answered.length === 0 ? (
          <p className="mt-2 text-sm text-da-muted">Nothing answered yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-da-border/40 text-sm">
            {answered.map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-da-text">{e.studentName}</span>
                  <span className="text-da-muted">
                    {e.testName} · {e.partLabel}
                  </span>
                  <span className={e.status === "changed" ? "text-green-300" : "text-da-text"}>
                    {e.status === "changed"
                      ? `Changed ${e.marksAtRequest} → ${e.resolvedMarks}`
                      : `Stands at ${e.resolvedMarks}`}
                  </span>
                  <span className="text-xs text-da-muted">{day(e.resolvedAt)}</span>
                </div>
                {e.teacherNote && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-da-muted">Note: {e.teacherNote}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function RequestCard({
  entry,
  onAnswered,
}: {
  entry: TeacherRemarkEntry;
  onAnswered: (entry: TeacherRemarkEntry, warning: string | null) => void;
}) {
  const [mark, setMark] = useState(String(entry.currentMarks ?? entry.marksAtRequest));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"changed" | "stands" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = mark.trim() === "" ? NaN : Number(mark);
  const markValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= entry.maxMarks;
  const canChange = markValid && parsed !== entry.marksAtRequest;
  const canKeep = entry.currentMarks !== null;
  const moved = remarkMarkMoved(entry);
  const agrees = remarkNowAgrees(entry);

  const answer = async (outcome: "changed" | "stands") => {
    setBusy(outcome);
    setError(null);
    try {
      const res = await fetch(`/api/remark-requests/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          newMarks: outcome === "changed" ? parsed : undefined,
          note,
          expectedCurrentMarks: entry.currentMarks,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        auditWarning?: string | null;
        marks_awarded?: number;
        remark?: { status: "changed" | "stands"; resolved_marks: number; teacher_note: string | null; resolved_at: string };
      };
      if (!res.ok || !data.remark) throw new Error(data.error ?? `The answer could not be saved (${res.status}).`);
      onAnswered(
        {
          ...entry,
          status: data.remark.status,
          resolvedMarks: data.remark.resolved_marks,
          teacherNote: data.remark.teacher_note,
          resolvedAt: data.remark.resolved_at,
          currentMarks: data.marks_awarded ?? entry.currentMarks,
        },
        data.auditWarning ?? null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The answer could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const badge = "rounded px-1.5 py-0.5 text-[11px]";

  return (
    <li className="rounded-lg border border-da-border/60 bg-da-bg/40 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-da-text">{entry.studentName}</span>
        <span className="text-da-muted">
          ClevMarks <strong className="text-da-text">{entry.currentMarks ?? "—"}</strong>
          {" · "}Self{" "}
          <strong className="text-da-text">{entry.currentSelfMarks ?? "no attempt"}</strong>
          {" "}/ {entry.maxMarks}
        </span>
        <span className="text-xs text-da-muted">
          asked {day(entry.createdAt)}
          {entry.updatedAt !== entry.createdAt ? ", edited" : ""}
        </span>
        {moved && (
          <span className={`${badge} bg-amber-500/15 text-amber-200`}>
            was {entry.marksAtRequest} when asked
          </span>
        )}
        {agrees && <span className={`${badge} bg-green-900/30 text-green-300`}>their mark now agrees</span>}
        {entry.hasUpload && <span className={`${badge} bg-da-hover text-da-muted`}>corrections uploaded</span>}
        <a
          href={studentViewHref(entry.testId, entry.studentId)}
          className="ml-auto text-xs text-da-accent hover:underline"
        >
          Student&apos;s view ↗
        </a>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-da-amber/50 pl-3 text-sm text-da-text">
        {entry.explanation}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-da-muted">
          Mark
          <input
            type="number"
            min={0}
            max={entry.maxMarks}
            step={1}
            value={mark}
            onChange={(e) => setMark(e.target.value)}
            className="ml-2 w-16 rounded border border-da-border bg-da-surface px-2 py-1 text-center text-sm font-bold text-da-text focus:ring-2 focus:ring-da-accent"
          />
        </label>
        <label className="min-w-[16rem] flex-1 text-xs text-da-muted">
          Note to the student (optional)
          <textarea
            rows={2}
            maxLength={TEACHER_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-da-border bg-da-surface p-2 text-sm text-da-text focus:ring-2 focus:ring-da-accent"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canKeep || busy !== null}
            onClick={() => void answer("stands")}
            title={canKeep ? `Keep ClevMarks at ${entry.currentMarks}` : "This part has no ClevMark to keep"}
            className="rounded-lg border border-da-border bg-da-surface px-3 py-1.5 text-sm font-semibold text-da-text hover:bg-da-hover disabled:opacity-50"
          >
            {busy === "stands" ? "Saving…" : "Mark stands"}
          </button>
          <button
            type="button"
            disabled={!canChange || busy !== null}
            onClick={() => void answer("changed")}
            title={canChange ? `Change ClevMarks to ${parsed}` : `Enter a mark other than ${entry.marksAtRequest}`}
            className="rounded-lg bg-da-accent px-3 py-1.5 text-sm font-bold text-da-bg hover:bg-da-amber disabled:opacity-50"
          >
            {busy === "changed" ? "Saving…" : "Mark changed"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </li>
  );
}
