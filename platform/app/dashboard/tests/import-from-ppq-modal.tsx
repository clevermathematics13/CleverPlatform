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

export function ImportFromPpqModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (testId: string) => void;
}) {
  const [savedExams, setSavedExams] = useState<SavedExamSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState("");

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ name: string; existingTestId: string } | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

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
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setWarnings(data.warnings);
      }
      onImported(data.id);
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
              Create a test from a saved ExamBuilder paper. Questions keep their IB code, so the
              new test can be AI-graded straight away.
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
                      className="rounded border border-amber-400 bg-da-surface px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/15 disabled:opacity-50"
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

          {warnings && warnings.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2">
              <p className="text-xs font-semibold uppercase text-amber-300">
                Imported with {warnings.length} note{warnings.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-300">
                {warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
