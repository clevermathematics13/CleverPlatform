"use client";
import { useState } from "react";

export function DeployCard() {
  const [status, setStatus] = useState<"idle" | "deploying" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function deploy(target: "preview" | "production") {
    setStatus("deploying");
    setMessage("");
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("done");
        setMessage(`${target === "production" ? "Production" : "Preview"} deploy triggered ✓`);
      } else {
        throw new Error(data.error ?? "Unknown error");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Deploy failed");
    }
    setTimeout(() => setStatus("idle"), 4000);
  }

  return (
    <div className="rounded-xl border border-da-border bg-da-surface p-6 shadow-sm shadow-black/30 col-span-full">
      <p className="text-sm font-medium text-da-muted mb-3">Deploy</p>
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => deploy("preview")}
          disabled={status === "deploying"}
          className="rounded-lg border border-da-border bg-da-bg px-4 py-2 text-sm font-semibold text-da-text hover:border-da-accent/50 disabled:opacity-50 transition-all"
        >
          {status === "deploying" ? "Deploying…" : "↗ Preview"}
        </button>
        <button
          onClick={() => deploy("production")}
          disabled={status === "deploying"}
          className="rounded-lg bg-da-accent px-4 py-2 text-sm font-bold text-da-bg hover:bg-da-amber disabled:opacity-50 transition-all"
        >
          {status === "deploying" ? "Deploying…" : "🚀 Production"}
        </button>
      </div>
      {message && (
        <p className={`mt-3 text-sm ${status === "error" ? "text-red-400" : "text-green-400"}`}>{message}</p>
      )}
    </div>
  );
}
