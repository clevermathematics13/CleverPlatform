"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  FormattingRequirements,
  AssignmentInput,
  AssignmentDraft,
  SavedTemplate,
} from "@/lib/assignments";

type GenericAssignmentSandboxProps = {
  gradeLevel: string;
  defaultFormatting: FormattingRequirements;
  defaultInput: AssignmentInput;
  defaultDraft: AssignmentDraft;
};

export function GenericAssignmentSandbox({
  gradeLevel,
  defaultFormatting,
  defaultInput,
  defaultDraft,
}: GenericAssignmentSandboxProps) {
  const [formatting, setFormatting] = useState<FormattingRequirements>(defaultFormatting);
  const [input, setInput] = useState<AssignmentInput>(defaultInput);
  const [draft, setDraft] = useState<AssignmentDraft>(defaultDraft);

  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [refineText, setRefineText] = useState("");

  // ─────────────────────────────────────────────────────────────────────────
  // Load templates on mount
  // ─────────────────────────────────────────────────────────────────────────

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`/api/assignments/templates/list?grade=all`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { templates: SavedTemplate[] };
      setTemplates(data.templates ?? []);
      setError(null);
    } catch (err) {
      setError(`Failed to load templates: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // ─────────────────────────────────────────────────────────────────────────
  // Save as template — pack the current draft into assignmentInput.__draft
  // so loading this template fully restores the assignment content.
  // The __draft key is stored as raw JSONB and ignored by Zod validation.
  // ─────────────────────────────────────────────────────────────────────────

  const handleSaveTemplate = useCallback(async () => {
    if (!templateName.trim()) {
      setError("Template name is required");
      return;
    }
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/assignments/templates/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: templateName.trim(),
          gradeLevel,
          documentKind: input.documentKind,
          formattingRequirements: formatting,
          // Pack the current draft alongside input so loading restores everything
          assignmentInput: { ...input, __draft: draft },
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSuccess("Template saved!");
      setTemplateName("");
      await loadTemplates();
    } catch (err) {
      setError(`Failed to save template: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  }, [templateName, formatting, input, draft, gradeLevel, loadTemplates]);

  // ─────────────────────────────────────────────────────────────────────────
  // Load a saved template — unpack __draft and restore all three states
  // ─────────────────────────────────────────────────────────────────────────

  const handleLoadTemplate = useCallback(async (templateId: string) => {
    try {
      const res = await fetch(`/api/assignments/templates/get?id=${templateId}`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { template: SavedTemplate };

      setFormatting(data.template.formatting_requirements as FormattingRequirements);

      // Unpack __draft from the stored assignmentInput JSONB
      const rawInput = data.template.assignment_input as AssignmentInput & {
        __draft?: AssignmentDraft;
      };
      const { __draft, ...cleanInput } = rawInput;
      setInput(cleanInput as AssignmentInput);
      if (__draft) {
        setDraft(__draft as AssignmentDraft);
      }

      setSuccess(`Loaded: ${data.template.template_name}`);
      setError(null);
    } catch (err) {
      setError(`Failed to load template: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Delete a template
  // ─────────────────────────────────────────────────────────────────────────

  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      if (!confirm("Delete this template?")) return;
      try {
        const res = await fetch(`/api/assignments/templates/delete?id=${templateId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        setSuccess("Template deleted");
        await loadTemplates();
      } catch (err) {
        setError(`Failed to delete template: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [loadTemplates]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Generate PDF
  // The endpoint (generate-pdf/route.ts) validates against AssignmentPdfRequestSchema:
  //   { title, subtitle, instructions, sections, formatting }
  // It returns a binary PDF, not JSON — create a blob URL to open it.
  // ─────────────────────────────────────────────────────────────────────────

  const handleGenerateActivity = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        title: draft.title,
        subtitle: draft.subtitle,
        instructions: draft.instructions,
        sections: draft.sections,
        formatting,
      };

      const res = await fetch(`/api/assignments/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const d = (await res.json()) as { error?: string };
          msg = d.error ?? msg;
        } catch { /* response body may not be JSON */ }
        throw new Error(msg);
      }

      // Response is a binary PDF — create a blob URL and open in a new tab
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      setSuccess("PDF opened in a new tab!");
    } catch (err) {
      setError(`Failed to generate PDF: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsGenerating(false);
    }
  }, [formatting, draft]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-6">

          {/* Refinement input */}
          <div className="rounded-lg border border-teal-700 bg-slate-900 p-4">
            <textarea
              className="w-full h-32 bg-slate-800 text-slate-100 border border-slate-700 rounded p-3 text-sm focus:outline-none focus:border-teal-500 resize-none"
              placeholder="Describe what to change or add... (Ctrl+Enter to refine)"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  // Refine hook — placeholder until AI refine endpoint is wired
                  setSuccess("Refine queued (coming soon)");
                }
              }}
            />
            <p className="text-xs text-slate-500 mt-1">Ctrl+Enter to send</p>
            <div className="mt-2 flex gap-2">
              <button
                disabled={isGenerating}
                className="flex-1 px-3 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 rounded font-medium text-sm"
              >
                ⚡ Refine Activity
              </button>
              <button
                onClick={handleGenerateActivity}
                disabled={isGenerating}
                className="flex-1 px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded font-medium text-sm"
              >
                {isGenerating ? "Generating…" : "↓ New"}
              </button>
            </div>
          </div>

          {/* PDF Sandbox config */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <h3 className="text-base font-bold mb-1">{gradeLevel} PDF Sandbox</h3>
            <p className="text-xs text-slate-400 mb-4">
              Configure below and use "Generate With AI", or use the AI Activity Generator above.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Document Type</label>
                <select
                  value={input.documentKind}
                  onChange={(e) =>
                    setInput({ ...input, documentKind: e.target.value as AssignmentInput["documentKind"] })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="activity-sheet">Activity Sheet</option>
                  <option value="practice-set">Practice Set</option>
                  <option value="investigation">Investigation Task</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Paper Type</label>
                <select
                  defaultValue="mixed"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="mixed">Mixed</option>
                  <option value="paper1">Paper 1 (No GDC)</option>
                  <option value="paper2">Paper 2 (GDC)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Cohort</label>
                <select
                  defaultValue="26AH"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="26AH">26AH (Year 12)</option>
                  <option value="27AH">27AH (Year 11)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Challenge Mix</label>
                <select
                  value={input.challengeMix}
                  onChange={(e) =>
                    setInput({ ...input, challengeMix: e.target.value as AssignmentInput["challengeMix"] })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="foundational">Foundational</option>
                  <option value="balanced">Balanced</option>
                  <option value="challenge-forward">Challenge Forward</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Topic</label>
                <input
                  type="text"
                  value={input.title}
                  onChange={(e) => setInput({ ...input, title: e.target.value })}
                  placeholder="e.g. Quadratics & Calculus"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Templates */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Templates</p>

            {/* Hide / Show list (always show list first) */}
            {templates.length === 0 ? (
              <p className="text-xs text-slate-400 mb-3">No templates saved yet.</p>
            ) : (
              <div className="space-y-2 mb-3 max-h-52 overflow-y-auto">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between bg-slate-800 rounded px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.template_name}</p>
                      <p className="text-xs text-slate-400">{t.grade_level}</p>
                    </div>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <button
                        onClick={() => handleLoadTemplate(t.id)}
                        className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 rounded"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Save as template */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Template name..."
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleSaveTemplate}
                disabled={isSaving || !templateName.trim()}
                className="px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded font-medium text-sm whitespace-nowrap"
              >
                {isSaving ? "Saving…" : "Save As Template"}
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Status banners */}
          {error && (
            <div className="p-4 bg-red-900 border border-red-700 rounded text-red-100 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="p-4 bg-green-900 border border-green-700 rounded text-green-100 text-sm flex items-center justify-between">
              <span>{success}</span>
              <button
                onClick={() => setSuccess(null)}
                className="text-green-300 hover:text-white ml-4 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {/* Download PDF button */}
          <div className="flex justify-end">
            <button
              onClick={handleGenerateActivity}
              disabled={isGenerating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded font-medium text-sm"
            >
              {isGenerating ? "Generating PDF…" : "⬇ Download PDF"}
            </button>
          </div>

          {/* Assignment preview */}
          <div className="rounded-lg border border-slate-700 bg-white text-slate-900 p-8">
            <h2 className="text-2xl font-bold mb-1 text-center">{draft.title}</h2>
            {draft.subtitle && (
              <p className="text-sm text-center text-slate-500 mb-6 italic">{draft.subtitle}</p>
            )}

            {draft.instructions && draft.instructions.length > 0 && (
              <div className="mb-6">
                <p className="font-bold text-sm mb-2">Instructions</p>
                <ol className="text-sm text-slate-700 space-y-1 list-decimal list-outside pl-5">
                  {draft.instructions.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              </div>
            )}

            <div className="space-y-6">
              {draft.sections.map((section, si) => (
                <div key={si}>
                  <h3 className="font-bold text-base border-b border-slate-200 pb-1 mb-3">
                    {section.heading}
                  </h3>
                  <div className="space-y-4">
                    {section.questions.map((q, qi) => (
                      <div key={qi} className="flex gap-3 text-sm">
                        <span className="text-slate-400 shrink-0 w-5">{qi + 1}.</span>
                        <div className="flex-1">
                          <p className="whitespace-pre-line">{q.prompt}</p>
                          {!!q.marks && (
                            <span className="inline-block mt-1 text-xs border border-slate-300 rounded px-1.5 py-0.5 text-slate-500">
                              {q.marks} mark{q.marks !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
