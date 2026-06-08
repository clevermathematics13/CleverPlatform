"use client";

import { useMemo, useState } from "react";
import {
  type DocumentKind,
  type FormattingRequirements,
  type AssignmentInput,
  type AssignmentDraft,
  type SavedTemplate,
  type ClaudeResponse,
  clampInt,
  buildSystemPrompt,
  buildUserPrompt,
  extractJsonObject,
  sanitizeDraft,
  computeTierDistribution,
  detectDuplicateQuestions,
} from "@/lib/assignments";
import { ActivityGeneratorPanel } from "./activity-generator";
import { NuancedAnalysisPreview } from "./nuanced-analysis-preview";

type GenericSandboxProps = {
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  defaultFormatting: FormattingRequirements;
  defaultInput: AssignmentInput;
  defaultDraft: AssignmentDraft;
};

function parseSubtopics(syllabusTopics?: string): string[] {
  if (!syllabusTopics) return [];
  // Split on & · , | / and clean up each segment
  return syllabusTopics
    .split(/[&·,|/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function GenericAssignmentSandbox({
  gradeLevel,
  defaultFormatting,
  defaultInput,
  defaultDraft,
}: GenericSandboxProps) {
  const [formatting, setFormatting] = useState<FormattingRequirements>(defaultFormatting);
  const [input, setInput] = useState<AssignmentInput>(defaultInput);
  const [draft, setDraft] = useState<AssignmentDraft>(defaultDraft);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingMs, setIsExportingMs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [answerBoxLines, setAnswerBoxLines] = useState(4);
  const [paperType, setPaperType] = useState<"paper1" | "paper2" | "mixed" | "investigation">("mixed");
  const [cohortTag, setCohortTag] = useState<"26AH" | "27AH" | "custom">("26AH");

  const totalMarks = useMemo(() =>
    draft.sections.reduce((sSum: number, s) =>
      sSum + s.questions.reduce((qSum: number, q) => {
        const subTotal = Array.isArray(q.subparts) ? q.subparts.reduce((sp: number, sub) => sp + (sub.marks ?? 0), 0) : 0;
        return qSum + (subTotal > 0 ? subTotal : (q.marks ?? 0));
      }, 0)
    , 0)
  , [draft]);

  const totalQuestions = useMemo(() =>
    draft.sections.reduce((sum: number, s) => sum + s.questions.length, 0)
  , [draft]);

  const tierDist = useMemo(() => computeTierDistribution(draft), [draft]);
  const duplicates = useMemo(() => detectDuplicateQuestions(draft), [draft]);
  const subtopics = useMemo(() => parseSubtopics((draft as { syllabusTopics?: string }).syllabusTopics), [draft]);

  const paperTypeLabel: Record<string, string> = {
    paper1: "Paper 1 — No Calculator",
    paper2: "Paper 2 — GDC Required",
    mixed: "Mixed (P1 + P2)",
    investigation: "Investigation / Paper 3 Style",
  };

  async function loadTemplates() {
    try {
      const res = await fetch(`/api/assignments/templates/list?grade=all`);
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { templates: SavedTemplate[] };
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(`Failed to load templates: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  async function loadTemplate(template: SavedTemplate) {
    setFormatting(template.formatting_requirements);
    setInput(template.assignment_input);
    setShowTemplates(false);
  }

  async function deleteTemplate(id: string) {
    try {
      const res = await fetch(`/api/assignments/templates/delete?id=${id}`, { method: "DELETE" });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; throw new Error(d.error ?? "Failed to delete"); }
      await loadTemplates();
    } catch (err) {
      setError(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) { setError("Please enter a template name"); return; }
    setIsSavingTemplate(true); setError(null);
    try {
      const res = await fetch("/api/assignments/templates/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateName: templateName.trim(), gradeLevel, documentKind: input.documentKind, formattingRequirements: formatting, assignmentInput: input }),
      });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; throw new Error(d.error ?? "Failed to save template"); }
      setTemplateName("");
      await loadTemplates();
    } catch (err) {
      setError(`Template save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally { setIsSavingTemplate(false); }
  }

  async function generateWithAi() {
    setIsGenerating(true); setError(null);
    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: buildSystemPrompt(gradeLevel), messages: [{ role: "user", content: buildUserPrompt(input, formatting) }] }),
      });
      if (!response.ok) { const d = (await response.json()) as { error?: string }; throw new Error(d.error ?? `AI request failed with status ${response.status}`); }
      const data = (await response.json()) as ClaudeResponse;
      const rawText = data.content?.find((block) => block.type === "text")?.text ?? "";
      const json = extractJsonObject(rawText);
      const parsed = JSON.parse(json) as AssignmentDraft;
      setDraft(sanitizeDraft(parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected AI generation error.");
    } finally { setIsGenerating(false); }
  }

  function buildPdfBody(isMarkScheme = false) {
    const subtitleParts = [
      draft.subtitle,
      cohortTag !== "custom" ? cohortTag : null,
      paperTypeLabel[paperType],
      isMarkScheme ? "— MARK SCHEME" : null,
    ].filter(Boolean);
    return {
      title: draft.title,
      subtitle: subtitleParts.join(" · "),
      instructions: draft.instructions,
      sections: draft.sections,
      formatting: { ...formatting, answerBoxLines },
      ...(draft.course ? { course: draft.course } : {}),
      ...(draft.syllabusTopics ? { syllabusTopics: draft.syllabusTopics } : {}),
      ...(draft.prerequisites ? { prerequisites: draft.prerequisites } : {}),
      ...(draft.materials ? { materials: draft.materials } : {}),
      ...(draft.commandTerms ? { commandTerms: draft.commandTerms } : {}),
    };
  }

  async function handleExportPdf() {
    setIsExporting(true); setError(null);
    try {
      const res = await fetch("/api/assignments/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPdfBody(false)),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? `Export failed (${res.status})`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(draft.title || "assignment").replace(/[^a-z0-9]/gi, "_")}.pdf`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally { setIsExporting(false); }
  }

  async function handleExportMarkScheme() {
    setIsExportingMs(true); setError(null);
    try {
      const res = await fetch("/api/assignments/mark-scheme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPdfBody(true)),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? `Mark scheme export failed (${res.status})`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(draft.title || "assignment").replace(/[^a-z0-9]/gi, "_")}_mark_scheme.pdf`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Mark scheme export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally { setIsExportingMs(false); }
  }

  return (
    <section className="rounded-2xl border border-da-border bg-da-surface/80 p-6 shadow-lg shadow-black/30">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* ── Left panel ─────────────────────────────────────────────────────────── */}
        <div className="space-y-5">
          <ActivityGeneratorPanel gradeLevel={gradeLevel} formatting={formatting} onDraftGenerated={(g) => setDraft(g)} />

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h2 className="text-lg font-semibold font-serif text-da-text">{gradeLevel} PDF Sandbox</h2>
            <p className="text-xs text-da-muted">Configure below and use &ldquo;Generate With AI&rdquo;, or use the AI Activity Generator above.</p>
          </div>

          {/* Nuanced Analyses */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Nuanced Analyses</h3>
            <button type="button" onClick={() => { setShowTemplates(!showTemplates); if (!showTemplates) loadTemplates(); }}
              className="w-full rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-2 text-sm font-medium text-da-text transition-colors hover:border-da-accent/60 hover:bg-da-hover">
              {showTemplates ? "Hide Nuanced Analyses" : "Load Nuanced Analysis"}
            </button>
            {showTemplates && (
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-da-border bg-da-bg/30 p-3">
                {templates.length === 0 ? <p className="text-xs text-da-muted">No saved analyses yet.</p> :
                  templates.map((t) => (
                    <div key={t.id} className="flex items-center gap-1 group">
                      <button type="button" onClick={() => loadTemplate(t)}
                        className="flex-1 rounded-md border border-da-border/40 bg-da-hover/30 px-3 py-1.5 text-left text-xs text-da-text transition-colors hover:bg-da-hover truncate">
                        {t.template_name}
                      </button>
                      <button type="button" onClick={() => { if (confirm(`Delete "${t.template_name}"?`)) void deleteTemplate(t.id); }}
                        className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1 text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
                        title="Delete this Nuanced Analysis">
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <div className="border-t border-da-border/30 pt-3">
              <p className="mb-1.5 text-[10px] font-semibold text-da-muted uppercase tracking-wide">Save current as Nuanced Analysis</p>
              <div className="flex gap-2">
                <input type="text" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Name this analysis…"
                  className="flex-1 rounded-lg border border-da-border/50 bg-da-bg/30 px-2 py-1.5 text-xs text-da-text placeholder-da-muted/50 focus:border-da-accent/60 focus:outline-none" />
                <button type="button" onClick={saveAsTemplate} disabled={isSavingTemplate}
                  className="rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-text transition-colors hover:bg-da-hover disabled:opacity-50">
                  {isSavingTemplate ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>

          {/* Assignment Input */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Assignment Input</h3>
            <LabeledInput label="Title" value={input.title} onChange={(v) => setInput((p) => ({ ...p, title: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect label="Document Type" value={input.documentKind} onChange={(v) => setInput((p) => ({ ...p, documentKind: v as DocumentKind }))}
                options={[{ value: "activity-sheet", label: "Activity Sheet" }, { value: "practice-set", label: "Practice Set" }, { value: "investigation", label: "Investigation Task" }]} />
              <LabeledSelect label="Paper Type" value={paperType} onChange={(v) => setPaperType(v as typeof paperType)}
                options={[{ value: "paper1", label: "Paper 1 (No Calc)" }, { value: "paper2", label: "Paper 2 (GDC)" }, { value: "mixed", label: "Mixed" }, { value: "investigation", label: "Investigation" }]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect label="Cohort" value={cohortTag} onChange={(v) => setCohortTag(v as typeof cohortTag)}
                options={[{ value: "26AH", label: "26AH (Year 12)" }, { value: "27AH", label: "27AH (Year 11)" }, { value: "custom", label: "Custom / No Tag" }]} />
              <LabeledSelect label="Challenge Mix" value={input.challengeMix} onChange={(v) => setInput((p) => ({ ...p, challengeMix: v as AssignmentInput["challengeMix"] }))}
                options={[{ value: "foundational", label: "Foundational" }, { value: "balanced", label: "Balanced" }, { value: "challenge-forward", label: "Challenge Forward" }]} />
            </div>
            <LabeledTextArea label="Topic" value={input.topic} onChange={(v) => setInput((p) => ({ ...p, topic: v }))} rows={2} />
            <LabeledTextArea label="Learning Goals" value={input.learningGoals} onChange={(v) => setInput((p) => ({ ...p, learningGoals: v }))} rows={3} />
            <LabeledTextArea label="Special Constraints" value={input.contextNotes} onChange={(v) => setInput((p) => ({ ...p, contextNotes: v }))} rows={2} />
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label="Question Count" type="number" value={String(input.questionCount)} onChange={(v) => setInput((p) => ({ ...p, questionCount: clampInt(Number(v), 4, 30) }))} />
              <LabeledSelect label="Tone" value={input.tone} onChange={(v) => setInput((p) => ({ ...p, tone: v as AssignmentInput["tone"] }))}
                options={[{ value: "clear", label: "Clear" }, { value: "exam-style", label: "Exam Style" }, { value: "discovery", label: "Discovery" }]} />
            </div>
            <ToggleField label="Include real-world context" checked={input.includeRealWorldContext} onChange={(c) => setInput((p) => ({ ...p, includeRealWorldContext: c }))} />
          </div>

          {/* Formatting */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Formatting Requirements</h3>
            <LabeledInput label="School Header" value={formatting.schoolName} onChange={(v) => setFormatting((p) => ({ ...p, schoolName: v }))} />
            <LabeledInput label="Teacher" value={formatting.teacherName ?? ""} onChange={(v) => setFormatting((p) => ({ ...p, teacherName: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect label="Font Size" value={String(formatting.fontSize)} onChange={(v) => setFormatting((p) => ({ ...p, fontSize: Number(v) as 10 | 11 | 12 }))}
                options={[{ value: "10", label: "10 pt" }, { value: "11", label: "11 pt" }, { value: "12", label: "12 pt" }]} />
              <LabeledSelect label="Line Spacing" value={formatting.lineSpacing} onChange={(v) => setFormatting((p) => ({ ...p, lineSpacing: v as FormattingRequirements["lineSpacing"] }))}
                options={[{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "relaxed", label: "Relaxed" }]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect label="Page Margins" value={String(formatting.pageMarginsMm)} onChange={(v) => setFormatting((p) => ({ ...p, pageMarginsMm: Number(v) as 12 | 16 | 20 }))}
                options={[{ value: "12", label: "Narrow (12 mm)" }, { value: "16", label: "Standard (16 mm)" }, { value: "20", label: "Wide (20 mm)" }]} />
              <LabeledSelect label="Question Numbering" value={formatting.numberingStyle} onChange={(v) => setFormatting((p) => ({ ...p, numberingStyle: v as FormattingRequirements["numberingStyle"] }))}
                options={[{ value: "numeric", label: "1, 2, 3" }, { value: "lettered", label: "a, b, c" }]} />
            </div>

            <LabeledSelect
              label="Answer Style"
              value={formatting.answerStyle ?? "boxes"}
              onChange={(v) => setFormatting((p) => ({ ...p, answerStyle: v as "boxes" | "lines" | "none" }))}
              options={[
                { value: "boxes", label: "Answer Boxes (bordered)" },
                { value: "lines", label: "Answer Lines (bare)" },
                { value: "none", label: "No Answer Space" },
              ]}
            />

            {/* Answer Box Lines slider */}
            {(formatting.answerStyle ?? "boxes") !== "none" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-da-muted">{(formatting.answerStyle ?? "boxes") === "boxes" ? "Answer Box Lines" : "Answer Lines"} (global default)</span>
                <span className="rounded-md border border-da-border/60 bg-da-bg/60 px-2 py-0.5 text-xs font-semibold tabular-nums text-da-text">
                  {answerBoxLines} {answerBoxLines === 1 ? "line" : "lines"}
                </span>
              </div>
              <input type="range" min={1} max={12} step={1} value={answerBoxLines}
                onChange={(e) => setAnswerBoxLines(Number(e.target.value))}
                className="w-full accent-amber-500" />
              <div className="flex justify-between text-[10px] text-da-muted/60">
                <span>Short answer</span><span>Extended response</span>
              </div>
            </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <ToggleField label="Student name line" checked={formatting.includeNameLine} onChange={(c) => setFormatting((p) => ({ ...p, includeNameLine: c }))} />
              <ToggleField label="Date line" checked={formatting.includeDateLine} onChange={(c) => setFormatting((p) => ({ ...p, includeDateLine: c }))} />
              <ToggleField label="Marks column" checked={formatting.includeMarksColumn} onChange={(c) => setFormatting((p) => ({ ...p, includeMarksColumn: c }))} />
              <ToggleField label="Include answer key" checked={formatting.includeAnswerKey} onChange={(c) => setFormatting((p) => ({ ...p, includeAnswerKey: c }))} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={generateWithAi} disabled={isGenerating}
              className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60">
              {isGenerating ? "Generating Draft..." : "Generate With AI"}
            </button>
            <button type="button" onClick={handleExportPdf} disabled={isExporting}
              className="flex items-center gap-2 rounded-lg border border-da-border bg-da-hover px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-accent/60 disabled:cursor-not-allowed disabled:opacity-60">
              {isExporting ? <><Spinner />Generating PDF…</> : "Download PDF"}
            </button>
            <button type="button" onClick={handleExportMarkScheme} disabled={isExportingMs}
              className="flex items-center gap-2 rounded-lg border border-violet-500/50 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60">
              {isExportingMs ? <><Spinner />Generating…</> : "Download Mark Scheme"}
            </button>
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>
          )}
        </div>

        {/* ── Right panel ───────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-da-border bg-da-bg/60 px-4 py-2.5">
            <Stat label="Total marks" value={`[${totalMarks}]`} accent="amber" />
            <Divider />
            <Stat label="Questions" value={String(totalQuestions)} />
            <Divider />
            <div className="flex items-center gap-1.5">
              {tierDist.t1 > 0 && <TierPill count={tierDist.t1} tier={1} />}
              {tierDist.t2 > 0 && <TierPill count={tierDist.t2} tier={2} />}
              {tierDist.t3 > 0 && <TierPill count={tierDist.t3} tier={3} />}
              {tierDist.untiered > 0 && (
                <span className="rounded-full border border-da-border/60 bg-da-bg/60 px-2 py-0.5 text-[10px] text-da-muted">
                  {tierDist.untiered} untiered
                </span>
              )}
            </div>
            <Divider />
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              paperType === "paper1" ? "border border-blue-500/40 bg-blue-500/10 text-blue-300"
              : paperType === "paper2" ? "border border-green-500/40 bg-green-500/10 text-green-300"
              : paperType === "investigation" ? "border border-purple-500/40 bg-purple-500/10 text-purple-300"
              : "border border-da-border/60 bg-da-bg/60 text-da-muted"
            }`}>{paperTypeLabel[paperType]}</span>
            {cohortTag !== "custom" && (
              <><Divider /><span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">{cohortTag}</span></>
            )}
            {duplicates.length > 0 && (
              <><Divider /><span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">⚠ {duplicates.length} duplicate{duplicates.length > 1 ? "s" : ""}</span></>
            )}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[10px] text-da-muted/60">Editable before export</span>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExporting}
                className="flex items-center gap-1.5 rounded-lg border border-da-accent/60 bg-da-accent/15 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExporting ? <><Spinner /><span>Generating…</span></> : <><span>↓</span><span>Download PDF</span></>}
              </button>
            </div>
          </div>

          {subtopics.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              <span className="text-[10px] font-semibold text-da-muted uppercase tracking-wide">Subtopics:</span>
              {subtopics.map((sub) => (
                <span
                  key={sub}
                  className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300"
                >
                  {sub}
                </span>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-da-border bg-da-bg/30 p-4">
            <div className="overflow-auto rounded-lg border border-da-border bg-white shadow-inner" style={{ minHeight: 860, padding: "32px 40px" }}>
              <NuancedAnalysisPreview
                draft={draft}
                formatting={formatting}
                onDraftChange={setDraft}
                globalAnswerLines={answerBoxLines}
                gradeLevel={gradeLevel}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Small reusable UI atoms ──────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function Divider() {
  return <div className="h-4 w-px bg-da-border" />;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "amber" }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-da-muted">{label}</span>
      <span className={`rounded-md border px-2 py-0.5 text-sm font-bold tabular-nums ${
        accent === "amber" ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-da-border/60 bg-da-bg/60 text-da-text"
      }`}>{value}</span>
    </div>
  );
}

function TierPill({ count, tier }: { count: number; tier: 1 | 2 | 3 }) {
  const styles: Record<number, string> = {
    1: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    2: "border-blue-500/40 bg-blue-500/10 text-blue-300",
    3: "border-purple-500/40 bg-purple-500/10 text-purple-300",
  };
  const stars = "★".repeat(tier);
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles[tier]}`}>
      {count} {stars}
    </span>
  );
}

function LabeledInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none" />
    </label>
  );
}

function LabeledTextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none" />
    </label>
  );
}

function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
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

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-da-border bg-da-bg/30 px-2.5 py-2 text-sm">
      <span className="text-da-text/90">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-amber-500" />
    </label>
  );
}
