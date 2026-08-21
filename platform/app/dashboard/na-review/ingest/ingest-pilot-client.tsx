"use client";

import { useState, useCallback, useRef } from "react";

type IndexEntry = {
  packetNum: number;
  qid: string;
  filename: string;
  isBlank: boolean;
  boundaryExpanded: boolean;
  assessment: Record<string, unknown> | null;
};

const STORAGE_KEY = "na-pilot-ingest-done";
const BATCH_KEY = "na-pilot-batch-id";

function getDone(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function markDone(key: string) {
  const done = getDone();
  done.add(key);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function IngestPilotClient({ packetVersionId }: { packetVersionId: string }) {
  const [indexData, setIndexData] = useState<IndexEntry[] | null>(null);
  const [fileMap, setFileMap] = useState<Map<string, File>>(new Map());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, failed: 0, skipped: 0 });
  const [logLines, setLogLines] = useState<{ text: string; cls?: string }[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const log = useCallback((text: string, cls?: string) => {
    setLogLines((prev) => [...prev, { text, cls }]);
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  }, []);

  const handleIndexFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text) as IndexEntry[];
      setIndexData(data);
      log(`Loaded index: ${data.length} crop entries`);
    },
    [log]
  );

  const handleFolder = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const map = new Map<string, File>();
      for (const f of Array.from(e.target.files ?? [])) {
        if (f.name.endsWith(".png")) map.set(f.name, f);
      }
      setFileMap(map);
      log(`Loaded ${map.size} PNG files from folder`);
    },
    [log]
  );

  const run = useCallback(async () => {
    if (!indexData) return;
    setRunning(true);
    setLogLines([]);

    const done = getDone();
    let batchId = sessionStorage.getItem(BATCH_KEY);

    if (!batchId) {
      log("Creating batch...");
      try {
        const res = await fetch("/api/na-review/ingest-pilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ createBatch: true, packetVersionId }),
        });
        const data = await res.json();
        if (!res.ok || !data.batchId) {
          log(`Failed to create batch: ${JSON.stringify(data)}`, "err");
          setRunning(false);
          return;
        }
        batchId = data.batchId;
        sessionStorage.setItem(BATCH_KEY, batchId as string);
        log(`Batch created: ${batchId}`, "ok");
      } catch (e) {
        log(`Batch creation error: ${(e as Error).message}`, "err");
        setRunning(false);
        return;
      }
    } else {
      log(`Reusing existing batch: ${batchId}`);
    }

    const total = indexData.length;
    let ok = 0,
      failed = 0,
      skipped = 0;

    for (let i = 0; i < indexData.length; i++) {
      const entry = indexData[i];
      const key = `${entry.packetNum}:${entry.filename}`;
      setProgress({ done: i + 1, total, ok, failed, skipped });

      if (done.has(key)) {
        skipped++;
        continue;
      }

      const file = fileMap.get(entry.filename);
      if (!file) {
        log(`MISSING FILE: ${entry.filename} -- skipping`, "warn");
        failed++;
        continue;
      }

      try {
        const base64 = await fileToBase64(file);
        const res = await fetch("/api/na-review/ingest-pilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId,
            packetVersionId,
            packetNum: entry.packetNum,
            qid: entry.qid,
            filename: entry.filename,
            base64,
            inkDensity: null,
            isBlank: entry.isBlank,
            boundaryExpanded: entry.boundaryExpanded,
            assessment: entry.assessment,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          log(`FAILED ${entry.qid} packet ${entry.packetNum}: ${JSON.stringify(data)}`, "err");
          failed++;
        } else if (data.skipped) {
          log(`SKIPPED ${entry.qid} (no matching anchor)`, "warn");
          skipped++;
        } else {
          markDone(key);
          ok++;
        }
      } catch (e) {
        log(`ERROR ${entry.qid} packet ${entry.packetNum}: ${(e as Error).message}`, "err");
        failed++;
      }
      setProgress({ done: i + 1, total, ok, failed, skipped });
    }

    log(
      `\nDone. ${ok} succeeded, ${failed} failed, ${skipped} skipped (already done or no anchor).`,
      failed > 0 ? "warn" : "ok"
    );
    if (failed > 0) {
      log('Click "Create batch & ingest" again to retry only the failed/missing ones.', "warn");
    }
    setRunning(false);
  }, [indexData, fileMap, packetVersionId, log]);

  const canRun = indexData !== null && fileMap.size > 0 && !running;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-da-text font-serif">Pilot Data Ingestion</h1>
        <p className="text-da-muted text-sm mt-1">
          One-time tool to load the A.1 pilot crops and AI assessments into this packet version.
          Packet version: <code className="text-xs">{packetVersionId}</code>
        </p>
      </div>

      <div className="rounded-xl border border-da-border bg-da-surface p-4 space-y-3">
        <div>
          <label className="text-sm font-medium text-da-text block mb-1">
            Index JSON (metadata + AI assessments, no images)
          </label>
          <input type="file" accept=".json" onChange={handleIndexFile} className="text-sm" />
        </div>
        <div>
          <label className="text-sm font-medium text-da-text block mb-1">
            Crop images folder (select the whole pilot_crops folder)
          </label>
          <input
            type="file"
            // @ts-expect-error -- webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            directory=""
            multiple
            onChange={handleFolder}
            className="text-sm"
          />
        </div>
      </div>

      <button
        onClick={run}
        disabled={!canRun}
        className="px-4 py-2 rounded-lg bg-da-accent text-white font-medium disabled:opacity-40"
      >
        {running ? "Ingesting…" : "Create batch & ingest"}
      </button>

      {progress.total > 0 && (
        <div>
          <div className="h-2 rounded-full bg-da-hover overflow-hidden">
            <div className="h-full bg-da-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-da-muted mt-1">
            {progress.done} / {progress.total} ({progress.ok} ok, {progress.failed} failed,{" "}
            {progress.skipped} skipped)
          </p>
        </div>
      )}

      {logLines.length > 0 && (
        <div
          ref={logRef}
          className="rounded-lg bg-da-hover/30 border border-da-border p-3 font-mono text-xs max-h-96 overflow-y-auto whitespace-pre-wrap"
        >
          {logLines.map((line, i) => (
            <div
              key={i}
              className={
                line.cls === "err"
                  ? "text-red-500"
                  : line.cls === "warn"
                  ? "text-amber-500"
                  : line.cls === "ok"
                  ? "text-green-500"
                  : "text-da-muted"
              }
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
