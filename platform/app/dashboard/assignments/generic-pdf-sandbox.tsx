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

  const lineHeightClass = useMemo(() => {
    if (formatting.lineSpacing === "compact") return "leading-5";
    if (formatting.lineSpacing === "relaxed") return "leading-8";
    return "leading-7";
  }, [formatting.lineSpacing]);

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
              onClick={() => {
                setShowTemplates(!showTemplates);
                if (!showTemplates) loadTemplates();
              }}
              className="w-full rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-2 text-sm font-medium text-da-text transition-colors hover:border-da-accent/60 hover:bg-da-hover"
            >
              {showTemplates ? "Hide Templates" : "Load From Template"}
            </button>

            {showTemplates && (
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-da-border bg-da-bg/30 p-3">
                {templates.length === 0 ? (
                  <p className="text-xs text-da-muted">No saved templates yet</p>
                ) : (
                  templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => loadTemplate(template)}
                      className="w-full rounded-lg border border-da-border/50 bg-da-bg/50 px-2 py-2 text-left text-xs text-da-text transition-colors hover:bg-da-hover"
                    >
                      <p className="font-medium">{template.template_name}</p>
                      <p className="text-da-muted/70">{template.document_kind}</p>
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="space-y-2">
              <input
                type="text"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Template name"
                className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text placeholder-da-muted focus:border-da-accent/60 focus:outline-none"
              />

              <button
                type="button"
                onClick={saveAsTemplate}
                disabled={isSavingTemplate || !templateName.trim()}
                className="w-full rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-2 text-sm font-medium text-da-text transition-colors hover:bg-da-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingTemplate ? "Saving..." : "Save As Template"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Assignment Input</h3>

            <LabeledInput
              label="Title"
              value={input.title}
              onChange={(value) => setInput((prev) => ({ ...prev, title: value }))}
            />

            <LabeledSelect
              label="Document Type"
              value={input.documentKind}
              onChange={(value) =>
                setInput((prev) => ({ ...prev, documentKind: value as DocumentKind }))
              }
              options={[
                { value: "activity-sheet", label: "Activity Sheet" },
                { value: "practice-set", label: "Practice Set" },
                { value: "investigation", label: "Investigation Task" },
              ]}
            />

            <LabeledTextArea
              label="Topic"
              value={input.topic}
              onChange={(value) => setInput((prev) => ({ ...prev, topic: value }))}
              rows={2}
            />

            <LabeledTextArea
              label="Learning Goals"
              value={input.learningGoals}
              onChange={(value) => setInput((prev) => ({ ...prev, learningGoals: value }))}
              rows={3}
            />

            <LabeledTextArea
              label="Special Constraints"
              value={input.contextNotes}
              onChange={(value) => setInput((prev) => ({ ...prev, contextNotes: value }))}
              rows={2}
            />

            <div className="grid grid-cols-2 gap-3">
              <LabeledInput
                label="Question Count"
                type="number"
                value={String(input.questionCount)}
                onChange={(value) =>
                  setInput((prev) => ({
                    ...prev,
                    questionCount: clampInt(Number(value), 4, 24),
                  }))
                }
              />

              <LabeledSelect
                label="Challenge Mix"
                value={input.challengeMix}
                onChange={(value) =>
                  setInput((prev) => ({
                    ...prev,
                    challengeMix: value as AssignmentInput["challengeMix"],
                  }))
                }
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
                onChange={(value) =>
                  setInput((prev) => ({ ...prev, tone: value as AssignmentInput["tone"] }))
                }
                options={[
                  { value: "clear", label: "Clear" },
                  { value: "exam-style", label: "Exam Style" },
                  { value: "discovery", label: "Discovery" },
                ]}
              />

              <ToggleField
                label="Real-world context"
                checked={input.includeRealWorldContext}
                onChange={(checked) =>
                  setInput((prev) => ({ ...prev, includeRealWorldContext: checked }))
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Formatting Requirements</h3>

            <LabeledInput
              label="School Header"
              value={formatting.schoolName}
              onChange={(value) => setFormatting((prev) => ({ ...prev, schoolName: value }))}
            />

            <LabeledInput
              label="Teacher"
              value={formatting.teacherName}
              onChange={(value) => setFormatting((prev) => ({ ...prev, teacherName: value }))}
            />

            <div className="grid grid-cols-2 gap-3">
              <LabeledSelect
                label="Font Size"
                value={String(formatting.fontSize)}
                onChange={(value) =>
                  setFormatting((prev) => ({ ...prev, fontSize: Number(value) as 10 | 11 | 12 }))
                }
                options={[
                  { value: "10", label: "10 pt" },
                  { value: "11", label: "11 pt" },
                  { value: "12", label: "12 pt" },
                ]}
              />

              <LabeledSelect
                label="Line Spacing"
                value={formatting.lineSpacing}
                onChange={(value) =>
                  setFormatting((prev) => ({
                    ...prev,
                    lineSpacing: value as FormattingRequirements["lineSpacing"],
                  }))
                }
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
                onChange={(value) =>
                  setFormatting((prev) => ({ ...prev, pageMarginsMm: Number(value) as 12 | 16 | 20 }))
                }
                options={[
                  { value: "12", label: "Narrow (12 mm)" },
                  { value: "16", label: "Standard (16 mm)" },
                  { value: "20", label: "Wide (20 mm)" },
                ]}
              />

              <LabeledSelect
                label="Question Numbering"
                value={formatting.numberingStyle}
                onChange={(value) =>
                  setFormatting((prev) => ({
                    ...prev,
                    numberingStyle: value as FormattingRequirements["numberingStyle"],
                  }))
                }
                options={[
                  { value: "numeric", label: "1, 2, 3" },
                  { value: "lettered", label: "a, b, c" },
                ]}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ToggleField
                label="Student name line"
                checked={formatting.includeNameLine}
                onChange={(checked) =>
                  setFormatting((prev) => ({ ...prev, includeNameLine: checked }))
                }
              />
              <ToggleField
                label="Date line"
                checked={formatting.includeDateLine}
                onChange={(checked) =>
                  setFormatting((prev) => ({ ...prev, includeDateLine: checked }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ToggleField
                label="Marks column"
                checked={formatting.includeMarksColumn}
                onChange={(checked) =>
                  setFormatting((prev) => ({ ...prev, includeMarksColumn: checked }))
                }
              />
              <ToggleField
                label="Include answer key"
                checked={formatting.includeAnswerKey}
                onChange={(checked) =>
                  setFormatting((prev) => ({ ...prev, includeAnswerKey: checked }))
                }
              />
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

        <div className="rounded-xl border border-da-border bg-da-bg/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Live PDF Preview</h3>
            <span className="text-xs text-da-muted">Editable before export</span>
          </div>

          <div className="overflow-auto rounded-lg border border-da-border bg-white p-6 text-black" style={{ minHeight: 860 }}>
            <div className="space-y-5" style={{ fontSize: `${formatting.fontSize}pt` }}>
              <header className="border-b border-gray-300 pb-3">
                <p className="text-center text-sm font-semibold tracking-wide uppercase">{formatting.schoolName}</p>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  className="mt-2 w-full border-0 p-0 text-center text-2xl font-bold text-gray-900 focus:outline-none"
                />
                <input
                  type="text"
                  value={draft.subtitle}
                  onChange={(event) => setDraft((prev) => ({ ...prev, subtitle: event.target.value }))}
                  className="mt-1 w-full border-0 p-0 text-center text-sm text-gray-600 focus:outline-none"
                />

                <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                  {formatting.includeNameLine && <p>Name: _________________________</p>}
                  {formatting.includeDateLine && <p>Date: _________________________</p>}
                  {formatting.teacherName && <p className="col-span-2">Teacher: {formatting.teacherName}</p>}
                </div>
              </header>

              <section className={lineHeightClass}>
                <p className="mb-2 font-semibold">Instructions</p>
                {draft.instructions.map((instruction, index) => (
                  <div key={`instruction-${index}`} className="mb-1 flex items-start gap-2">
                    <span className="mt-1 text-xs text-gray-500">{index + 1}.</span>
                    <input
                      type="text"
                      value={instruction}
                      onChange={(event) =>
                        setDraft((prev) => {
                          const instructions = [...prev.instructions];
                          instructions[index] = event.target.value;
                          return { ...prev, instructions };
                        })
                      }
                      className="w-full border-0 p-0 text-gray-900 focus:outline-none"
                    />
                  </div>
                ))}
              </section>

              {draft.sections.map((section, sectionIndex) => (
                <section key={`section-${sectionIndex}`} className={lineHeightClass}>
                  <input
                    type="text"
                    value={section.heading}
                    onChange={(event) =>
                      setDraft((prev) => {
                        const sections = [...prev.sections];
                        sections[sectionIndex] = { ...sections[sectionIndex], heading: event.target.value };
                        return { ...prev, sections };
                      })
                    }
                    className="w-full border-0 p-0 text-base font-semibold text-gray-900 focus:outline-none"
                  />

                  <div className="mt-2 space-y-2">
                    {section.questions.map((question, questionIndex) => {
                      const label = formatQuestionLabel(
                        sectionIndex,
                        questionIndex,
                        formatting.numberingStyle
                      );

                      return (
                        <div key={`q-${sectionIndex}-${questionIndex}`} className="grid grid-cols-[auto_1fr_auto] gap-2 items-start">
                          <span className="font-medium text-gray-800">{label}</span>
                          <div className="min-w-0">
                            <textarea
                              value={question.prompt}
                              rows={2}
                              onChange={(event) =>
                                setDraft((prev) => {
                                  const sections = [...prev.sections];
                                  const questions = [...sections[sectionIndex].questions];
                                  questions[questionIndex] = {
                                    ...questions[questionIndex],
                                    prompt: event.target.value,
                                  };
                                  sections[sectionIndex] = { ...sections[sectionIndex], questions };
                                  return { ...prev, sections };
                                })
                              }
                              className="w-full resize-y border-0 p-0 text-gray-900 focus:outline-none"
                            />
                            {question.ccss && question.ccss.length > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {question.ccss.map((code) => (
                                  <span
                                    key={code}
                                    title={code}
                                    className="rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[8px] font-mono text-blue-500"
                                  >
                                    {code.replace("CCSS.MATH.CONTENT.", "")}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {formatting.includeMarksColumn && (
                            <input
                              type="number"
                              value={question.marks ?? 0}
                              onChange={(event) =>
                                setDraft((prev) => {
                                  const sections = [...prev.sections];
                                  const questions = [...sections[sectionIndex].questions];
                                  questions[questionIndex] = {
                                    ...questions[questionIndex],
                                    marks: clampInt(Number(event.target.value), 0, 20),
                                  };
                                  sections[sectionIndex] = { ...sections[sectionIndex], questions };
                                  return { ...prev, sections };
                                })
                              }
                              className="w-16 rounded border border-gray-300 px-1 py-0.5 text-right text-xs text-gray-800"
                              aria-label={`Marks for question ${label}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}

              {formatting.includeAnswerKey && (
                <section>
                  <p className="mb-2 border-t border-gray-300 pt-3 text-base font-semibold text-gray-900">
                    Answer Key
                  </p>
                  <div className="space-y-2 text-sm text-gray-800">
                    {draft.sections.flatMap((section, sectionIndex) =>
                      section.questions.map((question, questionIndex) => {
                        const label = formatQuestionLabel(
                          sectionIndex,
                          questionIndex,
                          formatting.numberingStyle
                        );
                        return (
                          <div key={`answer-${sectionIndex}-${questionIndex}`} className="grid grid-cols-[auto_1fr] gap-2">
                            <span className="font-medium">{label}</span>
                            <input
                              type="text"
                              value={question.answer ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => {
                                  const sections = [...prev.sections];
                                  const questions = [...sections[sectionIndex].questions];
                                  questions[questionIndex] = {
                                    ...questions[questionIndex],
                                    answer: event.target.value,
                                  };
                                  sections[sectionIndex] = { ...sections[sectionIndex], questions };
                                  return { ...prev, sections };
                                })
                              }
                              className="w-full border-0 p-0 text-gray-800 focus:outline-none"
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
      />
    </label>
  );
}

function LabeledTextArea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-da-border bg-da-bg/30 px-2.5 py-2 text-sm">
      <span className="text-da-text/90">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-amber-500"
      />
    </label>
  );
}
