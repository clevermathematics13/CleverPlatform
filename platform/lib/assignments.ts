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
  ccss?: string[];
  // ── Nuanced Analysis fields (optional, backward-compatible) ──────────────
  /** 1 = ★ (entry, compulsory)  2 = ★★ (standard)  3 = ★★★ (extension) */
  tier?: 1 | 2 | 3;
  /** Italic hint shown below the question stem */
  hint?: string;
  /** Sub-parts (a), (b), (c) … */
  subparts?: Array<{ prompt: string; marks?: number; hint?: string; tier?: 1 | 2 | 3 }>;
};

// ── Nuanced Analysis section enrichments ─────────────────────────────────────

export type SpotlightBox = {
  title: string;
  body: string;
};

export type PrerequisiteBox = {
  items: string[];
};

export type TranslationTable = {
  caption: string;
  rows: Array<{ informal: string; formal: string }>;
};

export type GeometricReading = {
  body: string;
};

export type CommandTermEntry = {
  term: string;
  definition: string;
};

export type AssignmentSection = {
  heading: string;
  questions: AssignmentQuestion[];
  // ── Nuanced Analysis fields (optional, backward-compatible) ──────────────
  /** Teal micro-box: "What you need to start this Part" */
  prerequisiteBox?: PrerequisiteBox;
  /** Teal Command-Term Spotlight callout */
  spotlight?: SpotlightBox;
  /** Translation table (informal ↔ formal language) */
  translationTable?: TranslationTable;
  /** Grey "Geometric / Physical Reading" callout */
  geometricReading?: GeometricReading;
};

export type AssignmentDraft = {
  title: string;
  subtitle: string;
  instructions: string[];
  sections: AssignmentSection[];
  // ── Nuanced Analysis header fields (optional, backward-compatible) ────────
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  commandTerms?: CommandTermEntry[];
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

// ── Activity Generator (Nuanced Analysis format) ──────────────────────────────

export function buildActivityGeneratorSystemPrompt(gradeLevel: string): string {
  const isIB = gradeLevel === "Grade 12" || gradeLevel === "Grade 11";
  return [
    `You are an expert IBDP Mathematics teacher creating a Nuanced Analysis activity packet for ${gradeLevel}.`,
    "A Nuanced Analysis is a structured, multi-part guided investigation that:",
    "- Spans multiple IB syllabus topics woven into a single mathematical thread",
    "- Moves through conjecture → investigation → proof → application → reflection",
    "- Builds representational fluency: the same object seen as algebra, geometry, and real-world model",
    "- Uses IB command terms precisely throughout",
    "",
    "CRITICAL: Respond with ONLY a valid JSON object matching the schema below. No markdown, no backticks, no preamble.",
    "",
    "JSON Schema:",
    "{",
    "  \"title\": \"string — packet title (e.g. 'Polynomial Analysis')\",",
    "  \"subtitle\": \"string — e.g. 'Mastery Packet: IBDP Mathematics AA HL'\",",
    "  \"course\": \"string — e.g. 'IBDP Mathematics AA HL'\",",
    "  \"syllabusTopics\": \"string — e.g. 'Topic 2: Functions & Topic 5: Calculus'\",",
    "  \"prerequisites\": \"string — names of prior activities students need\",",
    "  \"materials\": \"string — GDC, software, whether Paper 1 (no calc) or mixed\",",
    "  \"instructions\": [\"string\", ...],",
    "  \"commandTerms\": [",
    "    { \"term\": \"Write down\", \"definition\": \"A short answer with no working required.\" },",
    "    { \"term\": \"Sketch\", \"definition\": \"Clear diagram with relative scale; label exact coordinates of intercepts, extrema, and special points.\" }",
    "  ],",
    "  \"sections\": [",
    "    {",
    "      \"heading\": \"Part 0 — Activating Prior Knowledge\",",
    "      \"prerequisiteBox\": { \"items\": [\"bullet 1\", \"bullet 2\"] },",
    "      \"spotlight\": { \"title\": \"Sketch vs. Draw\", \"body\": \"Draw requires millimeter precision on grid paper. Sketch does not require grid paper, but the axes MUST show relative scale.\" },",
    "      \"questions\": [",
    "        {",
    "          \"prompt\": \"Full question text. Bold command terms: **Write down** the...\",",
    "          \"marks\": 2,",
    "          \"tier\": 1,",
    "          \"hint\": \"Optional italic hint.\",",
    "          \"subparts\": [",
    "            { \"prompt\": \"(a) first sub-part\", \"marks\": 1 },",
    "            { \"prompt\": \"(b) second sub-part\", \"marks\": 1 }",
    "          ]",
    "        }",
    "      ],",
    "      \"translationTable\": {",
    "        \"caption\": \"The Translation Table: Polynomial Roots\",",
    "        \"rows\": [",
    "          { \"informal\": \"The graph bounces off the axis.\", \"formal\": \"The polynomial has a root with even multiplicity.\" }",
    "        ]",
    "      },",
    "      \"geometricReading\": { \"body\": \"Multiplying by a complex number is a rotation combined with a scaling.\" }",
    "    }",
    "  ]",
    "}",
    "",
    "DESIGN RULES:",
    "1. Always include Part 0 as Activating Prior Knowledge.",
    "2. tier: 1=★ (compulsory/entry), 2=★★ (standard), 3=★★★ (optional extension). All questions must have a tier.",
    "3. commandTerms: include only terms actually used in the packet.",
    "4. spotlight: add at the top of the part where a command-term distinction is most important.",
    "5. prerequisiteBox: 2-4 bullet items. Required for every part except Part 0.",
    "6. translationTable: include where informal→formal language translation adds value.",
    "7. geometricReading: include at end of parts where geometric/physical interpretation follows algebraic work.",
    "8. hints: use for proof scaffolding and complex multi-step questions.",
    "9. subparts: use (a),(b),(c) labelling for questions with distinct phases.",
    "10. instructions: 4-6 crisp sentences covering showing working and command terms.",
    "11. Marks: write-down=1-2, show that/prove=3-5, extended investigation=4-8.",
    "12. Use strict IB vocabulary: 'intersects' not 'crosses through'; 'even multiplicity' not 'bounces'.",
    "13. Never include answers in the student-facing questions. 'answer' field is teacher-only.",
    "14. The packet must have a coherent arc: last section connects back to opening ideas.",
    isIB
      ? "15. For IBDP: include at least one proof question (Show that/Prove), one Broken Math Critique error-analysis, and one GDC Mastery part."
      : `15. For ${gradeLevel}: include at least one real-world application and one error-analysis question.`,
    "16. Refinement: if conversation history shows a prior JSON draft, modify it per the new instruction. Return complete updated JSON.",
  ].join("\n");
}

export function buildActivityGeneratorUserPrompt(
  description: string,
  gradeLevel: string,
): string {
  return [
    `Grade level: ${gradeLevel}`,
    `Activity description: ${description}`,
    "Generate a complete Nuanced Analysis activity sheet. Return only JSON.",
  ].join("\n");
}

// ── Standard template system prompt ──────────────────────────────────────────

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
                  ...(Array.isArray(question.ccss) ? { ccss: (question.ccss as unknown[]).filter((s): s is string => typeof s === "string") } : {}),
                  ...(question.tier !== undefined ? { tier: question.tier } : {}),
                  ...(question.hint ? { hint: question.hint } : {}),
                  ...(Array.isArray(question.subparts) ? { subparts: question.subparts } : {}),
                }))
                .filter((question) => question.prompt.length > 0)
            : [],
          ...(section.prerequisiteBox ? { prerequisiteBox: section.prerequisiteBox } : {}),
          ...(section.spotlight ? { spotlight: section.spotlight } : {}),
          ...(section.translationTable ? { translationTable: section.translationTable } : {}),
          ...(section.geometricReading ? { geometricReading: section.geometricReading } : {}),
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
    ...(draft.course ? { course: draft.course } : {}),
    ...(draft.syllabusTopics ? { syllabusTopics: draft.syllabusTopics } : {}),
    ...(draft.prerequisites ? { prerequisites: draft.prerequisites } : {}),
    ...(draft.materials ? { materials: draft.materials } : {}),
    ...(Array.isArray(draft.commandTerms) ? { commandTerms: draft.commandTerms } : {}),
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
  const a = String.fromCharCode(38);
  return value
    .replace(/&/g, a + "amp;")
    .replace(/</g, a + "lt;")
    .replace(/>/g, a + "gt;")
    .replace(/"/g, a + "quot;")
    .replace(/'/g, a + "#39;");
}

export type AssignmentPdfRequest = {
  title: string;
  subtitle: string;
  instructions: string[];
  sections: Array<{
    heading: string;
    questions: Array<{
      prompt: string;
      marks?: number;
      answer?: string;
    }>;
  }>;
  formatting: FormattingRequirements;
};

export function generateAssignmentHtml(request: AssignmentPdfRequest): string {
  const { title, subtitle, instructions, sections, formatting } = request;

  const instructionsHtml = instructions
    .map((line, index) => `<li>${escapeHtml(`${index + 1}. ${line}`)}</li>`)
    .join("");

  const sectionsHtml = sections
    .map((section, sectionIndex) => {
      const questionRows = section.questions
        .map((question, questionIndex) => {
          const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
          const marks = formatting.includeMarksColumn
            ? `<span class="marks">[${question.marks ?? 0}]</span>`
            : "";
          return `<div class="q-row"><span class="q-label">${escapeHtml(label)}</span><span class="q-text">${escapeHtml(
            question.prompt
          )}</span>${marks}</div>`;
        })
        .join("");

      return `<section><h3>${escapeHtml(section.heading)}</h3>${questionRows}</section>`;
    })
    .join("");

  const answersHtml = formatting.includeAnswerKey
    ? `<section class="answers"><h3>Answer Key</h3>${sections
        .map((section, sectionIndex) =>
          section.questions
            .map((question, questionIndex) => {
              const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
              return `<div class="answer-row"><span class="q-label">${escapeHtml(label)}</span><span>${escapeHtml(
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
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: ${formatting.pageMarginsMm}mm; }
    * { margin: 0; padding: 0; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: ${formatting.fontSize}pt; line-height: ${
      formatting.lineSpacing === "compact" ? "1.3" : formatting.lineSpacing === "relaxed" ? "1.7" : "1.5"
    }; }
    h1, h2, h3 { margin: 0; margin-top: 0.5em; }
    h3 { margin-top: 1em; }
    .doc-head { border-bottom: 1px solid #cfcfcf; padding-bottom: 8px; margin-bottom: 14px; }
    .school { text-align: center; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; margin-bottom: 4px; }
    .title { text-align: center; margin-top: 6px; margin-bottom: 2px; font-size: 18pt; font-weight: bold; }
    .subtitle { text-align: center; margin-top: 2px; margin-bottom: 8px; font-size: 10pt; color: #444; }
    .meta { margin-bottom: 8px; font-size: 10pt; display: flex; gap: 20px; flex-wrap: wrap; }
    .meta-line { min-width: 200px; }
    ul { margin: 8px 0 12px 18px; padding: 0; }
    li { margin: 2px 0; }
    section { margin-top: 12px; page-break-inside: avoid; }
    .q-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; margin: 6px 0; align-items: start; }
    .q-label { font-weight: 600; min-width: 30px; }
    .q-text { white-space: pre-wrap; word-wrap: break-word; }
    .marks { font-size: 9pt; color: #555; text-align: right; }
    .answers { border-top: 1px solid #cfcfcf; margin-top: 18px; padding-top: 10px; }
    .answer-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="doc-head">
    <div class="school">${escapeHtml(formatting.schoolName)}</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <h2 class="subtitle">${escapeHtml(subtitle)}</h2>
    <div class="meta">
      ${formatting.includeNameLine ? `<div class="meta-line">Name: ____________________</div>` : ""}
      ${formatting.includeDateLine ? `<div class="meta-line">Date: ____________________</div>` : ""}
      ${formatting.teacherName ? `<div class="meta-line">Teacher: ${escapeHtml(formatting.teacherName)}</div>` : ""}
    </div>
  </div>

  <h3>Instructions</h3>
  <ul>${instructionsHtml}</ul>
  ${sectionsHtml}
  ${answersHtml}
</body>
</html>`;
}
