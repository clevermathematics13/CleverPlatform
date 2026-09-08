"use client";

/**
 * Bulk-fill student numbers from a pasted PowerSchool roster.
 *
 * Typing fifty student numbers by hand is the kind of task that gets done
 * wrong once and then produces half-matching PowerSchool imports forever, so
 * this takes the roster straight out of PowerSchool or a spreadsheet.
 *
 * Whatever cannot be matched is reported rather than guessed at, and both
 * directions are shown: lines that named nobody, and students the paste said
 * nothing about. The second list is the one that matters -- those are exactly
 * the students whose scores will not import.
 */

import { useState, useTransition } from "react";
import { bulkSetStudentNumbers } from "./actions";

type Result = Awaited<ReturnType<typeof bulkSetStudentNumbers>>;

export function StudentNumberPaste({ courseId }: { courseId: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("paste", text);
      if (courseId) fd.append("course_id", courseId);
      setResult(await bulkSetStudentNumbers(fd));
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-da-border px-3 py-2 text-sm text-da-muted transition-colors hover:border-da-accent/60 hover:text-da-text"
      >
        Paste student numbers
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-da-border bg-da-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-da-text">Paste student numbers</h3>
          <p className="mt-1 text-xs text-da-muted">
            One student per line, number and name in either order, separated by a tab
            or a comma — paste straight from a PowerSchool roster export.
            {courseId ? " Only the selected course is matched." : " All courses are matched."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setResult(null); }}
          className="shrink-0 text-xs text-da-muted hover:text-da-text"
        >
          Close
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"120451\tCaipo, Santiago\n120452\tDelisle, Freya"}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-3 py-2 font-mono text-xs text-da-text focus:border-da-accent focus:outline-none"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !text.trim()}
          className="rounded-md bg-da-accent/20 px-3 py-1.5 text-sm font-medium text-da-accent transition-colors hover:bg-da-accent/30 disabled:opacity-50"
        >
          {isPending ? "Matching…" : "Match and save"}
        </button>
        {result && (
          <span className="text-xs text-da-muted">
            {result.applied} saved
            {result.unmatchedLines.length > 0 && `, ${result.unmatchedLines.length} line(s) unmatched`}
          </span>
        )}
      </div>

      {result && (
        <div className="mt-3 space-y-2 text-xs">
          {result.error && <p className="text-red-400">{result.error}</p>}
          {result.unmatchedLines.length > 0 && (
            <div>
              <p className="font-medium text-amber-300">
                Lines that matched no student (or matched more than one):
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-da-muted">
                {result.unmatchedLines.slice(0, 10).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
                {result.unmatchedLines.length > 10 && (
                  <li>…and {result.unmatchedLines.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
          {result.unmatchedStudents.length > 0 && (
            <div>
              <p className="font-medium text-amber-300">
                Still without a number — their scores will not import:
              </p>
              <p className="mt-1 text-da-muted">
                {result.unmatchedStudents.slice(0, 15).join(", ")}
                {result.unmatchedStudents.length > 15 &&
                  ` …and ${result.unmatchedStudents.length - 15} more`}
              </p>
            </div>
          )}
          {result.unmatchedLines.length === 0 && result.unmatchedStudents.length === 0 && (
            <p className="text-emerald-400">Every student on this roster now has a number.</p>
          )}
        </div>
      )}
    </div>
  );
}
