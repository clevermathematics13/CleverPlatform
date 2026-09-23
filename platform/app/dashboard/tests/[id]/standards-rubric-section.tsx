"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  PERFORMANCE_LEVELS,
  checkRubricAgainstItems,
  levelRanges,
  parseStandardsRubric,
  partRefLabel,
  normalisePartRef,
  partRefForItem,
  type RubricFinding,
  type RubricItem,
  type StandardsRubric,
} from "@/lib/standards-rubric";

/**
 * The strand rubric that makes a test a Grade 9 Standard Level assessment.
 *
 * Shown on the test detail page: the strands as a table (which parts, how
 * many marks, where the level bands fall for a strand of that size), and the
 * rubric itself as editable JSON with a save of its own. Its own save rather
 * than a field on the page's form, because it is validated against the
 * test's parts before it is written (PUT /api/tests/[id]/standards-rubric),
 * and a rubric naming a part the test does not have is refused rather than
 * stored.
 *
 * JSON rather than a form, deliberately: a rubric is edited once, when a
 * paper is set up (usually by the importer, not by hand), and the shape is
 * small enough to read. A form for strands-of-parts-of-descriptors would be
 * a page of its own for a thing done twice a year.
 */
export function StandardsRubricSection({
  testId,
  initialRubric,
  items,
}: {
  testId: string;
  initialRubric: unknown;
  items: RubricItem[];
}) {
  const initialParsed = parseStandardsRubric(initialRubric);
  const [saved, setSaved] = useState<StandardsRubric | null>(initialParsed.ok ? initialParsed.rubric : null);
  const [text, setText] = useState<string>(() =>
    initialRubric == null ? "" : JSON.stringify(initialRubric, null, 2)
  );
  const [editing, setEditing] = useState(!initialParsed.ok);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(
    initialParsed.ok ? null : { tone: "error", text: `The stored rubric is not valid: ${initialParsed.error}` }
  );
  const [findings, setFindings] = useState<RubricFinding[]>(() =>
    initialParsed.ok && initialParsed.rubric ? checkRubricAgainstItems(initialParsed.rubric, items) : []
  );

  const strandRows = useMemo(() => {
    if (!saved) return [];
    const byRef = new Map(items.map((i) => [partRefForItem(i), i]));
    return saved.strands.map((s) => {
      const parts = s.parts.map((p) => byRef.get(normalisePartRef(p)) ?? null);
      const max = parts.reduce((sum, it) => sum + (it?.max_marks ?? 0), 0);
      return { code: s.code, name: s.name, refs: s.parts, max, ranges: levelRanges(max, saved.bands), standards: s.standards };
    });
  }, [saved, items]);

  const save = async (rubric: StandardsRubric | null) => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/tests/${testId}/standards-rubric`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rubric }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFindings(Array.isArray(data.findings) ? data.findings : []);
        setStatus({ tone: "error", text: data.error ?? `Could not save (${res.status})` });
        return;
      }
      setSaved(data.rubric ?? null);
      setFindings(Array.isArray(data.findings) ? data.findings : []);
      setText(data.rubric ? JSON.stringify(data.rubric, null, 2) : "");
      setEditing(false);
      setStatus({ tone: "ok", text: rubric ? "Rubric saved." : "Rubric removed. This test is graded by marks again." });
    } catch {
      setStatus({ tone: "error", text: "Could not save: network error." });
    } finally {
      setSaving(false);
    }
  };

  const saveFromText = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setStatus({ tone: "error", text: "That is not valid JSON." });
      return;
    }
    const parsed = parseStandardsRubric(raw);
    if (!parsed.ok) {
      setStatus({ tone: "error", text: `That is not a valid rubric: ${parsed.error}` });
      return;
    }
    void save(parsed.rubric);
  };

  const hint = "text-xs text-da-muted";

  return (
    <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-bold text-da-text">
          Standards rubric
          {saved && (
            <span className="ml-2 rounded border border-teal-400/40 bg-teal-500/15 px-1.5 py-0.5 align-middle text-[11px] font-medium text-teal-300">
              Standard Level
            </span>
          )}
        </h2>
        <span className="flex flex-wrap gap-3">
          {saved && (
            <a href={`/dashboard/tests/${testId}/standards-report`} className="text-xs text-blue-300 hover:underline">
              Standards report →
            </a>
          )}
          <a href={`/dashboard/tests/${testId}/standards-stats`} className="text-xs text-blue-300 hover:underline">
            Teacher stats →
          </a>
        </span>
      </div>

      {saved ? (
        <>
          <p className={hint}>
            Graded by strand into {PERFORMANCE_LEVELS.map((l) => l.label).join(" / ")}, at{" "}
            {Math.round(saved.bands.exceeding * 100)}% / {Math.round(saved.bands.meeting * 100)}% /{" "}
            {Math.round(saved.bands.approaching * 100)}% of each strand&apos;s marks. The marker loads the
            Grade 9 Standard Level policy for this paper instead of the Formative Assessment one.
            {saved.source ? ` Source: ${saved.source}.` : ""}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-da-border text-left text-xs text-da-muted">
                  <th className="pb-2 font-semibold">Strand</th>
                  <th className="pb-2 font-semibold">Parts</th>
                  <th className="pb-2 font-semibold">Marks</th>
                  <th className="pb-2 font-semibold">E / M / AP / B</th>
                </tr>
              </thead>
              <tbody>
                {strandRows.map((s) => (
                  <tr key={s.code} className="border-b border-da-border/50 align-top last:border-0">
                    <td className="py-1.5 pr-3 text-da-text">
                      <span className="font-semibold">{s.code}</span> {s.name}
                      {s.standards.length > 0 && (
                        <span className={`block ${hint}`}>{s.standards.map((x) => x.split(" ")[0]).join(", ")}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-da-muted">{s.refs.map(partRefLabel).join(", ")}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-da-text">{s.max}</td>
                    <td className="py-1.5 text-xs text-da-muted">
                      {s.ranges.exceeding} / {s.ranges.meeting} / {s.ranges.approaching} / {s.ranges.beginning}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className={hint}>
          Not a Standard Level paper: graded by marks and reported against its boundary set. Paste a rubric
          below to grade it by strands into performance levels instead. New Standard Level papers are
          usually set up from their PDFs on the{" "}
          <Link href="/dashboard/tests/standards-import" className="text-blue-300 hover:underline">
            importer
          </Link>
          , which writes this for you.
        </p>
      )}

      {findings.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {findings.map((f, i) => (
            <li key={i} className={f.severity === "block" ? "text-red-300" : "text-amber-300"}>
              {f.severity === "block" ? "✕" : "⚠"} {f.message}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={16}
            className="w-full rounded-lg border border-da-border bg-da-bg px-3 py-2 font-mono text-xs text-da-text focus:border-da-accent focus:outline-none"
            placeholder='{ "version": 1, "bands": { "exceeding": 0.85, "meeting": 0.65, "approaching": 0.4 }, "strands": [ { "code": "A", "name": "...", "standards": [], "parts": ["1a", "1b"] } ] }'
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveFromText}
              disabled={saving || text.trim() === ""}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save rubric"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(saved ? JSON.stringify(saved, null, 2) : "");
                setStatus(null);
              }}
              disabled={saving}
              className="rounded-lg border border-da-border px-4 py-2 text-sm text-da-muted hover:bg-da-hover"
            >
              Cancel
            </button>
            {saved && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Remove the standards rubric? The test goes back to being graded by marks. Nothing already marked is changed.")) {
                    void save(null);
                  }
                }}
                disabled={saving}
                className="ml-auto rounded-lg border border-red-400/40 px-3 py-2 text-xs text-red-300 hover:bg-red-500/25"
              >
                Remove rubric
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-da-border px-3 py-1.5 text-xs text-da-muted hover:bg-da-hover"
        >
          {saved ? "Edit rubric JSON" : "Add a rubric"}
        </button>
      )}

      {status && (
        <p role="status" className={`text-xs ${status.tone === "ok" ? "text-green-300" : "text-red-300"}`}>
          {status.text}
        </p>
      )}
    </section>
  );
}
