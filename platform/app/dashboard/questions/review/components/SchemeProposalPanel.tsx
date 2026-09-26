"use client";

import { useEffect, useState } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import {
  acceptSchemeProposal,
  dismissSchemeProposal,
  getSchemeProposal,
  type ProposedPart,
  type QuestionPart,
  type SchemeBuildSummary,
  type SchemeProposal,
} from "./review-types";

/**
 * A mark-scheme build its checks would not apply on their own
 * (scripts/build-mark-schemes.ts), for the teacher to correct against the
 * scheme images beside it, then accept or dismiss. Accepting plans the
 * corrected parts again on the server (decideAcceptance in
 * lib/markscheme-build.ts): the teacher can accept past what they have read
 * here, but never a change to a question a test already uses, or over a
 * scheme that is already there.
 */
export function SchemeProposalPanel({
  build,
  onResolved,
}: {
  build: SchemeBuildSummary;
  /** The question's parts after an Accept, or null after a Dismiss. */
  onResolved: (parts: QuestionPart[] | null) => void;
}) {
  const [proposal, setProposal] = useState<SchemeProposal | null>(null);
  const [drafts, setDrafts] = useState<ProposedPart[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [refusal, setRefusal] = useState<{ error: string; problems: string[] } | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSchemeProposal(build.id)
      .then((p) => {
        if (cancelled) return;
        setProposal(p);
        setDrafts(p.parts);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [build.id]);

  const update = (i: number, patch: Partial<ProposedPart>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  async function accept() {
    setBusy("accept");
    setRefusal(null);
    const result = await acceptSchemeProposal(build.id, drafts);
    setBusy(null);
    if (result.ok) onResolved(result.parts);
    else setRefusal({ error: result.error, problems: result.problems });
  }

  async function dismiss() {
    if (!window.confirm("Dismiss this proposed scheme? Nothing is saved, and the build will not try this question again.")) {
      return;
    }
    setBusy("dismiss");
    setRefusal(null);
    const result = await dismissSchemeProposal(build.id);
    setBusy(null);
    if (result.ok) onResolved(null);
    else setRefusal({ error: result.error, problems: result.problems });
  }

  const reasons = [...(proposal?.build.issues ?? build.issues), ...(proposal?.build.flags ?? build.flags)];
  const blocking = new Set(proposal?.build.blocking ?? []);
  const warnings = proposal?.build.warnings ?? [];

  return (
    <section className="border border-amber-400/40 bg-amber-500/10 rounded-lg p-3 space-y-3" aria-label="Proposed mark scheme">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-amber-200">Proposed mark scheme</h3>
        <span className="text-[11px] text-da-muted">
          transcribed from the scheme images on {new Date(build.createdAt).toLocaleDateString()}; check each part against them
        </span>
      </div>

      {reasons.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-200">Held back because:</p>
          <ul className="list-disc pl-5 text-xs text-da-text space-y-0.5">
            {reasons.map((reason, i) => (
              <li key={i}>
                {reason}
                {blocking.has(reason) && <span className="text-red-300"> (cannot be accepted here)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowWarnings((v) => !v)} className="text-[11px] text-da-muted hover:text-da-text">
            {showWarnings ? "Hide" : "Show"} {warnings.length} note{warnings.length === 1 ? "" : "s"}
          </button>
          {showWarnings && (
            <ul className="list-disc pl-5 text-[11px] text-da-muted space-y-0.5 mt-1">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loadError && <p className="text-xs text-red-300">{loadError}</p>}
      {!proposal && !loadError && <p className="text-xs text-da-muted">Loading the proposal...</p>}

      {drafts.map((d, i) => (
        <div key={i} className="border border-da-border rounded bg-da-surface p-2 space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1 text-da-muted">
              Part
              <input
                value={d.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="(a)"
                aria-label={`Label of proposed part ${i + 1}`}
                className="w-20 border border-da-border rounded px-1.5 py-0.5 bg-da-surface text-da-text"
              />
            </label>
            <label className="flex items-center gap-1 text-da-muted">
              Marks
              <input
                type="number"
                min={0}
                value={d.marks ?? ""}
                onChange={(e) => update(i, { marks: e.target.value === "" ? null : Number(e.target.value) })}
                aria-label={`Marks of proposed part ${i + 1}`}
                className="w-16 border border-da-border rounded px-1.5 py-0.5 bg-da-surface text-da-text [appearance:textfield]"
              />
            </label>
            <button
              type="button"
              onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
              className="ml-auto text-[11px] text-da-muted hover:text-red-300"
              title="Leave this part out"
            >
              Remove part
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <textarea
              value={d.latex}
              onChange={(e) => update(i, { latex: e.target.value })}
              rows={Math.min(18, Math.max(4, d.latex.split("\n").length + 1))}
              spellCheck={false}
              aria-label={`Mark scheme LaTeX of proposed part ${i + 1}`}
              className="font-mono text-xs border border-da-border rounded p-2 bg-da-surface text-da-text w-full"
            />
            <div className="text-sm border border-da-border rounded p-2 overflow-auto">
              <LatexRenderer latex={d.latex} />
            </div>
          </div>
        </div>
      ))}

      {proposal && (
        <button
          type="button"
          onClick={() => setDrafts((prev) => [...prev, { label: "", marks: null, latex: "" }])}
          className="text-[11px] text-da-muted hover:text-da-text"
        >
          + Add a part
        </button>
      )}

      {refusal && (
        <div className="text-xs text-red-300 space-y-1">
          <p className="font-medium">{refusal.error}</p>
          {refusal.problems.length > 0 && (
            <ul className="list-disc pl-5 space-y-0.5">
              {refusal.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={!proposal || busy !== null || drafts.length === 0}
          className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40"
        >
          {busy === "accept" ? "Saving..." : "Accept and save to the bank"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy !== null}
          className="px-3 py-1.5 rounded text-xs font-medium border border-da-border text-da-text hover:bg-da-hover disabled:opacity-40"
        >
          {busy === "dismiss" ? "Dismissing..." : "Dismiss"}
        </button>
      </div>
    </section>
  );
}
