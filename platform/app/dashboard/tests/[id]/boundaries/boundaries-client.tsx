"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CUTOFF_GRADES, validateCutoffs, type CutoffGrade, type Cutoffs } from "@/lib/grade-bands";
import {
  clusterSplits,
  emptyScoresNear,
  levelCounts,
  levelForScore,
  levelMoves,
  scoreHistogram,
  scoreSummary,
  watchList,
  type CountView,
  type HistogramBin,
  type Level,
} from "@/lib/boundary-scores";
import type { BoundaryPageData, DecisionRow, GuidanceRow, SuggestionRow } from "@/lib/boundary-data";
import { fetchJson } from "../ai-grade/fetch-json";

/**
 * The interactive half of the grade-boundaries page: the lines in force and
 * the decision behind them, the score chart, a draft the teacher edits (from
 * the lines in force, a preset or the AI's suggestion), the decision itself,
 * and the teacher's guidance to the AI.
 *
 * Every count here is recomputed in the browser from the scores the server
 * loaded (lib/boundary-scores.ts), so the draft's level counts move as the
 * teacher types. Nothing changes a level except "Use these boundaries" or
 * "Keep the boundaries in use", which both go through
 * POST /api/tests/[id]/boundaries/decide.
 */

type StartedFrom = { kind: "current" } | { kind: "suggestion"; id: string } | { kind: "preset"; id: string } | { kind: "manual" };
type DraftText = Record<CutoffGrade, string>;

const LEVELS: Level[] = [7, 6, 5, 4, 3, 2, 1];

/** Chart series colours, checked with the dataviz validator against --color-da-surface (#181215). */
const ACCEPTED_FILL = "#3987e5";
const PROVISIONAL_FILL = "#d95926";

const SOURCE_WORDS: Record<DecisionRow["source"], string> = {
  preset: "started from a preset",
  ai_suggestion: "adopted the AI suggestion",
  teacher: "set by the teacher",
  kept: "kept the lines in force",
};

function toText(c: Cutoffs | null): DraftText {
  return Object.fromEntries(CUTOFF_GRADES.map((g) => [g, c ? String(c[g]) : ""])) as DraftText;
}

function fromText(t: DraftText): Partial<Record<CutoffGrade, number>> {
  return Object.fromEntries(
    CUTOFF_GRADES.map((g) => {
      const n = Number(t[g]);
      return [g, t[g].trim() === "" || !Number.isFinite(n) ? undefined : n];
    })
  ) as Partial<Record<CutoffGrade, number>>;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function pct(m: number, total: number): string {
  return `${Math.round((m / total) * 1000) / 10}%`;
}

function lineList(c: Cutoffs): string {
  return CUTOFF_GRADES.map((g) => c[g]).join("/");
}

/** [31, 28, 27] -> "27, 28 or 31". */
function orList(scores: number[]): string {
  const s = [...scores].sort((a, b) => a - b).map(String);
  return s.length <= 1 ? s.join("") : `${s.slice(0, -1).join(", ")} or ${s[s.length - 1]}`;
}

/** "45-50", "40-44", ... "0-19": the marks each level covers. */
function levelRange(level: Level, c: Cutoffs | null, total: number): string {
  if (!c) return "-";
  const lo = level === 1 ? 0 : c[level as CutoffGrade];
  const hi = level === 7 ? total : c[(level + 1) as CutoffGrade] - 1;
  if (lo > hi) return "-";
  return lo === hi ? `${lo}` : `${lo}-${hi}`;
}

const card = "rounded-xl border border-da-border bg-da-surface p-5 shadow-sm";
const h2 = "text-lg font-semibold text-da-text";
const hint = "text-xs text-da-muted";
const btn =
  "rounded border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary = `${btn} border-da-accent bg-da-accent text-da-on-accent hover:bg-da-amber`;
const btnGhost = `${btn} border-da-border bg-da-button-bg text-da-text hover:bg-da-button-hover`;

export function BoundariesClient({ data }: { data: BoundaryPageData }) {
  const router = useRouter();
  const total = data.test.totalMarks as number;
  const current = data.current;
  const latestDecision = data.decisions[0] ?? null;

  const [view, setView] = useState<CountView>("all");
  const [suggestion, setSuggestion] = useState<SuggestionRow | null>(data.latestSuggestion);
  // With no lines in use and no suggestion the draft starts empty: filling it
  // from whichever preset sorts first would show a DP scale's counts and
  // warnings on a Grade 9 paper nobody chose it for.
  const [draftText, setDraftText] = useState<DraftText>(() =>
    toText(current.cutoffs ?? data.latestSuggestion?.cutoffs ?? null)
  );
  const [startedFrom, setStartedFrom] = useState<StartedFrom>(() =>
    current.cutoffs
      ? { kind: "current" }
      : data.latestSuggestion
      ? { kind: "suggestion", id: data.latestSuggestion.id }
      : { kind: "manual" }
  );
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState<null | "suggest" | "adopt" | "keep" | "guidance">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [guidance, setGuidance] = useState<GuidanceRow[]>(data.guidance);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<"test" | "all">("test");
  const [showHistory, setShowHistory] = useState(false);

  const draftNumbers = fromText(draftText);
  const draftProblems = validateCutoffs(draftNumbers, total);
  const draft: Cutoffs | null = draftProblems.length === 0 ? (draftNumbers as Cutoffs) : null;
  const draftBlank = CUTOFF_GRADES.every((g) => draftText[g].trim() === "");

  const summary = useMemo(() => scoreSummary(data.scores), [data.scores]);
  const hist = useMemo(() => scoreHistogram(data.scores, total), [data.scores, total]);
  const inUse = levelCounts(data.scores, total, current.cutoffs, view);
  const drafted = draft ? levelCounts(data.scores, total, draft, view) : null;
  const moves = levelMoves(data.scores, total, current.cutoffs, draft, "all");
  const splits = draft ? clusterSplits(hist, draft) : [];
  const watch = watchList(data.scores, total, draft ?? current.cutoffs);
  const draftChanged =
    !!draft && (!current.cutoffs || CUTOFF_GRADES.some((g) => draft[g] !== current.cutoffs?.[g]));
  // A draft identical to the lines in use is not a draft: the chart and the
  // wording below speak of "draft" lines only once one differs.
  const shownDraft = draftChanged ? draft : null;

  const guidanceText = (id: string) => guidance.find((g) => g.id === id)?.note ?? null;

  function setDraftFrom(c: Cutoffs | null, from: StartedFrom) {
    setDraftText(toText(c));
    setStartedFrom(from);
  }

  async function suggest() {
    setBusy("suggest");
    setMessage(null);
    try {
      const res = await fetchJson(`/api/tests/${data.test.id}/boundaries/suggest`, { method: "POST" });
      if (!res.ok) {
        setMessage({ tone: "error", text: String(res.data.error ?? `Suggestion failed (${res.status})`) });
        return;
      }
      setSuggestion(res.data.suggestion as SuggestionRow);
      setMessage({ tone: "ok", text: "The AI has suggested boundaries. Nothing has changed until you decide." });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  function takeSuggestion() {
    if (!suggestion) return;
    setDraftFrom(suggestion.cutoffs, { kind: "suggestion", id: suggestion.id });
    setStatement(suggestion.output.statementDraft);
  }

  async function decide(mode: "adopt" | "keep") {
    const text = statement.trim();
    if (!text) {
      setMessage({ tone: "error", text: "Write a statement of why before deciding." });
      return;
    }
    const prompt =
      mode === "adopt" && draft
        ? `Use ${lineList(draft)} (levels 7 to 2) for ${data.test.name}?\n\n` +
          `Counting marks not yet accepted, ${moves.up} student${moves.up === 1 ? "" : "s"} move up and ${moves.down} down. ` +
          `The gradebook and the PowerSchool export will use these lines.`
        : `Record that ${data.test.name} keeps ${current.label}${current.cutoffs ? ` (${lineList(current.cutoffs)})` : ""}? No level changes.`;
    if (!window.confirm(prompt)) return;

    setBusy(mode);
    setMessage(null);
    try {
      const res = await fetchJson(`/api/tests/${data.test.id}/boundaries/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          cutoffs: mode === "adopt" ? draft : undefined,
          statement: text,
          startedFrom,
          expectedDecisionId: latestDecision?.id ?? null,
        }),
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: String(res.data.error ?? `Could not record the decision (${res.status})`) });
        return;
      }
      setStatement("");
      setMessage({ tone: "ok", text: "Decision recorded." });
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveGuidance(thenSuggest: boolean) {
    const text = note.trim();
    if (!text) return;
    if (
      scope === "all" &&
      !window.confirm("Save this as a general rule? The AI will read it when it suggests boundaries for EVERY assessment.")
    ) {
      return;
    }
    setBusy("guidance");
    setMessage(null);
    try {
      const res = await fetchJson(`/api/boundary-guidance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: text, scope, testId: data.test.id }),
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: String(res.data.error ?? `Could not save the guidance (${res.status})`) });
        return;
      }
      setGuidance((g) => [...g, res.data.guidance as GuidanceRow]);
      setNote("");
    } finally {
      setBusy(null);
    }
    if (thenSuggest) await suggest();
  }

  async function removeGuidance(g: GuidanceRow) {
    const what = g.scope === "all" ? "this general rule (for every assessment)" : "this note";
    if (!window.confirm(`Remove ${what}? The AI stops reading it from the next suggestion.`)) return;
    setBusy("guidance");
    setMessage(null);
    try {
      const res = await fetchJson(`/api/boundary-guidance/${g.id}`, { method: "DELETE" });
      if (!res.ok) {
        setMessage({ tone: "error", text: String(res.data.error ?? `Could not remove it (${res.status})`) });
        return;
      }
      setGuidance((list) => list.filter((x) => x.id !== g.id));
    } finally {
      setBusy(null);
    }
  }

  const status =
    current.kind === "none"
      ? { tone: "border-da-border bg-da-hover text-da-muted", text: "No boundaries: levels are estimated from generic 10-point bands" }
      : current.kind === "preset"
      ? { tone: "border-amber-400/40 bg-amber-500/10 text-amber-200", text: `Shared "${current.label}" preset: not decided for this assessment yet` }
      : latestDecision
      ? {
          tone: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
          text: `Decided ${formatDate(latestDecision.decidedAt)}${latestDecision.decidedBy ? ` by ${latestDecision.decidedBy}` : ""}`,
        }
      : { tone: "border-amber-400/40 bg-amber-500/10 text-amber-200", text: "Own boundaries, no decision on record" };

  return (
    <div className="space-y-6">
      {/* Fixed to the viewport: the buttons that set a message sit far down
          the page, so a banner at its top would land out of sight. */}
      {message && (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={`fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-start justify-between gap-3 rounded-md border bg-da-surface p-3 text-sm shadow-lg ${
            message.tone === "ok" ? "border-emerald-400/60 text-emerald-100" : "border-red-500/60 text-red-100"
          }`}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="shrink-0 text-xs text-da-muted hover:text-da-text">
            Dismiss
          </button>
        </div>
      )}

      {/* -- 1. In use ---------------------------------------------------- */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={h2}>Boundaries in use</h2>
          <span className={`rounded-full border px-3 py-1 text-xs ${status.tone}`}>{status.text}</span>
        </div>

        {latestDecision && (
          <figure className="mt-4 rounded-lg border border-da-border bg-da-bg/40 p-4">
            <blockquote className="text-sm text-da-text">&ldquo;{latestDecision.statement}&rdquo;</blockquote>
            <figcaption className="mt-2 text-xs text-da-muted">
              {latestDecision.decidedBy ?? "A teacher"}, {formatDate(latestDecision.decidedAt)} ·{" "}
              {SOURCE_WORDS[latestDecision.source]}
              {latestDecision.cutoffs ? ` · ${lineList(latestDecision.cutoffs)}` : ""}
              {latestDecision.totalMarks ? ` of ${latestDecision.totalMarks}` : ""}
            </figcaption>
            {latestDecision.totalMarks && latestDecision.totalMarks !== total && (
              <p className="mt-2 text-xs text-amber-200">
                The total marks changed from {latestDecision.totalMarks} to {total} since this decision. The lines kept
                their percentages, so the marks each level starts at may have moved: check them below.
              </p>
            )}
          </figure>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-da-muted">
          <span>Count:</span>
          {(
            [
              ["all", "everyone scored"],
              ["complete", "every part accepted"],
            ] as [CountView, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded border px-2 py-1 ${
                view === v ? "border-da-accent bg-da-accent/15 text-da-text" : "border-da-border text-da-muted hover:bg-da-hover"
              }`}
            >
              {label}
            </button>
          ))}
          <span>
            ({view === "all" ? summary.scored : summary.complete} students
            {view === "all" && summary.provisional > 0 ? `, ${summary.provisional} with marks not final yet` : ""})
          </span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-da-border text-left text-xs text-da-muted">
                <th className="py-2 pr-3 font-medium">Level</th>
                <th className="py-2 pr-3 font-medium">In use: marks</th>
                <th className="py-2 pr-3 font-medium">Students</th>
                <th className="py-2 pr-3 font-medium">Draft: marks</th>
                <th className="py-2 pr-3 font-medium">Students</th>
                <th className="py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((level) => {
                const a = inUse.counts[level];
                const b = drafted ? drafted.counts[level] : null;
                const diff = b === null ? null : b - a;
                return (
                  <tr key={level} className="border-b border-da-border/40 tabular-nums">
                    <td className="py-1.5 pr-3 font-semibold text-da-text">{level}</td>
                    <td className="py-1.5 pr-3 text-da-muted">{levelRange(level, current.cutoffs, total)}</td>
                    <td className="py-1.5 pr-3 text-da-text">{a}</td>
                    <td className="py-1.5 pr-3 text-da-muted">{levelRange(level, draft, total)}</td>
                    <td className="py-1.5 pr-3 text-da-text">{b ?? "-"}</td>
                    <td className="py-1.5 text-da-muted">{diff === null || diff === 0 ? "" : diff > 0 ? `+${diff}` : diff}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!current.cutoffs && (
            <p className={`mt-2 ${hint}`}>
              &ldquo;In use&rdquo; counts use the generic bands (80/70/60/50/40/30%) the gradebook shows with a ~.
            </p>
          )}
        </div>

        {data.decisions.length > 1 && (
          <div className="mt-4">
            <button type="button" onClick={() => setShowHistory((s) => !s)} className="text-xs text-blue-300 hover:underline">
              {showHistory ? "Hide" : "Show"} earlier decisions ({data.decisions.length - 1})
            </button>
            {showHistory && (
              <ul className="mt-2 space-y-2">
                {data.decisions.slice(1).map((d) => (
                  <li key={d.id} className="rounded border border-da-border/60 p-3 text-xs text-da-muted">
                    <span className="text-da-text">&ldquo;{d.statement}&rdquo;</span>
                    <br />
                    {d.decidedBy ?? "A teacher"}, {formatDate(d.decidedAt)} · {SOURCE_WORDS[d.source]}
                    {d.cutoffs ? ` · ${lineList(d.cutoffs)}` : ""}
                    {d.totalMarks ? ` of ${d.totalMarks}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* -- 2. Scores ---------------------------------------------------- */}
      <section className={card}>
        <h2 className={h2}>Scores</h2>
        <p className={`mt-1 ${hint}`}>
          Each part counts its ClevMark where it has been accepted, otherwise the marker&apos;s suggestion. A part the
          marker never returned counts 0
          {summary.neverMarkedParts > 0 ? ` (${summary.neverMarkedParts} such part${summary.neverMarkedParts === 1 ? "" : "s"} across the class)` : ""}.
          {summary.mean !== null && summary.median !== null
            ? ` Mean ${summary.mean.toFixed(1)}, median ${summary.median}.`
            : ""}
        </p>
        <ScoreChart hist={hist} total={total} current={current.cutoffs} draft={shownDraft} />

        {splits.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-200">
            {splits.map((s) => {
              const near = emptyScoresNear(hist, s.line).filter((x) => x !== s.line);
              return (
                <li key={s.grade}>
                  The {draftChanged ? "draft " : ""}
                  {s.grade} line at {s.line} separates {s.below} student{s.below === 1 ? "" : "s"} on {s.line - 1} from{" "}
                  {s.at} on {s.line}.{near.length > 0 ? ` Nobody scored ${orList(near)}.` : ""}
                </li>
              );
            })}
          </ul>
        )}

        {watch.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-da-text">Check these first</h3>
            <p className={hint}>
              Students whose level hangs on marks that are not final yet, against{" "}
              {draftChanged ? "the draft lines" : "the lines in use"}.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-da-border text-left text-xs text-da-muted">
                    <th className="py-1.5 pr-3 font-medium">Student</th>
                    <th className="py-1.5 pr-3 font-medium">Class</th>
                    <th className="py-1.5 pr-3 font-medium">Marks</th>
                    <th className="py-1.5 pr-3 font-medium">Level</th>
                    <th className="py-1.5 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {watch.map((w) => (
                    <tr key={w.subjectId} className="border-b border-da-border/40 align-top">
                      <td className="py-1.5 pr-3 text-da-text">{w.name}</td>
                      <td className="py-1.5 pr-3 text-da-muted">{w.className ?? "-"}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-da-text">{w.total}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-da-text">{w.level}</td>
                      <td className="py-1.5 text-xs text-da-muted">{w.reasons.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <a href={`/dashboard/tests/${data.test.id}/ai-grade`} className="mt-2 inline-block text-xs text-blue-300 hover:underline">
              Finish them in Mark Scans →
            </a>
          </div>
        )}
      </section>

      {/* -- 3. Draft ----------------------------------------------------- */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={h2}>Draft boundaries</h2>
          <button type="button" onClick={suggest} disabled={busy !== null || summary.scored === 0} className={btnGhost}>
            {busy === "suggest" ? "Asking the AI (up to a minute or two)..." : suggestion ? "Suggest again with AI" : "Suggest with AI"}
          </button>
        </div>
        <p className={`mt-1 ${hint}`}>The fewest marks for each level. Level 1 is everything below the level 2 line.</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-da-muted">
          <span>Start from:</span>
          {current.cutoffs && (
            <button type="button" className={btnGhost} onClick={() => setDraftFrom(current.cutoffs, { kind: "current" })}>
              Lines in use
            </button>
          )}
          {suggestion && (
            <button type="button" className={btnGhost} onClick={takeSuggestion}>
              AI suggestion
            </button>
          )}
          {data.presets
            .filter((p) => p.cutoffs)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.description ?? undefined}
                className={btnGhost}
                onClick={() => setDraftFrom(p.cutoffs, { kind: "preset", id: p.id })}
              >
                {p.name}
              </button>
            ))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {CUTOFF_GRADES.map((g) => {
            const n = draftNumbers[g];
            return (
              <label key={g} className="block">
                <span className="text-xs font-medium text-da-muted">Level {g} from</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={total}
                  step={1}
                  value={draftText[g]}
                  onChange={(e) => {
                    // Where the draft started stays recorded: the server
                    // compares the final lines with it to name the source.
                    const value = e.target.value;
                    setDraftText((t) => ({ ...t, [g]: value }));
                  }}
                  className="mt-1 w-full rounded border border-da-border bg-da-bg px-2 py-1.5 text-sm tabular-nums text-da-text"
                />
                <span className={hint}>{typeof n === "number" && n > 0 ? pct(n, total) : " "}</span>
              </label>
            );
          })}
        </div>
        {draftProblems.length > 0 && !draftBlank && (
          <ul className="mt-2 list-disc pl-5 text-xs text-red-200">
            {draftProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        {suggestion && <SuggestionPanel suggestion={suggestion} total={total} guidanceText={guidanceText} onUse={takeSuggestion} />}
      </section>

      {/* -- 4. Decision -------------------------------------------------- */}
      <section className={card}>
        <h2 className={h2}>Decision</h2>
        <p className={`mt-1 ${hint}`}>
          A decision is recorded with its reason and shown with the boundaries. It changes levels in the gradebook and
          the PowerSchool export for this assessment only.
        </p>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-da-muted">Why (required)</span>
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="e.g. Kept the Grade 9 lines for 7, 6 and 5; moved the 4 to 28 and the 3 to 23 so no line splits students one mark apart."
            className="mt-1 w-full rounded border border-da-border bg-da-bg px-3 py-2 text-sm text-da-text"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy !== null || !draft || !draftChanged || !statement.trim()}
            onClick={() => decide("adopt")}
            title={!draftChanged ? "The draft is the same as the lines in use: use Keep instead" : undefined}
          >
            {busy === "adopt" ? "Saving..." : "Use these boundaries"}
          </button>
          <button
            type="button"
            className={btnGhost}
            disabled={busy !== null || !current.cutoffs || !statement.trim()}
            onClick={() => decide("keep")}
          >
            {busy === "keep" ? "Saving..." : "Keep the boundaries in use"}
          </button>
          {draft && draftChanged && (
            <span className={hint}>
              Draft vs in use: {moves.up} up, {moves.down} down (counting marks not yet accepted).
            </span>
          )}
        </div>
      </section>

      {/* -- 5. Guidance -------------------------------------------------- */}
      <section className={card}>
        <h2 className={h2}>Guidance for the AI</h2>
        <p className={`mt-1 ${hint}`}>
          Tell the AI how to adjust its boundary suggestions. It reads the general rules first, then this
          assessment&apos;s notes, and a note here wins over a general rule.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="e.g. Never put a 7 below 88% on a Grade 9 paper."
          className="mt-3 w-full rounded border border-da-border bg-da-bg px-3 py-2 text-sm text-da-text"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Who this guidance is for" className="inline-flex rounded border border-da-border p-0.5">
            {(
              [
                ["test", "This assessment only"],
                ["all", "All assessments (general rule)"],
              ] as ["test" | "all", string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`rounded px-3 py-1 text-xs ${
                  scope === value ? "bg-da-accent text-da-on-accent" : "text-da-muted hover:bg-da-hover"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className={btnGhost} disabled={busy !== null || !note.trim()} onClick={() => saveGuidance(false)}>
            Save
          </button>
          <button type="button" className={btnGhost} disabled={busy !== null || !note.trim()} onClick={() => saveGuidance(true)}>
            Save &amp; suggest again
          </button>
        </div>

        <GuidanceList
          title="This assessment"
          empty="No notes for this assessment."
          rows={guidance.filter((g) => g.scope === "test")}
          onRemove={removeGuidance}
          disabled={busy !== null}
        />
        <GuidanceList
          title="General rules (all assessments)"
          empty="No general rules yet."
          rows={guidance.filter((g) => g.scope === "all")}
          onRemove={removeGuidance}
          disabled={busy !== null}
        />
      </section>
    </div>
  );
}

function GuidanceList({
  title,
  empty,
  rows,
  onRemove,
  disabled,
}: {
  title: string;
  empty: string;
  rows: GuidanceRow[];
  onRemove: (g: GuidanceRow) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-da-text">{title}</h3>
      {rows.length === 0 ? (
        <p className={`mt-1 ${hint}`}>{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((g) => (
            <li key={g.id} className="flex items-start justify-between gap-3 rounded border border-da-border/60 p-3 text-sm">
              <div>
                <p className="whitespace-pre-wrap text-da-text">{g.note}</p>
                <p className={`mt-1 ${hint}`}>Added {formatDate(g.createdAt)}</p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(g)}
                className="shrink-0 text-xs text-da-muted hover:text-red-200 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionPanel({
  suggestion,
  total,
  guidanceText,
  onUse,
}: {
  suggestion: SuggestionRow;
  total: number;
  guidanceText: (id: string) => string | null;
  onUse: () => void;
}) {
  const out = suggestion.output;
  return (
    <div className="mt-5 rounded-lg border border-da-border bg-da-bg/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-da-text">
          AI suggestion: {lineList(suggestion.cutoffs)}
        </h3>
        <button type="button" className={btnGhost} onClick={onUse}>
          Use as the draft
        </button>
      </div>
      <p className={`mt-1 ${hint}`}>
        {formatDate(suggestion.createdAt)} · {suggestion.model}
        {suggestion.totalMarks !== total ? ` · made when the paper was out of ${suggestion.totalMarks}` : ""}
      </p>
      <p className="mt-3 text-sm text-da-text">{out.rationale}</p>
      {out.levelNotes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-da-muted">
          {out.levelNotes.map((n, i) => (
            <li key={`${n.grade}-${i}`}>
              <span className="font-semibold text-da-text">Level {n.grade}:</span> {n.note}
            </li>
          ))}
        </ul>
      )}
      {out.guidanceApplied.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-da-muted">Your guidance</p>
          <ul className="mt-1 space-y-1 text-sm">
            {out.guidanceApplied.map((g) => (
              <li key={g.guidanceId} className="text-da-muted">
                <span className={g.applied ? "text-emerald-200" : "text-amber-200"}>{g.applied ? "Applied" : "Not applied"}</span>
                {": "}
                {guidanceText(g.guidanceId) ? <span className="text-da-text">&ldquo;{guidanceText(g.guidanceId)}&rdquo; </span> : null}
                {g.how}
              </li>
            ))}
          </ul>
        </div>
      )}
      {out.cautions.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200">
          {out.cautions.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Students on each total mark, stacked by whether every part is accepted,
 * with the lines in use (solid) and the draft (dashed). Inline SVG: the
 * project has no chart library and needs none for one histogram. Bars follow
 * the dataviz mark specs (thin, 2px gap between segments, rounded data end,
 * square at the baseline); the hover readout names both counts and both
 * levels, and the same numbers are in the table beneath.
 */
function ScoreChart({
  hist,
  total,
  current,
  draft,
}: {
  hist: HistogramBin[];
  total: number;
  current: Cutoffs | null;
  draft: Cutoffs | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const m = { top: 30, right: 12, bottom: 28, left: 30 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const band = plotW / (total + 1);
  const barW = Math.max(1, Math.min(24, band - 2));
  const maxCount = Math.max(1, ...hist.map((b) => b.complete + b.provisional));
  const step = Math.max(1, Math.ceil(maxCount / 4));
  const yMax = Math.ceil(maxCount / step) * step;
  const y = (count: number) => m.top + plotH - (count / yMax) * plotH;
  const xLeft = (score: number) => m.left + band * score;
  const xTickStep = total > 60 ? 10 : 5;

  /** A column segment with a rounded top (the data end) and a square base. */
  const roundedTop = (x: number, top: number, w: number, h: number) => {
    const r = Math.min(4, w / 2, h);
    return `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${top + h} Z`;
  };

  const occupied = hist.filter((b) => b.complete + b.provisional > 0);
  const hovered = hover === null ? null : hist[hover];
  // The readout sits inside the plot, beside the hovered column (right of it
  // on the left of the chart, left of it on the right), so the scroll box
  // around the chart never clips it and it never covers the column itself.
  const tipStyle =
    hovered === null
      ? undefined
      : xLeft(hovered.score) < W * 0.6
      ? { left: `${((xLeft(hovered.score) + band + 4) / W) * 100}%`, top: `${(m.top / H) * 100}%` }
      : { right: `${((W - xLeft(hovered.score) + 4) / W) * 100}%`, top: `${(m.top / H) * 100}%` };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-da-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: ACCEPTED_FILL }} /> every part accepted
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: PROVISIONAL_FILL }} /> not final yet
        </span>
        {current && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="18" y2="5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            lines in use
          </span>
        )}
        {draft && (
          <span className="inline-flex items-center gap-1.5 text-da-amber">
            <svg width="18" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="18" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            draft lines
          </span>
        )}
      </div>

      {/* Below 560px the chart scrolls sideways rather than shrinking its
          axis text past reading. */}
      <div className="mt-2 overflow-x-auto">
        <div className="relative min-w-[560px]">
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-da-border bg-da-bg px-2 py-1 text-xs shadow"
              style={tipStyle}
            >
              <span className="font-semibold text-da-text">{hovered.complete + hovered.provisional}</span>
              <span className="text-da-muted"> on {hovered.score}</span>
              <br />
              <span className="text-da-muted">
                {hovered.complete} accepted · {hovered.provisional} not final
              </span>
              <br />
              <span className="text-da-muted">
                level {levelForScore(hovered.score, total, current)}
                {draft ? ` in use, ${levelForScore(hovered.score, total, draft)} in draft` : ""}
              </span>
            </div>
          )}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full text-da-muted"
            role="img"
            aria-label={`Students on each total mark from 0 to ${total}, with the grade boundary lines. The same numbers are in the table below.`}
            onMouseLeave={() => setHover(null)}
          >
            {/* gridlines and y ticks */}
            {Array.from({ length: yMax / step + 1 }, (_, i) => i * step).map((v) => (
              <g key={v}>
                <line x1={m.left} x2={W - m.right} y1={y(v)} y2={y(v)} stroke="#4a3038" strokeWidth={1} />
                <text x={m.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="currentColor">
                  {v}
                </text>
              </g>
            ))}
            {/* x ticks */}
            {Array.from({ length: Math.floor(total / xTickStep) + 1 }, (_, i) => i * xTickStep).map((s) => (
              <text key={s} x={xLeft(s) + band / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="currentColor">
                {s}
              </text>
            ))}
            {/* columns */}
            {hist.map((b) => {
              const n = b.complete + b.provisional;
              if (n === 0) return null;
              const x = xLeft(b.score) + (band - barW) / 2;
              const base = y(0);
              const topComplete = y(b.complete);
              const topAll = y(n);
              const hasBoth = b.complete > 0 && b.provisional > 0;
              return (
                <g key={b.score} opacity={hover === null || hover === b.score ? 1 : 0.55}>
                  {b.complete > 0 &&
                    (b.provisional > 0 ? (
                      <rect x={x} y={topComplete} width={barW} height={base - topComplete} fill={ACCEPTED_FILL} />
                    ) : (
                      <path d={roundedTop(x, topComplete, barW, base - topComplete)} fill={ACCEPTED_FILL} />
                    ))}
                  {b.provisional > 0 && (
                    <path
                      d={roundedTop(
                        x,
                        topAll,
                        barW,
                        Math.max(1, (hasBoth ? topComplete - 2 : base) - topAll)
                      )}
                      fill={PROVISIONAL_FILL}
                    />
                  )}
                </g>
              );
            })}
            {/* boundary lines: in use solid, draft dashed */}
            {current &&
              CUTOFF_GRADES.map((g) => {
                const x = xLeft(current[g]);
                return (
                  <g key={`c${g}`}>
                    <line x1={x} x2={x} y1={m.top - 4} y2={y(0)} stroke="currentColor" strokeWidth={1.5} />
                    <text x={x} y={m.top - 16} textAnchor="middle" fontSize={10} fill="currentColor">
                      {g}
                    </text>
                  </g>
                );
              })}
            {/* A draft line that matches the line in use is not drawn: dashed
                over solid would hide the line in use. */}
            {draft &&
              CUTOFF_GRADES.map((g) => {
                if (current !== null && current[g] === draft[g]) return null;
                const x = xLeft(draft[g]);
                return (
                  <g key={`d${g}`} className="text-da-amber">
                    <line x1={x} x2={x} y1={m.top - 4} y2={y(0)} stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
                    <text x={x} y={m.top - 5} textAnchor="middle" fontSize={10} fill="currentColor">
                      {g}
                    </text>
                  </g>
                );
              })}
            {/* hover targets: the whole column band, bigger than the mark */}
            {hist.map((b) => (
              <rect
                key={`h${b.score}`}
                x={xLeft(b.score)}
                y={m.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(b.score)}
              />
            ))}
          </svg>
        </div>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-blue-300">Scores as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs tabular-nums">
            <thead>
              <tr className="border-b border-da-border text-left text-da-muted">
                <th className="py-1 pr-3 font-medium">Marks</th>
                <th className="py-1 pr-3 font-medium">Every part accepted</th>
                <th className="py-1 pr-3 font-medium">Not final yet</th>
                <th className="py-1 pr-3 font-medium">Level in use</th>
                {draft && <th className="py-1 font-medium">Level in draft</th>}
              </tr>
            </thead>
            <tbody>
              {[...occupied].reverse().map((b) => (
                <tr key={b.score} className="border-b border-da-border/40 text-da-text">
                  <td className="py-1 pr-3">{b.score}</td>
                  <td className="py-1 pr-3">{b.complete}</td>
                  <td className="py-1 pr-3">{b.provisional}</td>
                  <td className="py-1 pr-3">{levelForScore(b.score, total, current)}</td>
                  {draft && <td className="py-1">{levelForScore(b.score, total, draft)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
