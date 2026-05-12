// Shared types and utilities for assignment sandboxes across all grade levels

export type DocumentKind = "activity-sheet" | "practice-set" | "investigation";

export type FormattingRequirements = {
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

export type AssignmentInput = {
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
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

export type AssignmentQuestion = {
  prompt: string;
  marks?: number;
  answer?: string;
};

export type AssignmentSection = {
  heading: string;
  questions: AssignmentQuestion[];
};

export type AssignmentDraft = {
  title: string;
  subtitle: string;
  instructions: string[];
  sections: AssignmentSection[];
};

export type ClaudeTextBlock = {
  type: string;
  text?: string;
};

export type ClaudeResponse = {
  content?: ClaudeTextBlock[];
};

export type SavedTemplate = {
  id: string;
  template_name: string;
  grade_level: string;
  document_kind: string;
  formatting_requirements: FormattingRequirements;
  assignment_input: AssignmentInput;
  created_at: string;
  updated_at: string;
};

export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

export function buildSystemPrompt(gradeLevel: string): string {
  return [
    `You are an expert ${gradeLevel} mathematics assignment designer.`,
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
    `- Keep language age-appropriate for ${gradeLevel}.`,
    "- Questions must be mathematically correct and unambiguous.",
    "- Include a mix of procedural fluency and reasoning.",
    "- Ensure marks are sensible for each prompt.",
    "- Keep prompts plain text (no markdown).",
  ].join("\n");
}

export function buildUserPrompt(input: AssignmentInput, formatting: FormattingRequirements): string {
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

export function extractJsonObject(input: string): string {
  const first = input.indexOf("{");
  const last = input.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("AI response did not include a JSON object.");
  }
  return input.slice(first, last + 1);
}

export function sanitizeDraft(draft: AssignmentDraft): AssignmentDraft {
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
    subtitle: (draft.subtitle || "Mathematics").trim(),
    instructions: instructions.length > 0 ? instructions : ["Complete all questions and show working."],
    sections,
  };
}

export function formatQuestionLabel(
  sectionIndex: number,
  questionIndex: number,
  numberingStyle: "numeric" | "lettered"
): string {
  if (numberingStyle === "lettered") {
    const code = "a".charCodeAt(0) + questionIndex;
    return `(${String.fromCharCode(code)})`;
  }
  return `${sectionIndex + 1}.${questionIndex + 1}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
