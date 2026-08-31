"use client";

import { useRef, useState } from "react";

interface Props {
  testId: string;
  testName: string;
  onClose: () => void;
}

type Stage =
  | { step: "pick" }
  | { step: "working" }
  | { step: "error"; message: string }
  | { step: "done"; csvText: string; filename: string; warnings: string[] };

/**
 * Fills PowerTeacher Pro's own blank per-assignment score template with
 * this test's marks from our gradebook, so a teacher can re-import it into
 * PowerSchool without us ever needing to know or store a Student Number.
 * See lib/powerschool-export.ts for why the template round-trip, not a
 * from-scratch CSV, is the safe way to do this.
 */
export function PowerSchoolExportModal({ testId, testName, onClose }: Props) {
  const [stage, setStage] = useState<Stage>({ step: "pick" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setStage({ step: "working" });

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/gradebook/tests/${testId}/export-powerschool`, {
        method: "POST",
        body: formData,
      });
      const body = (await res.json()) as
        | { csvText: string; filename: string; warnings: string[] }
        | { error: string };
      if (!res.ok || "error" in body) {
        setStage({ step: "error", message: "error" in body ? body.error : "Something went wrong." });
        return;
      }
      setStage({ step: "done", csvText: body.csvText, filename: body.filename, warnings: body.warnings });
    } catch {
      setStage({ step: "error", message: "Network error — please try again." });
    }
  };

  const handleDownload = () => {
    if (stage.step !== "done") return;
    const blob = new Blob([stage.csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = stage.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-da-border bg-da-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-da-text font-serif">
          Export &ldquo;{testName}&rdquo; to PowerSchool
        </h2>

        {stage.step === "pick" && (
          <>
            <ol className="mt-3 space-y-2 text-sm text-da-muted list-decimal list-inside">
              <li>
                In PowerTeacher Pro: <strong>Grading → Assignment List</strong> → select this assignment →
                gear icon → <strong>Export Template</strong>.
              </li>
              <li>Upload that blank template CSV below — we&apos;ll fill in the Score column.</li>
              <li>Download the completed file and re-import it in the same PowerTeacher Pro screen.</li>
            </ol>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="mt-4 block w-full text-sm text-da-text file:mr-3 file:rounded file:border-0 file:bg-da-accent/15 file:px-3 file:py-1.5 file:text-da-accent file:font-medium"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded px-3 py-1.5 text-sm text-da-muted hover:text-da-text"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                className="rounded bg-da-accent px-3 py-1.5 text-sm font-medium text-da-bg hover:bg-da-accent/90"
              >
                Fill scores
              </button>
            </div>
          </>
        )}

        {stage.step === "working" && (
          <p className="mt-4 text-sm text-da-muted">Matching students and filling in scores…</p>
        )}

        {stage.step === "error" && (
          <>
            <p className="mt-4 text-sm text-red-400">{stage.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setStage({ step: "pick" })}
                className="rounded px-3 py-1.5 text-sm text-da-muted hover:text-da-text"
              >
                Back
              </button>
              <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-da-muted hover:text-da-text">
                Close
              </button>
            </div>
          </>
        )}

        {stage.step === "done" && (
          <>
            {stage.warnings.length > 0 && (
              <div className="mt-4 rounded border border-yellow-800/40 bg-yellow-950/20 p-3">
                <p className="text-xs font-semibold text-yellow-400 mb-1">
                  {stage.warnings.length} row{stage.warnings.length !== 1 ? "s" : ""} left blank — check these
                  before importing:
                </p>
                <ul className="space-y-1 text-xs text-yellow-200/90 list-disc list-inside">
                  {stage.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {stage.warnings.length === 0 && (
              <p className="mt-4 text-sm text-emerald-400">Every row was matched and filled in.</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-da-muted hover:text-da-text">
                Close
              </button>
              <button
                onClick={handleDownload}
                className="rounded bg-da-accent px-3 py-1.5 text-sm font-medium text-da-bg hover:bg-da-accent/90"
              >
                Download completed CSV
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
