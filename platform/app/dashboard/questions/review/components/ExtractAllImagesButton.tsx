"use client";

import { useState } from "react";

export function ExtractAllImagesButton() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ completed: number; total: number; currentCode: string; totalImages: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Array<{ code: string; message: string }>>([]);
  const [showErrorDetails, setShowErrorDetails] = useState(true);

  async function run() {
    setStatus("running");
    setError(null);
    setErrorDetails([]);
    setShowErrorDetails(true);
    setProgress({ completed: 0, total: 0, currentCode: "Starting…", totalImages: 0, errors: 0 });

    try {
      const res = await fetch("/api/questions/extract-all-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipExisting: true }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `HTTP ${res.status}`);
        setStatus("error");
        return;
      }

      if (!res.body) {
        setError("No response stream");
        setStatus("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "start") {
              setProgress((p) => ({ ...p!, total: msg.total }));
            } else if (msg.type === "progress") {
              setProgress((prev) => ({
                completed: msg.completed,
                total: msg.total,
                currentCode: msg.code,
                totalImages: (prev?.totalImages ?? 0) + (msg.questionImages ?? 0) + (msg.msImages ?? 0),
                errors: msg.error ? (prev?.errors ?? 0) + 1 : (prev?.errors ?? 0),
              }));
              if (msg.error) {
                setErrorDetails((prev) => {
                  const next = [...prev, { code: msg.code ?? "unknown", message: String(msg.error) }];
                  return next;
                });
              }
            } else if (msg.type === "done") {
              setProgress({ completed: msg.totalQuestions, total: msg.totalQuestions, currentCode: "Done", totalImages: msg.totalImages, errors: msg.errors ?? 0 });
              if (Array.isArray(msg.errorDetails)) {
                setErrorDetails(
                  msg.errorDetails.map((item: { code?: unknown; error?: unknown }) => ({
                    code: typeof item.code === "string" ? item.code : "unknown",
                    message: typeof item.error === "string" ? item.error : String(item.error ?? "Unknown error"),
                  }))
                );
              }
              setStatus("done");
            } else if (msg.type === "error") {
              setError(msg.error);
              setStatus("error");
            }
          } catch { /* ignore bad lines */ }
        }
      }
      if (status === "running") setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
      setStatus("error");
    }
  }

  const busy = status === "running";
  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="border border-green-200 rounded-lg bg-green-50/40 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-green-800 text-xs">Extract images from Google Docs</span>
        <span className="text-xs text-gray-400">(skips questions that already have images)</span>
        <div className="ml-auto">
          <button
            onClick={run}
            disabled={busy}
            className="px-3 py-1 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-40"
          >
            {busy ? "Extracting…" : "Extract all"}
          </button>
        </div>
      </div>

      {(error || (progress?.errors ?? 0) > 0) && (
        <div className="rounded border border-red-300 bg-red-50 px-2.5 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-xs text-red-700 font-semibold">
              ⚠ Errors detected{progress && progress.errors > 0 ? `: ${progress.errors}` : ""}
            </p>
            {errorDetails.length > 0 && (
              <button
                type="button"
                onClick={() => setShowErrorDetails((v) => !v)}
                className="text-[11px] text-red-700 underline underline-offset-2 hover:text-red-800"
              >
                {showErrorDetails ? "Hide details" : `Show details (${errorDetails.length})`}
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {showErrorDetails && errorDetails.length > 0 && (
            <div className="max-h-48 overflow-auto rounded border border-red-200 bg-white/70 p-2">
              <ul className="text-xs text-red-700 space-y-1 font-mono">
                {errorDetails.map((item, idx) => (
                  <li key={`${item.code}-${idx}`} className="wrap-break-word">
                    <span className="font-semibold">{item.code}</span>: {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="space-y-1">
          <div className={`flex justify-between text-xs ${(progress.errors ?? 0) > 0 ? "text-red-700" : "text-green-700"}`}>
            <span>{progress.currentCode}</span>
            <span>{progress.completed} / {progress.total} questions · {progress.totalImages} images{progress.errors > 0 ? ` · ${progress.errors} errors` : ""}</span>
          </div>
          <div className="w-full bg-green-100 rounded-full h-1.5">
            <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
