"use client";

import { useEffect, useState, useCallback } from "react";
import {
  type AssignmentDraft,
  type AssignmentInput,
  type FormattingRequirements,
  type SavedTemplate,
  clampInt,
  computeTierDistribution,
  detectDuplicateQuestions,
} from "@/lib/assignments";
import { NuancedAnalysisPreview } from "../../nuanced-analysis-preview";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

type LoadState = "loading" | "ready" | "not-found" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type ExportState = "idle" | "exporting" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultFormatting(): FormattingRequirements {
  return {
    schoolName: "CleverPlatform Mathematics",
    teacherName: "",
    includeNameLine: true,
    includeDateLine: true,
    includeMarksColumn: true,
    includeAnswerKey: false,
    fontSize: 11,
    lineSpacing: "relaxed",
    pageMarginsMm: 16,
    numberingStyle: "numeric",
    answerStyle: "boxes",
    answerBoxLines: 4,
  };
}

function defaultDraft(): AssignmentDraft {
  return {
    title: "Untitled Analysis",
    subtitle: "IBDP Mathematics — Analysis & Approaches HL",
    instructions: [],
    sections: [],
  };
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function LabeledInput({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none" />
    </label>
  );
}

function LabeledSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function ToggleField({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-da-border bg-da-bg/30 px-2.5 py-2 text-sm">
      <span className="text-da-text/90">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-amber-500" />
    </label>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function StatPill({ label, value, color = "amber" }: { label: string; value: string | number; color?: "amber" | "blue" | "purple" | "emerald" | "muted" }) {
  const colors = {
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    blue: "border-blue-500/40 bg-blue-500/10 text-blue-300",
    purple: "border-purple-500/40 bg-purple-500/10 text-purple-300",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    muted: "border-da-border/60 bg-da-bg/60 text-da-muted",
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-da-muted">{label}</span>
      <span className={`rounded-md border px-2 py-0.5 text-sm font-bold tabular-nums ${colors[color]}`}>
        {value}
      </span>
    </div>
  );
}

// ── Section editor ────────────────────────────────────────────────────────────

function SectionEditor({
  section, sectionIdx, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast,
}: {
  section: AssignmentDraft["sections"][number];
  sectionIdx: number;
  onUpdate: (updated: AssignmentDraft["sections"][number]) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  function updateQuestion(qi: number, fields: Partial<AssignmentDraft["sections"][number]["questions"][number]>) {
    const qs = [...section.questions];
    qs[qi] = { ...qs[qi], ...fields };
    onUpdate({ ...section, questions: qs });
  }

  function addQuestion() {
    onUpdate({
      ...section,
      questions: [...section.questions, { prompt: "New question.", marks: 2 }],
    });
  }

  function deleteQuestion(qi: number) {
    onUpdate({ ...section, questions: section.questions.filter((_, i) => i !== qi) });
  }

  function moveQuestion(qi: number, dir: -1 | 1) {
    const qs = [...section.questions];
    const swap = qi + dir;
    if (swap < 0 || swap >= qs.length) return;
    [qs[qi], qs[swap]] = [qs[swap], qs[qi]];
    onUpdate({ ...section, questions: qs });
  }

  // suppress unused param warning — sectionIdx is accepted for future keying
  void sectionIdx;

  return (
    <div className="rounded-xl border border-da-border bg-da-bg/40">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-da-border/50">
        <button type="button" onClick={() => setCollapsed(!collapsed)}
          className="text-da-muted hover:text-da-text text-xs shrink-0">
          {collapsed ? "▶" : "▼"}
        </button>
        <input
          type="text"
          value={section.heading}
          onChange={(e) => onUpdate({ ...section, heading: e.target.value })}
          className="flex-1 bg-transparent border-0 text-sm font-semibold text-da-text focus:outline-none focus:border-b focus:border-da-accent/60 min-w-0"
          placeholder="Section heading…"
        />
        <span className="text-[10px] text-da-muted/60 shrink-0">{section.questions.length}q</span>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onMoveUp} disabled={isFirst}
            className="rounded border border-da-border/40 bg-da-bg/40 px-1.5 py-0.5 text-[10px] text-da-muted hover:bg-da-hover disabled:opacity-30">↑</button>
          <button type="button" onClick={onMoveDown} disabled={isLast}
            className="rounded border border-da-border/40 bg-da-bg/40 px-1.5 py-0.5 text-[10px] text-da-muted hover:bg-da-hover disabled:opacity-30">↓</button>
          <button type="button" onClick={() => { if (confirm(`Delete section "${section.heading}"?`)) onDelete(); }}
            className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/20">✕</button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 py-3 space-y-2">
          {section.questions.map((q, qi) => (
            <div key={qi} className="rounded-lg border border-da-border/40 bg-da-bg/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] text-da-muted pt-2.5 w-5 text-right">{qi + 1}.</span>
                <textarea
                  value={q.prompt}
                  onChange={(e) => updateQuestion(qi, { prompt: e.target.value })}
                  rows={Math.max(2, Math.ceil(q.prompt.length / 80))}
                  className="flex-1 resize-none rounded border border-da-border/40 bg-da-bg/40 px-2 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
                  placeholder="Question prompt…"
                />
                <div className="flex flex-col gap-1 shrink-0">
                  <input
                    type="number"
                    value={q.marks ?? 0}
                    onChange={(e) => updateQuestion(qi, { marks: clampInt(Number(e.target.value), 0, 20) })}
                    className="w-12 rounded border border-da-border/40 bg-da-bg/40 px-1 py-1 text-center text-xs text-da-text focus:outline-none"
                    title="Marks"
                  />
                  <span className="text-[9px] text-da-muted text-center">marks</span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-7">
                {/* Tier selector */}
                <div className="flex gap-1">
                  {([undefined, 1, 2, 3] as const).map((t) => (
                    <button key={String(t)} type="button"
                      onClick={() => updateQuestion(qi, { tier: t })}
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold border transition-colors ${
                        q.tier === t
                          ? t === 1 ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
                            : t === 2 ? "border-blue-500/60 bg-blue-500/20 text-blue-300"
                            : t === 3 ? "border-purple-500/60 bg-purple-500/20 text-purple-300"
                            : "border-da-border bg-da-bg/60 text-da-muted"
                          : "border-da-border/30 bg-transparent text-da-muted/40 hover:text-da-muted"
                      }`}>
                      {t === undefined ? "—" : "★".repeat(t)}
                    </button>
                  ))}
                </div>
                {/* Hint */}
                <input
                  type="text"
                  value={q.hint ?? ""}
                  onChange={(e) => updateQuestion(qi, { hint: e.target.value || undefined })}
                  placeholder="Hint (optional)…"
                  className="flex-1 rounded border border-da-border/30 bg-da-bg/30 px-2 py-0.5 text-[11px] text-da-muted/70 placeholder-da-muted/30 focus:border-da-accent/40 focus:outline-none"
                />
                {/* Answer */}
                <input
                  type="text"
                  value={q.answer ?? ""}
                  onChange={(e) => updateQuestion(qi, { answer: e.target.value || undefined })}
                  placeholder="Answer key…"
                  className="flex-1 rounded border border-da-border/30 bg-da-bg/30 px-2 py-0.5 text-[11px] text-da-muted/70 placeholder-da-muted/30 focus:border-da-accent/40 focus:outline-none"
                />
                {/* Move up/down/delete */}
                <div className="flex gap-0.5">
                  <button type="button" onClick={() => moveQuestion(qi, -1)} disabled={qi === 0}
                    className="rounded border border-da-border/30 bg-da-bg/30 px-1 py-0.5 text-[9px] text-da-muted hover:bg-da-hover disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveQuestion(qi, 1)} disabled={qi === section.questions.length - 1}
                    className="rounded border border-da-border/30 bg-da-bg/30 px-1 py-0.5 text-[9px] text-da-muted hover:bg-da-hover disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => deleteQuestion(qi)}
                    className="rounded border border-red-500/20 bg-red-500/10 px-1 py-0.5 text-[9px] text-red-400 hover:bg-red-500/20">✕</button>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addQuestion}
            className="w-full rounded-lg border border-dashed border-da-border/40 py-2 text-xs text-da-muted hover:border-da-accent/40 hover:text-da-text transition-colors">
            + Add question
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main editor component ─────────────────────────────────────────────────────

export function NuancedAnalysisEditorClient({ id }: { id: string }) {
  const router = useRouter();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportError, setExportError] = useState<string | null>(null);

  const [templateName, setTemplateName] = useState("");
  const [draft, setDraft] = useState<AssignmentDraft>(defaultDraft());
  const [formatting, setFormatting] = useState<FormattingRequirements>(defaultFormatting());
  const [answerBoxLines, setAnswerBoxLines] = useState(4);
  const [paperType, setPaperType] = useState<"paper1" | "paper2" | "mixed" | "investigation">("mixed");
  const [cohortTag, setCohortTag] = useState<"26AH" | "27AH" | "custom">("26AH");
  const [hasDraftContent, setHasDraftContent] = useState(false);

  // Computed stats
  const totalMarks = draft.sections.reduce((s, sec) =>
    s + sec.questions.reduce((q, qn) => q + (qn.marks ?? 0), 0), 0);
  const totalQ = draft.sections.reduce((s, sec) => s + sec.questions.length, 0);
  const tierDist = computeTierDistribution(draft);
  const duplicates = detectDuplicateQuestions(draft);

  // suppress unused — kept for future use
  void (router);

  // ── Load ──
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/assignments/templates/get?id=${id}`);
        if (res.status === 404) { setLoadState("not-found"); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { template: SavedTemplate };
        const t = data.template;
        setTemplateName(t.template_name);
        setFormatting(t.formatting_requirements);
        if (t.draft_content) {
          setDraft(t.draft_content as AssignmentDraft);
          setHasDraftContent(true);
        } else {
          // No draft saved yet — pre-populate title from assignment_input so editor isn't blank
          const ai = t.assignment_input as { title?: string; topic?: string };
          setDraft((d) => ({
            ...d,
            title: ai.title ?? t.template_name,
            subtitle: "IBDP Mathematics — Analysis & Approaches HL",
            syllabusTopics: ai.topic ?? "",
          }));
        }
        if (t.formatting_requirements.answerBoxLines) {
          setAnswerBoxLines(t.formatting_requirements.answerBoxLines);
        }
        setLoadState("ready");
      } catch (err) {
        console.error(err);
        setLoadState("error");
      }
    }
    void load();
  }, [id]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/assignments/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          templateName,
          gradeLevel: "Grade 12",
          documentKind: "investigation",
          formattingRequirements: { ...formatting, answerBoxLines },
          assignmentInput: {
            gradeLevel: "Grade 12",
            documentKind: "investigation",
            title: draft.title,
            topic: draft.syllabusTopics ?? "",
            learningGoals: "",
            contextNotes: "",
            questionCount: totalQ,
            challengeMix: "challenge-forward",
            includeRealWorldContext: true,
            tone: "exam-style",
          } as AssignmentInput,
          draftContent: draft,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      setHasDraftContent(true);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      console.error(err);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }, [id, templateName, draft, formatting, answerBoxLines, totalQ]);

  // ── Keyboard shortcut: Cmd/Ctrl+S ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  // ── Export PDF ──
  async function handleExportPdf() {
    setExportState("exporting");
    setExportError(null);
    try {
      const paperTypeLabel: Record<string, string> = {
        paper1: "Paper 1 — No Calculator",
        paper2: "Paper 2 — GDC Required",
        mixed: "Mixed (P1 + P2)",
        investigation: "Investigation / Paper 3 Style",
      };
      const subtitleParts = [
        draft.subtitle,
        cohortTag !== "custom" ? cohortTag : null,
        paperTypeLabel[paperType],
      ].filter(Boolean);

      const res = await fetch("/api/assignments/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          subtitle: subtitleParts.join(" · "),
          instructions: draft.instructions,
          sections: draft.sections,
          formatting: { ...formatting, answerBoxLines },
          ...(draft.course ? { course: draft.course } : {}),
          ...(draft.syllabusTopics ? { syllabusTopics: draft.syllabusTopics } : {}),
          ...(draft.commandTerms ? { commandTerms: draft.commandTerms } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draft.title.replace(/[^a-z0-9]/gi, "_")}.pdf`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportState("idle");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
      setExportState("error");
      setTimeout(() => { setExportState("idle"); setExportError(null); }, 4000);
    }
  }

  // ── Section mutation helpers ──
  function addSection() {
    setDraft((d) => ({
      ...d,
      sections: [
        ...d.sections,
        { heading: `Part ${d.sections.length} — New Section`, questions: [{ prompt: "★ Write down…", marks: 2 }] },
      ],
    }));
  }

  function updateSection(si: number, updated: AssignmentDraft["sections"][number]) {
    setDraft((d) => {
      const sections = [...d.sections];
      sections[si] = updated;
      return { ...d, sections };
    });
  }

  function deleteSection(si: number) {
    setDraft((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== si) }));
  }

  function moveSection(si: number, dir: -1 | 1) {
    setDraft((d) => {
      const sections = [...d.sections];
      const swap = si + dir;
      if (swap < 0 || swap >= sections.length) return d;
      [sections[si], sections[swap]] = [sections[swap], sections[si]];
      return { ...d, sections };
    });
  }

  // ── Instruction helpers ──
  function updateInstruction(i: number, val: string) {
    setDraft((d) => {
      const instructions = [...d.instructions];
      instructions[i] = val;
      return { ...d, instructions };
    });
  }
  function addInstruction() {
    setDraft((d) => ({ ...d, instructions: [...d.instructions, ""] }));
  }
  function deleteInstruction(i: number) {
    setDraft((d) => ({ ...d, instructions: d.instructions.filter((_, j) => j !== i) }));
  }

  // ── Render states ──
  if (loadState === "loading") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-da-border bg-da-surface/80 p-8 text-da-muted">
        <Spinner />
        <span className="text-sm">Loading analysis…</span>
      </div>
    );
  }

  if (loadState === "not-found") {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
        <p className="text-red-300 font-semibold">Analysis not found</p>
        <p className="text-sm text-red-400/70 mt-1">This analysis may have been deleted.</p>
        <button type="button" onClick={() => window.location.href = "/dashboard/assignments"}
          className="mt-4 rounded-lg border border-da-border bg-da-bg/40 px-4 py-2 text-sm text-da-text hover:bg-da-hover">
          ← Back to Assignments Studio
        </button>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
        <p className="text-red-300 font-semibold">Failed to load analysis</p>
        <button type="button" onClick={() => window.location.reload()}
          className="mt-4 rounded-lg border border-da-border bg-da-bg/40 px-4 py-2 text-sm text-da-text hover:bg-da-hover">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-da-border bg-da-bg/60 px-4 py-2.5">
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="flex-1 min-w-40 bg-transparent border-0 border-b border-transparent hover:border-da-border focus:border-da-accent/60 text-sm font-semibold text-da-text focus:outline-none transition-colors"
          placeholder="Analysis name…"
        />
        <div className="flex items-center gap-1.5 text-[10px] text-da-muted/60 shrink-0">
          <kbd className="rounded border border-da-border/40 px-1 py-0.5 font-mono">⌘S</kbd>
          <span>to save</span>
        </div>
        <StatPill label="Marks" value={`[${totalMarks}]`} color="amber" />
        <StatPill label="Questions" value={totalQ} color="muted" />
        {tierDist.t1 > 0 && <StatPill label="★" value={tierDist.t1} color="emerald" />}
        {tierDist.t2 > 0 && <StatPill label="★★" value={tierDist.t2} color="blue" />}
        {tierDist.t3 > 0 && <StatPill label="★★★" value={tierDist.t3} color="purple" />}
        {duplicates.length > 0 && (
          <span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">
            ⚠ {duplicates.length} duplicate{duplicates.length > 1 ? "s" : ""}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exportState === "exporting"}
            className="flex items-center gap-1.5 rounded-lg border border-da-accent/60 bg-da-accent/15 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/25 disabled:opacity-60"
          >
            {exportState === "exporting" ? <><Spinner /><span>Generating…</span></> : <>↓ Download PDF</>}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saveState === "saving"}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
              saveState === "saved"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : saveState === "error"
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-da-border bg-da-hover text-da-text hover:border-da-accent/60"
            }`}
          >
            {saveState === "saving" ? <><Spinner /><span>Saving…</span></>
              : saveState === "saved" ? "✓ Saved"
              : saveState === "error" ? "Save failed"
              : "Save"}
          </button>
        </div>
      </div>

      {exportError && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{exportError}</p>
      )}

      {/* ── Main two-column layout ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">

        {/* ── Left: structure editor ── */}
        <div className="space-y-5">

          {/* Document header fields */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Document Header</h3>
            <LabeledInput label="Title" value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} />
            <LabeledInput label="Subtitle" value={draft.subtitle ?? ""} onChange={(v) => setDraft((d) => ({ ...d, subtitle: v }))} />
            <LabeledInput label="Syllabus Topics" value={draft.syllabusTopics ?? ""} onChange={(v) => setDraft((d) => ({ ...d, syllabusTopics: v || undefined }))} />
            <LabeledInput label="Course" value={draft.course ?? ""} onChange={(v) => setDraft((d) => ({ ...d, course: v || undefined }))} />
          </div>

          {/* Instructions */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Instructions</h3>
            {draft.instructions.map((ins, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[10px] text-da-muted pt-2 w-4 shrink-0">{i + 1}.</span>
                <input
                  type="text"
                  value={ins}
                  onChange={(e) => updateInstruction(i, e.target.value)}
                  className="flex-1 rounded border border-da-border/40 bg-da-bg/40 px-2 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
                />
                <button type="button" onClick={() => deleteInstruction(i)}
                  className="rounded border border-red-500/20 bg-red-500/10 px-1.5 py-1 text-[10px] text-red-400 hover:bg-red-500/20 shrink-0 mt-0.5">✕</button>
              </div>
            ))}
            <button type="button" onClick={addInstruction}
              className="w-full rounded-lg border border-dashed border-da-border/40 py-1.5 text-xs text-da-muted hover:border-da-accent/40 hover:text-da-text transition-colors">
              + Add instruction
            </button>
          </div>

          {/* No-draft notice */}
          {!hasDraftContent && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-300">No packet content saved yet</p>
              <p className="text-[11px] text-amber-400/80 leading-relaxed">
                This analysis has no sections or questions yet. Two options:
              </p>
              <ul className="text-[11px] text-amber-400/80 space-y-0.5 ml-3 list-disc">
                <li><strong className="text-amber-300">AI Generator</strong> — go back to the Activity Generator, describe the topic (e.g. &ldquo;Rational Functions & Differential Analysis for IB HL&rdquo;), generate, then click <em>Save as Nuanced Analysis</em>. That will overwrite this record with a full packet.</li>
                <li><strong className="text-amber-300">Manual</strong> — use &ldquo;+ Add section&rdquo; below to build from scratch, then Save (⌘S).</li>
              </ul>
            </div>
          )}

          {/* Sections */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide px-1">Sections & Questions</h3>
            {draft.sections.map((sec, si) => (
              <SectionEditor
                key={si}
                section={sec}
                sectionIdx={si}
                onUpdate={(updated) => updateSection(si, updated)}
                onDelete={() => deleteSection(si)}
                onMoveUp={() => moveSection(si, -1)}
                onMoveDown={() => moveSection(si, 1)}
                isFirst={si === 0}
                isLast={si === draft.sections.length - 1}
              />
            ))}
            <button type="button" onClick={addSection}
              className="w-full rounded-xl border-2 border-dashed border-da-border/40 py-3 text-sm text-da-muted hover:border-da-accent/40 hover:text-da-text transition-colors">
              + Add section
            </button>
          </div>

          {/* Formatting */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Formatting</h3>
            <LabeledInput label="School Header" value={formatting.schoolName} onChange={(v) => setFormatting((p) => ({ ...p, schoolName: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect label="Font Size" value={String(formatting.fontSize)}
                onChange={(v) => setFormatting((p) => ({ ...p, fontSize: Number(v) as 10 | 11 | 12 }))}
                options={[{ value: "10", label: "10pt" }, { value: "11", label: "11pt" }, { value: "12", label: "12pt" }]} />
              <LabeledSelect label="Line Spacing" value={formatting.lineSpacing}
                onChange={(v) => setFormatting((p) => ({ ...p, lineSpacing: v as FormattingRequirements["lineSpacing"] }))}
                options={[{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "relaxed", label: "Relaxed" }]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect label="Margins" value={String(formatting.pageMarginsMm)}
                onChange={(v) => setFormatting((p) => ({ ...p, pageMarginsMm: Number(v) as 12 | 16 | 20 }))}
                options={[{ value: "12", label: "12 mm" }, { value: "16", label: "16 mm" }, { value: "20", label: "20 mm" }]} />
              <LabeledSelect label="Answer Style" value={formatting.answerStyle ?? "boxes"}
                onChange={(v) => setFormatting((p) => ({ ...p, answerStyle: v as "boxes" | "lines" | "none" }))}
                options={[{ value: "boxes", label: "Boxes" }, { value: "lines", label: "Lines" }, { value: "none", label: "None" }]} />
            </div>
            {(formatting.answerStyle ?? "boxes") !== "none" && (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-xs text-da-muted">Answer lines (global)</span>
                  <span className="text-xs font-semibold text-da-text tabular-nums">{answerBoxLines}</span>
                </div>
                <input type="range" min={1} max={12} value={answerBoxLines}
                  onChange={(e) => setAnswerBoxLines(Number(e.target.value))}
                  className="w-full accent-amber-500" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect label="Paper Type" value={paperType}
                onChange={(v) => setPaperType(v as typeof paperType)}
                options={[{ value: "paper1", label: "P1 No Calc" }, { value: "paper2", label: "P2 GDC" }, { value: "mixed", label: "Mixed" }, { value: "investigation", label: "Investigation" }]} />
              <LabeledSelect label="Cohort" value={cohortTag}
                onChange={(v) => setCohortTag(v as typeof cohortTag)}
                options={[{ value: "26AH", label: "26AH" }, { value: "27AH", label: "27AH" }, { value: "custom", label: "None" }]} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ToggleField label="Name line" checked={formatting.includeNameLine} onChange={(c) => setFormatting((p) => ({ ...p, includeNameLine: c }))} />
              <ToggleField label="Date line" checked={formatting.includeDateLine} onChange={(c) => setFormatting((p) => ({ ...p, includeDateLine: c }))} />
              <ToggleField label="Marks column" checked={formatting.includeMarksColumn} onChange={(c) => setFormatting((p) => ({ ...p, includeMarksColumn: c }))} />
              <ToggleField label="Answer key" checked={formatting.includeAnswerKey} onChange={(c) => setFormatting((p) => ({ ...p, includeAnswerKey: c }))} />
            </div>
          </div>
        </div>

        {/* ── Right: live preview ── */}
        <div className="space-y-3">
          <div className="rounded-xl border border-da-border bg-da-bg/30 p-4">
            <div
              className="overflow-auto rounded-lg border border-da-border bg-white shadow-inner"
              style={{ minHeight: 860, padding: "32px 40px" }}
            >
              <NuancedAnalysisPreview
                draft={draft}
                formatting={formatting}
                onDraftChange={setDraft}
                globalAnswerLines={answerBoxLines}
                gradeLevel="Grade 12"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
