"use client";

import { useMemo, useState } from "react";

type DocumentKind = "activity-sheet" | "practice-set" | "investigation";

type FormattingRequirements = {
  schoolName: string;
  teacherName: string;
  includeNameLine: boolean;
  includeDateLine: boolean;
  includeMarksColumn: boolean;
  includeAnswerKey: boolean;
  fontSize: 10 | 11 | 12;
  lineSpacing: "compact" | "normal" | "relaxed";
  pageMarginsMm: 12 | 16 | 20;
  numberingStyle: "numeric" | "lettered";
};

type AssignmentInput = {
  gradeLevel: "Grade 9";
  documentKind: DocumentKind;
  title: string;
  topic: string;
  learningGoals: string;
  contextNotes: string;
  questionCount: number;
  challengeMix: "foundational" | "balanced" | "challenge-forward";
  includeRealWorldContext: boolean;
  tone: "clear" | "exam-style" | "discovery";
};

type AssignmentQuestion = {
  prompt: string;
  marks?: number;
  answer?: string;
};

type AssignmentSection = {
  heading: string;
  questions: AssignmentQuestion[];
};

type AssignmentDraft = {
  title: string;
  subtitle: string;
  instructions: string[];
  sections: AssignmentSection[];
};

type ClaudeTextBlock = {
  type: string;
  text?: string;
};

type ClaudeResponse = {
  content?: ClaudeTextBlock[];
};

const defaultFormatting: FormattingRequirements = {
  schoolName: "CleverPlatform Mathematics",
  teacherName: "",
  includeNameLine: true,
  includeDateLine: true,
  includeMarksColumn: true,
  includeAnswerKey: false,
  fontSize: 11,
  lineSpacing: "normal",
  pageMarginsMm: 16,
  numberingStyle: "numeric",
};

const defaultInput: AssignmentInput = {
  gradeLevel: "Grade 9",
  documentKind: "activity-sheet",
  title: "Linear Equations Activity",
  topic: "Solving linear equations and checking solutions",
  learningGoals:
    "Solve one-step and two-step linear equations, justify solution steps, and verify answers by substitution.",
  contextNotes: "Include at least two word problems and one error-analysis question.",
  questionCount: 10,
  challengeMix: "balanced",
  includeRealWorldContext: true,
  tone: "clear",
};

const defaultDraft: AssignmentDraft = {
  title: "Linear Equations Activity",
  subtitle: "Grade 9 Mathematics",
  instructions: [
    "Show all working and use clear mathematical notation.",
    "Check each solution by substitution where possible.",
    "Circle final answers clearly.",
  ],
  sections: [
    {
      heading: "A. Core Practice",
      questions: [
        { prompt: "Solve: 3x + 5 = 23", marks: 2, answer: "x = 6" },
        { prompt: "Solve: 5(2x - 1) = 35", marks: 3, answer: "x = 4" },
      ],
    },
    {
      heading: "B. Application",
      questions: [
        {
          prompt:
            "A concert ticket costs $12 plus a booking fee of $4. If Maya pays $64 in total, write and solve an equation to find how many tickets she bought.",
          marks: 4,
          answer: "12t + 4 = 64, so t = 5 tickets.",
        },
      ],
    },
  ],
};

export function Grade9PdfSandbox() {
  const [formatting, setFormatting] = useState<FormattingRequirements>(defaultFormatting);
  const [input, setInput] = useState<AssignmentInput>(defaultInput);
  const [draft, setDraft] = useState<AssignmentDraft>(defaultDraft);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineHeightClass = useMemo(() => {
    if (formatting.lineSpacing === "compact") return "leading-5";
    if (formatting.lineSpacing === "relaxed") return "leading-8";
    return "leading-7";
  }, [formatting.lineSpacing]);

  async function generateWithAi() {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildSystemPrompt(),
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

  function handlePrintPdf() {
    const printable = buildPrintableHtml(draft, formatting);
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) {
      setError("Could not open print window. Please allow popups for this site.");
      return;
    }

    popup.document.open();
    popup.document.write(printable);
    popup.document.close();
  }

  return (
    <section className="rounded-2xl border border-da-border bg-da-surface/80 p-6 shadow-lg shadow-black/30">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h2 className="text-lg font-semibold font-serif text-da-text">Grade 9 PDF Sandbox</h2>
            <p className="text-xs text-da-muted">
              Configure your formatting requirements, generate a draft with AI, edit in place, and
              export as a clean print-ready PDF.
            </p>
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
              onClick={handlePrintPdf}
              className="rounded-lg border border-da-border bg-da-hover px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-accent/60"
            >
              Export To PDF
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

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

function buildSystemPrompt(): string {
  return [
    "You are an expert Grade 9 mathematics assignment designer.",
    "Output only valid JSON.",
    "Return a single object with this exact shape:",
    "{",
    '  "title": string,',
    '  "subtitle": string,',
    '  "instructions": string[],',
    '  "sections": [',
    "    {",
    '      "heading": string,',
    '      "questions": [',
    "        {",
    '          "prompt": string,',
    '          "marks": number,',
    '          "answer": string',
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "Guidelines:",
    "- Keep language age-appropriate for Grade 9.",
    "- Questions must be mathematically correct and unambiguous.",
    "- Include a mix of procedural fluency and reasoning.",
    "- Ensure marks are sensible for each prompt.",
    "- Keep prompts plain text (no markdown).",
  ].join("\n");
}

function buildUserPrompt(input: AssignmentInput, formatting: FormattingRequirements): string {
  return [
    `Create a ${input.gradeLevel} ${input.documentKind}.`,
    `Title preference: ${input.title}.`,
    `Topic: ${input.topic}.`,
    `Learning goals: ${input.learningGoals}.`,
    `Special constraints: ${input.contextNotes || "None"}.`,
    `Question count target: ${input.questionCount}.`,
    `Challenge mix: ${input.challengeMix}.`,
    `Tone: ${input.tone}.`,
    `Real-world context required: ${input.includeRealWorldContext ? "yes" : "no"}.`,
    "Formatting requirements to respect:",
    `- Include marks column: ${formatting.includeMarksColumn ? "yes" : "no"}`,
    `- Include answer key: ${formatting.includeAnswerKey ? "yes" : "no"}`,
    `- Numbering style: ${formatting.numberingStyle}`,
    "Return only JSON, with no additional text.",
  ].join("\n");
}

function extractJsonObject(input: string): string {
  const first = input.indexOf("{");
  const last = input.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("AI response did not include a JSON object.");
  }
  return input.slice(first, last + 1);
}

function sanitizeDraft(draft: AssignmentDraft): AssignmentDraft {
  const sections = Array.isArray(draft.sections)
    ? draft.sections
        .filter((section) => section && typeof section.heading === "string")
        .map((section) => ({
          heading: section.heading.trim() || "Section",
          questions: Array.isArray(section.questions)
            ? section.questions
                .filter((question) => question && typeof question.prompt === "string")
                .map((question) => ({
                  prompt: question.prompt.trim(),
                  marks: clampInt(Number(question.marks ?? 0), 0, 20),
                  answer: typeof question.answer === "string" ? question.answer.trim() : "",
                }))
                .filter((question) => question.prompt.length > 0)
            : [],
        }))
        .filter((section) => section.questions.length > 0)
    : [];

  if (sections.length === 0) {
    throw new Error("AI response did not include any usable questions.");
  }

  const instructions = Array.isArray(draft.instructions)
    ? draft.instructions.filter((line) => typeof line === "string" && line.trim().length > 0)
    : [];

  return {
    title: (draft.title || "Untitled Assignment").trim(),
    subtitle: (draft.subtitle || "Grade 9 Mathematics").trim(),
    instructions: instructions.length > 0 ? instructions : ["Complete all questions and show working."],
    sections,
  };
}

function formatQuestionLabel(
  sectionIndex: number,
  questionIndex: number,
  numberingStyle: FormattingRequirements["numberingStyle"]
): string {
  if (numberingStyle === "lettered") {
    const code = "a".charCodeAt(0) + questionIndex;
    return `(${String.fromCharCode(code)})`;
  }
  return `${sectionIndex + 1}.${questionIndex + 1}`;
}

function buildPrintableHtml(draft: AssignmentDraft, formatting: FormattingRequirements): string {
  const instructionsHtml = draft.instructions
    .map((line, index) => `<li>${escapeHtml(`${index + 1}. ${line}`)}</li>`)
    .join("");

  const sectionsHtml = draft.sections
    .map((section, sectionIndex) => {
      const questionRows = section.questions
        .map((question, questionIndex) => {
          const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
          const marks = formatting.includeMarksColumn
            ? `<span class=\"marks\">[${question.marks ?? 0}]</span>`
            : "";
          return `<div class=\"q-row\"><span class=\"q-label\">${escapeHtml(label)}</span><span class=\"q-text\">${escapeHtml(
            question.prompt
          )}</span>${marks}</div>`;
        })
        .join("");

      return `<section><h3>${escapeHtml(section.heading)}</h3>${questionRows}</section>`;
    })
    .join("");

  const answersHtml = formatting.includeAnswerKey
    ? `<section class=\"answers\"><h3>Answer Key</h3>${draft.sections
        .map((section, sectionIndex) =>
          section.questions
            .map((question, questionIndex) => {
              const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
              return `<div class=\"answer-row\"><span class=\"q-label\">${escapeHtml(label)}</span><span>${escapeHtml(
                question.answer ?? ""
              )}</span></div>`;
            })
            .join("")
        )
        .join("")}</section>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>${escapeHtml(draft.title)}</title>
  <style>
    @page { size: A4; margin: ${formatting.pageMarginsMm}mm; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: ${formatting.fontSize}pt; line-height: ${
      formatting.lineSpacing === "compact" ? "1.3" : formatting.lineSpacing === "relaxed" ? "1.7" : "1.5"
    }; }
    h1, h2, h3 { margin: 0; }
    .doc-head { border-bottom: 1px solid #cfcfcf; padding-bottom: 8px; margin-bottom: 14px; }
    .school { text-align: center; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; }
    .title { text-align: center; margin-top: 6px; font-size: 18pt; }
    .subtitle { text-align: center; margin-top: 2px; font-size: 10pt; color: #444; }
    .meta { margin-top: 8px; font-size: 10pt; display: flex; gap: 20px; flex-wrap: wrap; }
    .meta-line { min-width: 220px; }
    ul { margin: 8px 0 12px 18px; padding: 0; }
    li { margin: 2px 0; }
    section { margin-top: 12px; break-inside: avoid; }
    .q-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; margin: 6px 0; align-items: start; }
    .q-label { font-weight: 600; }
    .q-text { white-space: pre-wrap; }
    .marks { font-size: 9pt; color: #555; }
    .answers { border-top: 1px solid #cfcfcf; margin-top: 18px; padding-top: 10px; }
    .answer-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 4px 0; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class=\"doc-head\">
    <div class=\"school\">${escapeHtml(formatting.schoolName)}</div>
    <h1 class=\"title\">${escapeHtml(draft.title)}</h1>
    <h2 class=\"subtitle\">${escapeHtml(draft.subtitle)}</h2>
    <div class=\"meta\">
      ${formatting.includeNameLine ? `<div class=\"meta-line\">Name: ____________________</div>` : ""}
      ${formatting.includeDateLine ? `<div class=\"meta-line\">Date: ____________________</div>` : ""}
      ${formatting.teacherName ? `<div class=\"meta-line\">Teacher: ${escapeHtml(formatting.teacherName)}</div>` : ""}
    </div>
  </div>

  <h3>Instructions</h3>
  <ul>${instructionsHtml}</ul>
  ${sectionsHtml}
  ${answersHtml}

  <script>
    window.addEventListener("load", () => {
      window.print();
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
