"use client";

/**
 * StudentDashboard — Mastery view for a single student.
 *
 * Renders subtopic descriptors with inline KaTeX so IB notation like
 * $y = a\sin(bx+c)+d$, $(a+b)^n$, $\int f(x)\,dx$ renders beautifully.
 *
 * Includes a NuancedAnalysisPanel that generates an AI insight on demand
 * and persists it to Supabase via POST /api/mastery/analysis.
 */

import { useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { SubtopicMastery } from "@/lib/reflection-types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface SavedAnalysis {
  analysis_text: string;
  generated_at: string;
}

interface StudentDashboardProps {
  mastery: SubtopicMastery[];
  studentName: string;
  studentId?: string | null;
  savedAnalysis?: SavedAnalysis | null;
}

// ── Section metadata ──────────────────────────────────────────────────────────

const SECTION_NAMES: Record<number, string> = {
  1: "Number & Algebra",
  2: "Functions",
  3: "Geometry & Trig",
  4: "Stats & Probability",
  5: "Calculus",
};

const SECTION_ACCENT: Record<number, {
  dot: string;
  bar: string;
  headerBg: string;
  badge: string;
  rowHover: string;
  ring: string;
  pctColor: string;
}> = {
  1: {
    dot: "bg-sky-400",
    bar: "bg-sky-500",
    headerBg: "bg-sky-950/40 border-sky-800/40",
    badge: "bg-sky-900/50 text-sky-300 border-sky-700/50",
    rowHover: "hover:bg-sky-950/20",
    ring: "ring-sky-700/30",
    pctColor: "text-sky-300",
  },
  2: {
    dot: "bg-violet-400",
    bar: "bg-violet-500",
    headerBg: "bg-violet-950/40 border-violet-800/40",
    badge: "bg-violet-900/50 text-violet-300 border-violet-700/50",
    rowHover: "hover:bg-violet-950/20",
    ring: "ring-violet-700/30",
    pctColor: "text-violet-300",
  },
  3: {
    dot: "bg-emerald-400",
    bar: "bg-emerald-500",
    headerBg: "bg-emerald-950/40 border-emerald-800/40",
    badge: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
    rowHover: "hover:bg-emerald-950/20",
    ring: "ring-emerald-700/30",
    pctColor: "text-emerald-300",
  },
  4: {
    dot: "bg-amber-400",
    bar: "bg-amber-500",
    headerBg: "bg-amber-950/40 border-amber-800/40",
    badge: "bg-amber-900/50 text-amber-300 border-amber-700/50",
    rowHover: "hover:bg-amber-950/20",
    ring: "ring-amber-700/30",
    pctColor: "text-amber-300",
  },
  5: {
    dot: "bg-rose-400",
    bar: "bg-rose-500",
    headerBg: "bg-rose-950/40 border-rose-800/40",
    badge: "bg-rose-900/50 text-rose-300 border-rose-700/50",
    rowHover: "hover:bg-rose-950/20",
    ring: "ring-rose-700/30",
    pctColor: "text-rose-300",
  },
};

const FALLBACK_ACCENT = SECTION_ACCENT[1];

// ── Inline math renderer ──────────────────────────────────────────────────────

function renderDescriptor(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(?<!\$)\$(?!\$)([^$]+?)(?<!\$)\$(?!\$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const latex = match[1];
    try {
      const html = katex.renderToString(latex, { throwOnError: true, displayMode: false, strict: false });
      parts.push(
        <span key={`m${match.index}`} dangerouslySetInnerHTML={{ __html: html }} /> // eslint-disable-line react/no-danger
      );
    } catch {
      parts.push(<code key={`e${match.index}`} className="text-da-amber text-xs font-mono px-0.5">{latex}</code>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return parts.length > 0 ? parts : [<span key="full">{text}</span>];
}

// ── Tier helpers ──────────────────────────────────────────────────────────────

function tier(pct: number): string {
  if (pct >= 85) return "Mastered";
  if (pct >= 65) return "Developing";
  if (pct >= 40) return "Emerging";
  return "Needs work";
}

function tierColor(pct: number): string {
  if (pct >= 85) return "text-emerald-400";
  if (pct >= 65) return "text-da-accent";
  if (pct >= 40) return "text-da-amber";
  return "text-rose-400";
}

// ── NuancedAnalysisPanel ──────────────────────────────────────────────────────

function NuancedAnalysisPanel({
  studentId,
  initial,
}: {
  studentId: string;
  initial: SavedAnalysis | null;
}) {
  const [analysis, setAnalysis] = useState<SavedAnalysis | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mastery/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const data = await res.json() as { analysis_text?: string; generated_at?: string; error?: string };
      if (!res.ok || !data.analysis_text) {
        throw new Error(data.error ?? "Generation failed");
      }
      setAnalysis({ analysis_text: data.analysis_text, generated_at: data.generated_at ?? new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const dateLabel = analysis?.generated_at
    ? new Date(analysis.generated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-2xl border border-da-border bg-da-surface/80 shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-da-border/50 bg-indigo-950/30 border-indigo-800/40">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          <h3 className="font-serif text-sm font-bold text-da-text tracking-wide">Nuanced Analysis</h3>
          {dateLabel && (
            <span className="text-[11px] text-da-muted ml-1">· Generated {dateLabel}</span>
          )}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-lg border border-indigo-600/60 bg-indigo-900/50 px-3 py-1 text-xs font-bold text-indigo-300 hover:bg-indigo-800/60 disabled:opacity-50 transition-colors"
        >
          {loading ? "Generating…" : analysis ? "↺ Regenerate" : "✦ Generate"}
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {error && (
          <p className="text-xs text-rose-400 mb-3">{error}</p>
        )}
        {loading && (
          <div className="space-y-2 animate-pulse">
            {["w-full", "w-5/6", "w-4/5", "w-full", "w-3/4"].map((w, i) => (
              <div key={i} className={`h-3 ${w} rounded bg-da-border/40`} />
            ))}
          </div>
        )}
        {!loading && analysis && (
          <p className="text-sm text-da-text leading-relaxed whitespace-pre-wrap">
            {analysis.analysis_text}
          </p>
        )}
        {!loading && !analysis && !error && (
          <p className="text-sm text-da-muted italic">
            Click &ldquo;Generate&rdquo; to produce an AI-powered nuanced analysis of this student&apos;s mastery profile. The result is saved and will appear here on future visits.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Subtopic row ──────────────────────────────────────────────────────────────

function SubtopicRow({
  m,
  studentId,
  accent,
}: {
  m: SubtopicMastery;
  studentId?: string | null;
  accent: typeof FALLBACK_ACCENT;
}) {
  const pct = m.percentage;
  const selfPct = m.self_percentage;
  const hasData = m.total_marks > 0;
  const renderedDescriptor = useMemo(() => renderDescriptor(m.descriptor), [m.descriptor]);

  return (
    <a
      href={`/dashboard/mastery/subtopic?code=${encodeURIComponent(m.code)}${
        studentId ? `&studentId=${encodeURIComponent(studentId)}` : ""
      }`}
      className={`group flex flex-col gap-1.5 px-4 py-2.5 transition-colors ${
        accent.rowHover
      } ring-inset hover:ring-1 ${accent.ring}`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] font-bold leading-tight ${accent.badge}`}>
          {m.code}
        </span>
        <span className="flex-1 text-sm text-da-text leading-snug min-w-0">
          {renderedDescriptor}
        </span>
        {hasData ? (
          <span className={`shrink-0 text-sm font-bold tabular-nums ${tierColor(pct)}`}>{pct}%</span>
        ) : (
          <span className="shrink-0 text-xs text-da-muted/40">—</span>
        )}
      </div>
      {hasData && (
        <div className="pl-[4.25rem]">
          <div className="relative h-2 w-full rounded-full bg-da-bg/70 overflow-hidden">
            {selfPct > 0 && (
              <div className="absolute inset-y-0 left-0 rounded-full bg-da-amber/35 transition-all duration-500" style={{ width: `${Math.min(100, selfPct)}%` }} aria-hidden />
            )}
            {pct > 0 && (
              <div className={`absolute inset-y-0 left-0 rounded-full ${accent.bar} transition-all duration-500`} style={{ width: `${Math.min(100, pct)}%` }} aria-hidden />
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-da-muted">
            <span>Teacher: <span className="text-da-text font-semibold">{m.marks_awarded}/{m.total_marks}</span> Clev&apos;s Marks</span>
            {m.self_marks > 0 && (
              <><span className="text-da-border">·</span><span>Self: <span className="text-da-amber font-semibold">{m.self_marks}/{m.total_marks}</span></span></>
            )}
          </div>
        </div>
      )}
      {!hasData && (
        <p className="pl-[4.25rem] text-[11px] text-da-muted/50 italic">No assessment data yet</p>
      )}
    </a>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ section, rows, studentId }: { section: number; rows: SubtopicMastery[]; studentId?: string | null }) {
  const accent = SECTION_ACCENT[section] ?? FALLBACK_ACCENT;
  const name = SECTION_NAMES[section] ?? `Section ${section}`;
  const aw = rows.reduce((s, r) => s + r.marks_awarded, 0);
  const tot = rows.reduce((s, r) => s + r.total_marks, 0);
  const sectionPct = tot > 0 ? Math.round((aw / tot) * 100) : 0;
  const hasAny = tot > 0;

  return (
    <div className="rounded-2xl border border-da-border bg-da-surface/80 shadow-lg overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-3 border-b border-da-border/50 ${accent.headerBg}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${accent.dot}`} />
          <h3 className="font-serif text-sm font-bold text-da-text tracking-wide">{name}</h3>
        </div>
        {hasAny && (
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold tabular-nums ${tierColor(sectionPct)}`}>{sectionPct}%</span>
            <span className="hidden sm:inline text-[11px] text-da-muted">{tier(sectionPct)}</span>
          </div>
        )}
      </div>
      <div className="divide-y divide-da-border/25">
        {rows.map((m) => (
          <SubtopicRow key={m.code} m={m} studentId={studentId} accent={accent} />
        ))}
      </div>
    </div>
  );
}

// ── Overall summary strip ─────────────────────────────────────────────────────

function OverallStrip({ mastery }: { mastery: SubtopicMastery[] }) {
  const assessed = mastery.filter((m) => m.total_marks > 0);
  if (assessed.length === 0) return null;
  const totalAw = assessed.reduce((s, m) => s + m.marks_awarded, 0);
  const totalTot = assessed.reduce((s, m) => s + m.total_marks, 0);
  const overallPct = totalTot > 0 ? Math.round((totalAw / totalTot) * 100) : 0;

  return (
    <div className="rounded-xl border border-da-border bg-da-surface/60 px-5 py-4 flex flex-wrap items-center gap-6">
      <div className="min-w-[90px]">
        <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Overall</p>
        <p className={`mt-0.5 font-serif text-3xl font-bold ${tierColor(overallPct)}`}>{overallPct}%</p>
        <p className="text-[11px] text-da-muted">{totalAw}/{totalTot} Clev&apos;s Marks</p>
      </div>
      <div className="flex-1 min-w-[180px] grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((sec) => {
          const rows = mastery.filter((m) => m.section === sec && m.total_marks > 0);
          if (rows.length === 0) return <div key={sec} />;
          const aw = rows.reduce((s, r) => s + r.marks_awarded, 0);
          const tot = rows.reduce((s, r) => s + r.total_marks, 0);
          const pct = tot > 0 ? Math.round((aw / tot) * 100) : 0;
          const acc = SECTION_ACCENT[sec] ?? FALLBACK_ACCENT;
          return (
            <div key={sec} className="flex flex-col items-center gap-1">
              <span className={`text-xs font-bold tabular-nums ${tierColor(pct)}`}>{pct}%</span>
              <div className="w-full h-1.5 rounded-full bg-da-bg/60 overflow-hidden">
                <div className={`h-full rounded-full ${acc.bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] text-da-muted">§{sec}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-da-muted shrink-0">
        <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-da-accent" />Teacher marks</div>
        <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-da-amber/40" />Self-assessed</div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StudentDashboard({
  mastery,
  studentName: _studentName,
  studentId,
  savedAnalysis,
}: StudentDashboardProps) {
  const bySection = useMemo(() => {
    const map: Record<number, SubtopicMastery[]> = {};
    for (const row of mastery) {
      const sec = row.section || 0;
      if (!map[sec]) map[sec] = [];
      map[sec].push(row);
    }
    for (const rows of Object.values(map)) {
      rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }));
    }
    return map;
  }, [mastery]);

  const sections = [1, 2, 3, 4, 5].filter((s) => (bySection[s]?.length ?? 0) > 0);
  const unknownRows = bySection[0] ?? [];

  if (mastery.length === 0) {
    return (
      <div className="rounded-xl border border-da-border bg-da-bg/60 py-8 text-center text-da-muted">
        <p className="text-lg text-da-text">No mastery data yet</p>
        <p className="mt-1 text-sm">Complete some reflections to see your progress here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <OverallStrip mastery={mastery} />

      {/* Nuanced Analysis — only shown when studentId is known */}
      {studentId && (
        <NuancedAnalysisPanel studentId={studentId} initial={savedAnalysis ?? null} />
      )}

      {sections.map((sec) => (
        <SectionCard key={sec} section={sec} rows={bySection[sec] ?? []} studentId={studentId} />
      ))}

      {unknownRows.length > 0 && (
        <SectionCard key={0} section={0} rows={unknownRows} studentId={studentId} />
      )}
    </div>
  );
}
