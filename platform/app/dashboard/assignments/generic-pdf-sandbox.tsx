"use client";

import { useEffect, useState, useCallback } from "react";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft, SavedTemplate } from "@/lib/assignments";

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
  const [showRefineUI, setShowRefineUI] = useState(false);

  // ──────────────────────────────────────────────────────────────────────────────
  // Load templates on mount
  // ──────────────────────────────────────────────────────────────────────────────

  const loadTemplates = useCallback(async () => {
    try {
      // Fetch templates from ALL grades (not filtered by current gradeLevel)
      const res = await fetch(`/api/assignments/templates/list?grade=all`);
      if (!res.ok) throw new Error(`API error: ${res.statusText}`);
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

  // ──────────────────────────────────────────────────────────────────────────────
  // Save as template
  // ──────────────────────────────────────────────────────────────────────────────

  const handleSaveTemplate = useCallback(async () => {
    if (!templateName.trim()) {
      setError("Template name is required");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/assignments/templates/list`, {
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
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error || `API error: ${res.statusText}`);
      }

      setSuccess("Template saved successfully!");
      setTemplateName("");
      setIsSaving(false);

      // Reload templates
      await loadTemplates();
    } catch (err) {
      setError(`Failed to save template: ${err instanceof Error ? err.message : "Unknown error"}`);
      setIsSaving(false);
    }
  }, [templateName, formatting, input, gradeLevel, loadTemplates]);

  // ──────────────────────────────────────────────────────────────────────────────
  // Load a saved template
  // ──────────────────────────────────────────────────────────────────────────────

  const handleLoadTemplate = useCallback(async (templateId: string) => {
    try {
      const res = await fetch(`/api/assignments/templates/list?id=${templateId}`);
      if (!res.ok) throw new Error(`API error: ${res.statusText}`);
      const data = (await res.json()) as { template: SavedTemplate };

      setFormatting(data.template.formatting_requirements);
      setInput(data.template.assignment_input);
      setSuccess(`Loaded template: ${data.template.template_name}`);
      setError(null);
    } catch (err) {
      setError(`Failed to load template: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  // ──────────────────────────────────────────────────────────────────────────────
  // Generate activity (calls Claude API via /api/assignments/generate-pdf)
  // ──────────────────────────────────────────────────────────────────────────────

  const handleGenerateActivity = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/assignments/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formatting,
          input,
          draft,
        }),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error || `API error: ${res.statusText}`);
      }

      const data = (await res.json()) as { pdfUrl?: string };
      if (data.pdfUrl) {
        window.open(data.pdfUrl, "_blank");
        setSuccess("PDF generated and opened in a new tab!");
      } else {
        setError("PDF URL not returned from server");
      }
    } catch (err) {
      setError(`Failed to generate activity: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsGenerating(false);
    }
  }, [formatting, input, draft]);

  // ──────────────────────────────────────────────────────────────────────────────
  // Delete a template
  // ──────────────────────────────────────────────────────────────────────────────

  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      if (!confirm("Delete this template?")) return;

      try {
        const res = await fetch(`/api/assignments/templates/list?id=${templateId}`, {
          method: "DELETE",
        });

        if (!res.ok) throw new Error(`API error: ${res.statusText}`);
        setSuccess("Template deleted");
        await loadTemplates();
      } catch (err) {
        setError(`Failed to delete template: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [loadTemplates]
  );

  // ──────────────────────────────────────────────────────────────────────────────
  // Refine activity with AI (placeholder for future enhancement)
  // ──────────────────────────────────────────────────────────────────────────────

  const handleRefineActivity = useCallback(() => {
    setShowRefineUI(!showRefineUI);
  }, [showRefineUI]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {/* LEFT PANEL: CONTROLS AND TEMPLATES */}
        {/* ──────────────────────────────────────────────────────────────────────────── */}

        <div className="lg:col-span-1 space-y-6">
          {/* Refinement Input */}
          <div className="rounded-lg border border-teal-700 bg-slate-900 p-4">
            <textarea
              className="w-full h-32 bg-slate-800 text-slate-100 border border-slate-700 rounded p-3 text-sm focus:outline-none focus:border-teal-500"
              placeholder="Describe what to change or add... (Ctrl+Enter to refine)"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  handleRefineActivity();
                }
              }}
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleRefineActivity}
                disabled={isGenerating}
                className="flex-1 px-3 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 rounded font-medium text-sm"
              >
                ⚡ Refine Activity
              </button>
              <button
                onClick={handleGenerateActivity}
                disabled={isGenerating}
                className="flex-1 px-3 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded font-medium text-sm"
              >
                {isGenerating ? "Generating..." : "↓ Generate"}
              </button>
            </div>
            <button
              onClick={() => setShowRefineUI(false)}
              className="mt-2 text-xs text-slate-400 hover:text-slate-300"
            >
              ✓ Saved
            </button>
          </div>

          {/* PDF Sandbox (Grade-Level Specific) */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <h3 className="text-base font-bold mb-3">{gradeLevel} PDF Sandbox</h3>
            <p className="text-xs text-slate-400 mb-4">
              Configure below and use "Generate With AI", or use the AI Activity Generator above.
            </p>
            {/* Document Type & Paper Type Selectors */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Document Type</label>
                <select
                  value={input.documentKind}
                  onChange={(e) => setInput({ ...input, documentKind: e.target.value as any })}
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
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  defaultValue="mixed"
                >
                  <option value="mixed">Mixed</option>
                  <option value="paper1">Paper 1 (No GDC)</option>
                  <option value="paper2">Paper 2 (GDC)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Templates Section */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <h3 className="text-base font-bold mb-3">Templates</h3>

            {/* Save Template */}
            <div className="mb-4 pb-4 border-b border-slate-700">
              <input
                type="text"
                placeholder="Template name..."
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleSaveTemplate}
                disabled={isSaving || !templateName.trim()}
                className="w-full px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded font-medium text-sm"
              >
                {isSaving ? "Saving..." : "Save As Template"}
              </button>
            </div>

            {/* List Templates */}
            <div>
              {templates.length === 0 ? (
                <p className="text-xs text-slate-400">No templates saved yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between bg-slate-800 rounded p-2 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{template.template_name}</p>
                        <p className="text-slate-400 text-xs">{template.grade_level}</p>
                      </div>
                      <div className="flex gap-1 ml-2">
                        <button
                          onClick={() => handleLoadTemplate(template.id)}
                          className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(template.id)}
                          className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Assignments Input Fields */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <h3 className="text-base font-bold mb-3">Assignment Input</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Title</label>
                <input
                  type="text"
                  value={input.title}
                  onChange={(e) => setInput({ ...input, title: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Cohort</label>
                <select
                  value={gradeLevel}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  disabled
                >
                  <option>{gradeLevel}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Challenge Mix</label>
                <select
                  value={input.challengeMix}
                  onChange={(e) => setInput({ ...input, challengeMix: e.target.value as any })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="foundational">Foundational</option>
                  <option value="balanced">Balanced</option>
                  <option value="challenge-forward">Challenge Forward</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Question Count</label>
                <input
                  type="number"
                  value={input.questionCount}
                  onChange={(e) => setInput({ ...input, questionCount: parseInt(e.target.value) || 1 })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  min="1"
                  max="50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {/* RIGHT PANEL: PREVIEW & FEEDBACK */}
        {/* ──────────────────────────────────────────────────────────────────────────── */}

        <div className="lg:col-span-2">
          {/* Error / Success Messages */}
          {error && (
            <div className="mb-4 p-4 bg-red-900 border border-red-700 rounded text-red-100 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-4 bg-green-900 border border-green-700 rounded text-green-100 text-sm">
              {success}
            </div>
          )}

          {/* Activity Preview */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-2xl font-bold mb-2">{draft.title}</h2>
            <p className="text-slate-400 text-sm mb-6">{draft.subtitle}</p>

            {/* Instructions */}
            {draft.instructions && draft.instructions.length > 0 && (
              <div className="mb-6">
                <h3 className="font-bold text-sm mb-2">Instructions</h3>
                <ol className="text-sm text-slate-300 space-y-1 list-decimal list-inside">
                  {draft.instructions.map((instruction, idx) => (
                    <li key={idx}>{instruction}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Sections Preview */}
            <div className="space-y-6">
              {draft.sections.map((section, idx) => (
                <div key={idx} className="border-t border-slate-700 pt-4">
                  <h3 className="font-bold text-base mb-3">{section.heading}</h3>
                  <div className="space-y-3">
                    {section.questions.slice(0, 2).map((q, qidx) => (
                      <div key={qidx} className="text-sm text-slate-300">
                        <p className="mb-1">{q.prompt}</p>
                        {q.marks && <p className="text-xs text-slate-500">[{q.marks} marks]</p>}
                      </div>
                    ))}
                    {section.questions.length > 2 && (
                      <p className="text-xs text-slate-500">
                        +{section.questions.length - 2} more question{section.questions.length - 2 !== 1 ? "s" : ""}
                      </p>
                    )}
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
