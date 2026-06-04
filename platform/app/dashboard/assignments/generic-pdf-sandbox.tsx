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
  formatQuestionLabel,
} from "@/lib/assignments";
import { ActivityGeneratorPanel } from "./activity-generator";
import { NuancedAnalysisPreview } from "./nuanced-analysis-preview";

type GenericSandboxProps = {
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  defaultFormatting: FormattingRequirements;
  defaultInput: AssignmentInput;
  defaultDraft: AssignmentDraft;
};

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
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  async function loadTemplates() {
    try {
      const res = await fetch(`/api/assignments/templates/list?grade=${gradeLevel}`);
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

  async function saveAsTemplate() {
    if (!templateName.trim()) {
      setError("Please enter a template name");
      return;
    }
    setIsSavingTemplate(true);
    setError(null);
    try {
      const res = await fetch("/api/assignments/templates/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: templateName.trim(),
          gradeLevel,
          documentKind: input.documentKind,
          formattingRequirements: formatting,
          assignmentInput: input,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save template");
      }
      setTemplateName("");
      await loadTemplates();
    } catch (err) {
      setError(`Template save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function generateWithAi() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildSystemPrompt(gradeLevel),
          messages: [{ role: "user", content: buildUserPrompt(input, formatting) }],
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `AI request failed with status ${response.status}`);
      }
      const data = (await response.json()) as ClaudeResponse;
      const rawText = data.content?.find((block) => block.type === "text")?.text ?? "";
      const json = extractJsonObject(rawText);
      const parsed = JSON.parse(json) as AssignmentDraft;
      const sanitized = sanitizeDraft(parsed);
      setDraft(sanitized);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected AI generation error.";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleExportPdf() {
    try {
      const res = await fetch("/api/assignments/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          subtitle: draft.subtitle,
          instructions: draft.instructions,
          sections: draft.sections,
          formatting,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Export failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(draft.title || "assignment").replace(/[^a-z0-9]/gi, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return (
    <section className="rounded-2xl border border-da-border bg-da-surface/80 p-6 shadow-lg shadow-black/30">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* ── Left panel: controls ─────────────────────────────────────── */}
        <div className="space-y-5">
          <ActivityGeneratorPanel
            gradeLevel={gradeLevel}
            formatting={formatting}
            onDraftGenerated={(generated) => setDraft(generated)}
          />

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h2 className="text-lg font-semibold font-serif text-da-text">{gradeLevel} PDF Sandbox</h2>
            <p className="text-xs text-da-muted">
              Or configure the form below and use &ldquo;Generate With AI&rdquo; for more control over
              formatting and topic.
            </p>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Templates</h3>
            <button
              type="button"
              onClick={() => { setShowTemplates(!showTemplates); if (!showTemplates) loadTemplates(); }}
              className="w-full rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-2 text-sm font-medium text-da-text transition-colors hover:border-da-accent/60 hover:bg-da-hover"
            >
              {showTemplates ? "Hide Templates" : "Load From Template"}
            </button>
            {showTemplates && (
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-da-border bg-da-bg/30 p-3">
                {templates.length === 0 ? (
                  <p className="text-xs text-da-muted">No templates saved yet.</p>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => loadTemplate(t)}
                      className="w-full rounded-md border border-da-border/40 bg-da-hover/30 px-3 py-1.5 text-left text-xs text-da-text transition-colors hover:bg-da-hover"
                    >
                      {t.template_name}
                    </button>
                  ))
                )}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name…"
                className="flex-1 rounded-lg border border-da-border/50 bg-da-bg/30 px-2 py-1.5 text-xs text-da-text placeholder-da-muted/50 focus:border-da-accent/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={saveAsTemplate}
                disabled={isSavingTemplate}
                className="rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-text transition-colors hover:bg-da-hover disabled:opacity-50"
              >
                {isSavingTemplate ? "Saving..." : "Save As Template"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Assignment Input</h3>
            <LabeledInput label="Title" value={input.title} onChange={(v) => setInput((p) => ({ ...p, title: v }))} />
            <LabeledSelect
              label="Document Type"
              value={input.documentKind}
              onChange={(v) => setInput((p) => ({ ...p, documentKind: v as DocumentKind }))}
              options={[
                { value: "activity-sheet", label: "Activity Sheet" },
                { value: "practice-set", label: "Practice Set" },
                { value: "investigation", label: "Investigation Task" },
              ]}
            />
            <LabeledTextArea label="Topic" value={input.topic} onChange={(v) => setInput((p) => ({ ...p, topic: v }))} rows={2} />
            <LabeledTextArea label="Learning Goals" value={input.learningGoals} onChange={(v) => setInput((p) => ({ ...p, learningGoals: v }))} rows={3} />
            <LabeledTextArea label="Special Constraints" value={input.contextNotes} onChange={(v) => setInput((p) => ({ ...p, contextNotes: v }))} rows={2} />
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput
                label="Question Count"
                type="number"
                value={String(input.questionCount)}
                onChange={(v) => setInput((p) => ({ ...p, questionCount: clampInt(Number(v), 4, 30) }))}
              />
              <LabeledSelect
                label="Challenge Mix"
                value={input.challengeMix}
                onChange={(v) => setInput((p) => ({ ...p, challengeMix: v as AssignmentInput["challengeMix"] }))}
                options={[
                  { value: "foundational", label: "Foundational" },
                  { value: "balanced", label: "Balanced" },
                  { value: "challenge-forward", label: "Challenge Forward" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect
                label="Tone"
                value={input.tone}
                onChange={(v) => setInput((p) => ({ ...p, tone: v as AssignmentInput["tone"] }))}
                options={[
                  { value: "clear", label: "Clear" },
                  { value: "exam-style", label: "Exam Style" },
                  { value: "discovery", label: "Discovery" },
                ]}
              />
              <ToggleField
                label="Real-world context"
                checked={input.includeRealWorldContext}
                onChange={(c) => setInput((p) => ({ ...p, includeRealWorldContext: c }))}
              />
            </div>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Formatting Requirements</h3>
            <LabeledInput label="School Header" value={formatting.schoolName} onChange={(v) => setFormatting((p) => ({ ...p, schoolName: v }))} />
            <LabeledInput label="Teacher" value={formatting.teacherName ?? ""} onChange={(v) => setFormatting((p) => ({ ...p, teacherName: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect
                label="Font Size"
                value={String(formatting.fontSize)}
                onChange={(v) => setFormatting((p) => ({ ...p, fontSize: Number(v) as 10 | 11 | 12 }))}
                options={[
                  { value: "10", label: "10 pt" },
                  { value: "11", label: "11 pt" },
                  { value: "12", label: "12 pt" },
                ]}
              />
              <LabeledSelect
                label="Line Spacing"
                value={formatting.lineSpacing}
                onChange={(v) => setFormatting((p) => ({ ...p, lineSpacing: v as FormattingRequirements["lineSpacing"] }))}
                options={[
                  { value: "compact", label: "Compact" },
                  { value: "normal", label: "Normal" },
                  { value: "relaxed", label: "Relaxed" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect
                label="Page Margins"
                value={String(formatting.pageMarginsMm)}
                onChange={(v) => setFormatting((p) => ({ ...p, pageMarginsMm: Number(v) as 12 | 16 | 20 }))}
                options={[
                  { value: "12", label: "Narrow (12 mm)" },
                  { value: "16", label: "Standard (16 mm)" },
                  { value: "20", label: "Wide (20 mm)" },
                ]}
              />
              <LabeledSelect
                label="Question Numbering"
                value={formatting.numberingStyle}
                onChange={(v) => setFormatting((p) => ({ ...p, numberingStyle: v as FormattingRequirements["numberingStyle"] }))}
                options={[
                  { value: "numeric", label: "1, 2, 3" },
                  { value: "lettered", label: "a, b, c" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ToggleField label="Student name line" checked={formatting.includeNameLine} onChange={(c) => setFormatting((p) => ({ ...p, includeNameLine: c }))} />
              <ToggleField label="Date line" checked={formatting.includeDateLine} onChange={(c) => setFormatting((p) => ({ ...p, includeDateLine: c }))} />
              <ToggleField label="Marks column" checked={formatting.includeMarksColumn} onChange={(c) => setFormatting((p) => ({ ...p, includeMarksColumn: c }))} />
              <ToggleField label="Include answer key" checked={formatting.includeAnswerKey} onChange={(c) => setFormatting((p) => ({ ...p, includeAnswerKey: c }))} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={generateWithAi}
              disabled={isGenerating}
              className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? "Generating Draft..." : "Generate With AI"}
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="rounded-lg border border-da-border bg-da-hover px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-accent/60"
            >
              Download PDF
            </button>
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        {/* ── Right panel: Nuanced Analysis live preview ───────────────── */}
        <div className="rounded-xl border border-da-border bg-da-bg/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Live PDF Preview</h3>
            <span className="text-xs text-da-muted">Editable before export</span>
          </div>
          <div
            className="overflow-auto rounded-lg border border-da-border bg-white shadow-inner"
            style={{ minHeight: 860, padding: "32px 40px" }}
          >
            <NuancedAnalysisPreview
              draft={draft}
              formatting={formatting}
              onDraftChange={(updated) => setDraft(updated)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function LabeledInput({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
      />
    </label>
  );
}

function LabeledTextArea({
  label, value, onChange, rows,
}: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
      />
    </label>
  );
}

function LabeledSelect({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function ToggleField({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-da-border bg-da-bg/30 px-2.5 py-2 text-sm">
      <span className="text-da-text/90">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-amber-500"
      />
    </label>
  );
}
