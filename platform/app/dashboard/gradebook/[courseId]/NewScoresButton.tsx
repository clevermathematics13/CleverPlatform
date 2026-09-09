"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Download new scores" -- every class whose achievement levels have moved
 * since the last download, zipped.
 *
 * Sits on every gradebook page but is never about the class on screen. The
 * teacher marks several sections and then imports the lot in one sitting, so
 * a batch scoped to whichever page they happened to open would be a trap.
 *
 * Dark and unclickable when there is nothing new, which is the point of it:
 * the button itself answers "is there anything to import?" without the teacher
 * having to open each class and compare.
 */

type Pending = {
  count: number;
  classes: { course: string; assessment: string; filename: string }[];
};

export function NewScoresButton() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/gradebook/new-scores");
      if (!res.ok) return;
      setPending((await res.json()) as Pending);
    } catch {
      // A status we could not fetch leaves the button in its last known
      // state, which is better than flickering it to "nothing new".
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const download = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/gradebook/new-scores", { method: "POST" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(d.error ?? res.statusText);
        return;
      }

      const count = Number(res.headers.get("X-File-Count") ?? "0");
      const classes = decodeURIComponent(res.headers.get("X-Classes") ?? "");
      const driveError = decodeURIComponent(res.headers.get("X-Drive-Error") ?? "");
      const driveFilename = res.headers.get("X-Drive-Filename") ?? "";
      const unreadable = Number(res.headers.get("X-Unreadable") ?? "0");

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "new-scores.zip";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const parts = [
        `Downloaded ${count} file${count === 1 ? "" : "s"}${classes ? `: ${classes}` : ""}.`,
      ];
      if (driveFilename) parts.push(`Saved to Drive as ${driveFilename}.`);
      if (driveError) parts.push(`Drive copy failed: ${driveError}`);
      if (unreadable > 0) {
        parts.push(
          `${unreadable} file${unreadable === 1 ? "" : "s"} could not be read and stayed pending.`
        );
      }
      setNote(parts.join(" "));
      await refresh();
    } catch {
      setNote("Could not download: network error.");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const count = pending?.count ?? 0;
  const enabled = count > 0 && !busy;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!enabled}
        onClick={download}
        title={
          count === 0
            ? "Nothing new since your last download. This lights up when a class's achievement levels change."
            : pending?.classes
                .map((c) => `${c.course} — ${c.assessment} (${c.filename})`)
                .join("\n")
        }
        className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
          enabled
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "cursor-not-allowed bg-da-bg text-da-muted"
        }`}
      >
        {busy ? "Preparing…" : count > 0 ? `Download new scores (${count})` : "Download new scores"}
      </button>
      {note && (
        <span role="status" className="text-xs text-da-muted">
          {note}
        </span>
      )}
    </div>
  );
}
