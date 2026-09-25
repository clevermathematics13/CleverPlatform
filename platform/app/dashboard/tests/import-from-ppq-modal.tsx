"use client";

import { useEffect, useState } from "react";

interface SavedExamSummary {
  id: string;
  name: string;
  curriculum: string;
  level: string;
  paper: number;
  course_id: string | null;
  course_name: string | null;
  exam_date: string | null;
  question_count: number;
  total_marks: number;
}

/** A finished import whose warnings the teacher has not dismissed yet. */
interface ImportDone {
  testId: string;
  name: string;
  itemCount: number;
  totalMarks: number;
  warnings: string[];
}

export function ImportFromPpqModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /**
   * Called with the new test's id once it exists, and awaited, so the list
   * has its copy before the modal closes. The modal decides when to close:
   * straight away if the import raised no warnings, otherwise once the
   * teacher has read them. (The parent used to close it here, which
   * unmounted the warnings the moment they were set, so none was ever seen.)
   */
  onImported: (testId: string) => Promise<void> | void;
}) {
  const [savedExams, setSavedExams] = useState<SavedExamSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState("");

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ name: string; existingTestId: string } | null>(null);
  const [done, setDone] = useState<ImportDone | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/saved-exams")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setLoadError(data.error);
        } else {
          setSavedExams(data.savedExams ?? []);
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load saved exams.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = savedExams?.find((e) => e.id === selectedId) ?? null;

  const runImport = async (force: boolean) => {
    if (!selected) return;
    setImporting(true);
    setImportError(null);
    setConflict(null);
    try {
      const res = await fetch("/api/tests/import-from-saved-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedExamId: selected.id,
          name: nameOverride.trim() || undefined,
          force,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsConfirmation) {
          setConflict({ name: nameOverride.trim() || selected.name, existingTestId: data.existingTestId });
          return;
        }
        throw new Error(data.error ?? "Import failed.");
      }
      const notes: string[] = Array.isArray(data.warnings)
        ? data.warnings.filter((w: unknown): w is string => typeof w === "string")
        : [];
      try {
        await onImported(data.id);
      } catch {
        // Only the list's copy of the new test failed; the test itself
        // exists and shows on the next load.
      }
      if (notes.length === 0) {
        onClose();
        return;
      }
      setDone({
        testId: data.id,
        name: nameOverride.trim() || selected.name,
        itemCount: data.itemCount,
        totalMarks: data.totalMarks,
        warnings: notes,
      });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import from PPQ Bank"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-da-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-da-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-da-text">Import from PPQ Bank</h2>
            <p className="mt-0.5 text-xs text-da-muted">
              Create a test from a saved ExamBuilder paper. Questions keep their IB code, so AI
              marking reads each part&apos;s mark scheme from the PPQ bank; any part without one is
              listed when the import finishes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-da-border px-2 py-1 text-xs text-da-muted hover:bg-da-hover"
          >
            ✕ Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {done ? (
            <div className="space-y-3">
              <p className="text-sm text-da-text">
                Imported &quot;{done.name}&quot; ({done.itemCount} part{done.itemCount === 1 ? "" : "s"},{" "}
                {done.totalMarks} marks). Read {done.warnings.length === 1 ? "this" : "these"} before marking it:
              </p>
              <ul className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
                {done.warnings.map((w, i) => (
                  <li key={i} className="whitespace-pre-line">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <a
                  href={`/dashboard/tests/${done.testId}/ai-grade`}
                  className="rounded border border-purple-400/40 bg-purple-500/15 px-3 py-1 text-xs text-purple-300 hover:bg-purple-500/25"
                >
                  Mark Scans →
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              {loadError && (
                <p className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-300">
                  {loadError}
                </p>
              )}

              {!loadError && savedExams === null && (
                <p className="text-sm text-da-muted">Loading saved exams…</p>
              )}

              {savedExams?.length === 0 && (
                <p className="text-sm text-da-muted">
                  No saved exams yet. Build one in the Question Bank&apos;s ExamBuilder first.
                </p>
              )}

              {savedExams && savedExams.length > 0 && (
                <ul className="space-y-2">
                  {savedExams.map((e) => {
                    const isSelected = selectedId === e.id;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(e.id);
                            setNameOverride(e.name);
                            setConflict(null);
                            setImportError(null);
                          }}
                          className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                            isSelected
                              ? "border-blue-400 bg-blue-500/15"
                              : "border-da-border bg-da-surface hover:bg-da-hover"
                          }`}
                        >
                          <p className="font-semibold text-da-text">{e.name}</p>
                          <p className="mt-0.5 text-xs text-da-muted">
                            {e.curriculum} {e.level} Paper {e.paper}
                            {e.course_name && ` · ${e.course_name}`}
                            {e.exam_date && ` · ${e.exam_date}`}
                            {` · ${e.question_count} question${e.question_count === 1 ? "" : "s"} · ${e.total_marks} marks`}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {selected && (
                <div className="mt-4 space-y-3 rounded-lg border border-blue-400/40 bg-blue-500/15 p-4">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-da-muted">Test name</span>
                    <input
                      value={nameOverride}
                      onChange={(e) => setNameOverride(e.target.value)}
                      className="rounded border border-da-border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
                    />
                  </label>

                  {conflict && (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-300">
                      <p>
                        A test named &quot;{conflict.name}&quot; already exists for this class.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => runImport(true)}
                          disabled={importing}
                          className="rounded border border-amber-400 bg-da-surface px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                        >
                          Import anyway (creates a second test)
                        </button>
                        <a
                          href={`/dashboard/tests/${conflict.existingTestId}/ai-grade`}
                          className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
                        >
                          Go to existing test →
                        </a>
                      </div>
                    </div>
                  )}

                  {importError && <p className="text-sm text-red-300">{importError}</p>}

                  {!conflict && (
                    <button
                      type="button"
                      onClick={() => runImport(false)}
                      disabled={importing || !nameOverride.trim()}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {importing ? "Importing…" : `Import "${selected.name}"`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
