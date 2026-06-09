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
  /** Number of ruled writing lines per answer box (default 4) */
  answerBoxLines?: number;
  /** Answer space style: bordered boxes, bare lines, or no space (default: "boxes") */
  answerStyle?: "boxes" | "lines" | "none";
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
  /** 1 = ★ (entry, compulsory)  2 = ★★ (standard)  3 = ★★★ (extension) */
  tier?: 1 | 2 | 3;
  /** Italic hint shown below the question stem */
  hint?: string;
  /** Sub-parts (a), (b), (c) … */
  subparts?: Array<{ prompt: string; marks?: number; hint?: string; tier?: 1 | 2 | 3 }>;
  /** Per-question answer box line count override (falls back to global answerBoxLines) */
  answerBoxLines?: number;
};

// ── Nuanced Analysis section enrichments ─────────────────────────────────────

export type SpotlightBox = { title: string; body: string };
export type PrerequisiteBox = { items: string[] };
export type TranslationTable = { caption: string; rows: Array<{ informal: string; formal: string }> };
export type GeometricReading = { body: string };
export type CommandTermEntry = { term: string; definition: string };
export type TokProvocation = { id: string; body: string };
export type InternationalMindednessBox = { body: string };

export type AssignmentSection = {
  heading: string;
  questions: AssignmentQuestion[];
  prerequisiteBox?: PrerequisiteBox;
  spotlight?: SpotlightBox;
  translationTable?: TranslationTable;
  geometricReading?: GeometricReading;
};

export type AssignmentDraft = {
  title: string;
  subtitle: string;
  instructions: string[];
  sections: AssignmentSection[];
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  commandTerms?: CommandTermEntry[];
  // ── Nuanced Analysis extras ──────────────────────────────────────────────
  /**
   * ATL (Approaches to Learning) statement — one sentence naming the skill
   * being built across the whole packet. Required by DESIGN_INSTRUCTIONS §2.4.
   * Example: "You will build representational fluency: the ability to move
   * between algebraic, geometric, and analytic representations of one object."
   */
  atl?: string;
  tokProvocations?: TokProvocation[];
  internationalMindedness?: InternationalMindednessBox;
  compulsoryCore?: string;
  plantedErrorIntro?: string;
  reflectionQuestions?: string[];
};

export type ClaudeTextBlock = { type: string; text?: string };
export type ClaudeResponse = { content?: ClaudeTextBlock[] };

export type SavedTemplate = {
  id: string;
  template_name: string;
  grade_level: string;
  document_kind: string;
  formatting_requirements: FormattingRequirements;
  assignment_input: AssignmentInput;
  draft_content?: AssignmentDraft | null;
  created_at: string;
  updated_at: string;
};

export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

// ── Tier distribution ─────────────────────────────────────────────────────────

export type TierDistribution = { t1: number; t2: number; t3: number; untiered: number };

export function computeTierDistribution(draft: AssignmentDraft): TierDistribution {
  const dist: TierDistribution = { t1: 0, t2: 0, t3: 0, untiered: 0 };
  for (const section of draft.sections) {
    for (const q of section.questions) {
      if (q.tier === 1) dist.t1++;
      else if (q.tier === 2) dist.t2++;
      else if (q.tier === 3) dist.t3++;
      else dist.untiered++;
    }
  }
  return dist;
}

// ── Duplicate detection ───────────────────────────────────────────────────────

/** Returns pairs of (sectionIdx, questionIdx) for near-duplicate question stems. */
export type DuplicatePair = {
  a: { sectionIdx: number; questionIdx: number; prompt: string };
  b: { sectionIdx: number; questionIdx: number; prompt: string };
  similarity: number;
};

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export function detectDuplicateQuestions(
  draft: AssignmentDraft,
  threshold = 0.55
): DuplicatePair[] {
  const items: { sectionIdx: number; questionIdx: number; prompt: string; tokens: string[] }[] = [];
  draft.sections.forEach((section, si) => {
    section.questions.forEach((q, qi) => {
      items.push({ sectionIdx: si, questionIdx: qi, prompt: q.prompt, tokens: normalise(q.prompt) });
    });
  });

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sim = jaccardSimilarity(items[i].tokens, items[j].tokens);
      if (sim >= threshold) {
        pairs.push({
          a: { sectionIdx: items[i].sectionIdx, questionIdx: items[i].questionIdx, prompt: items[i].prompt },
          b: { sectionIdx: items[j].sectionIdx, questionIdx: items[j].questionIdx, prompt: items[j].prompt },
          similarity: Math.round(sim * 100),
        });
      }
    }
  }
  return pairs;
}

// ── Activity Generator (Nuanced Analysis format) ──────────────────────────────

export function buildActivityGeneratorSystemPrompt(gradeLevel: string): string {
  const isIB = gradeLevel === "Grade 12" || gradeLevel === "Grade 11";
  return [
    `You are an expert IBDP Mathematics teacher creating a Nuanced Analysis activity packet for ${gradeLevel}.`,
    "A Nuanced Analysis is a structured, multi-part guided investigation that:",
    "- Spans multiple IB syllabus topics woven into a single mathematical thread",
    "- Moves through conjecture → investigation → proof → application → reflection",
    "- Builds representational fluency: the same object seen as algebra, geometry, series, diagram, and real-world model",
    "- Uses IB command terms precisely throughout",
    "",
    "CRITICAL: Respond with ONLY a valid JSON object matching the schema below. No markdown, no backticks, no preamble.",
    "",
    "JSON Schema:",
    "{",
    '  "title": "string — packet title",',
    '  "subtitle": "string — e.g. \\"Mastery Packet: IBDP Mathematics AA HL\\"",',
    '  "course": "string — e.g. \\"IBDP Mathematics AA HL\\"",',
    '  "syllabusTopics": "string — e.g. \\"Topic 2: Functions & Topic 5: Calculus\\"",',
    '  "prerequisites": "string — names of prior activities students need",',
    '  "materials": "string — GDC model, software, whether Paper 1 (no calculator) or mixed",',
    '  "atl": "string — one sentence naming the ATL skill built across the whole packet, e.g. \\"You will build representational fluency: the same object seen as algebra, geometry, and real-world model.\\"",',
    '  "compulsoryCore": "string — brief sentence listing compulsory parts/tiers for accommodations",',
    '  "plantedErrorIntro": "string — one-sentence positive framing for the Broken Math Critique task",',
    '  "instructions": ["string", ...],',
    '  "commandTerms": [',
    '    { "term": "Write down", "definition": "A short answer with no working required." }',
    '  ],',
    '  "tokProvocations": [',
    '    { "id": "tok1", "body": "Full provocation as a question or claim. Must be answerable using a specific result in this packet." },',
    '    { "id": "tok2", "body": "Second provocation. Different philosophical angle. Also anchored to packet evidence." }',
    '  ],',
    '  "internationalMindedness": { "body": "2–3 sentence box naming non-European mathematicians who contributed to this mathematics." },',
    '  "reflectionQuestions": [',
    '    "Reflection Q1: concept-map list question using command term List or Describe.",',
    '    "Reflection Q2: epistemological question about the value of two proofs or representations.",',
    '    "Reflection Q3: TOK position statement using the frame: I argue that [claim]. My evidence is [specific result]."',
    '  ],',
    '  "sections": [',
    '    {',
    '      "heading": "Part 0 — Activating Prior Knowledge",',
    '      "prerequisiteBox": { "items": ["bullet 1", "bullet 2"] },',
    '      "spotlight": { "title": "Show that vs. Prove", "body": "Distinction text here." },',
    '      "questions": [',
    '        {',
    '          "prompt": "Full question text with **bold** command terms.",',
    '          "marks": 2,',
    '          "tier": 1,',
    '          "hint": "Optional italic hint.",',
    '          "answer": "Teacher-only answer sketch.",',
    '          "subparts": [',
    '            { "prompt": "(a) sub-part", "marks": 1, "tier": 1 },',
    '            { "prompt": "(b) sub-part", "marks": 1, "tier": 2 }',
    '          ]',
    '        }',
    '      ],',
    '      "translationTable": {',
    '        "caption": "The Translation Table",',
    '        "rows": [',
    '          { "informal": "informal phrase", "formal": "formal IB phrasing" }',
    '        ]',
    '      },',
    '      "geometricReading": { "body": "Geometric or physical interpretation of the algebra just done." }',
    '    }',
    '  ]',
    '}',
    "",
    "DESIGN RULES — all are non-negotiable:",
    "1. Part 0 is always Activating Prior Knowledge.",
    "2. tier: 1=★ (compulsory/entry), 2=★★ (standard), 3=★★★ (optional extension). EVERY question and every subpart must have a tier.",
    "3. commandTerms: include exactly the terms used in the packet — no extras, no omissions.",
    "4. spotlight: add to the Part where the most important command-term distinction arises.",
    "5. prerequisiteBox: 2–4 bullets. Required on Parts 1 onwards. Optional on Part 0.",
    "6. translationTable: include in at least one Part where informal→formal language translation adds value.",
    "7. geometricReading: include at the end of every Part containing algebraic derivation.",
    "8. hints: required for all proof questions and any multi-step question with ≥4 marks.",
    "9. subparts: label (a), (b), (c) for questions with distinct phases.",
    "10. instructions: 4–6 sentences. Cover: show working, command terms strip, oral alternatives, compulsory core.",
    "11. Marks: write-down/state = 1–2; describe/explain = 2–3; show that/prove = 3–5; extended = 4–8.",
    "12. IB vocabulary: 'intersects', 'even multiplicity', 'strictly increasing' — never informal paraphrases.",
    "13. tokProvocations: exactly 2. Each must cite a specific result from within this packet.",
    "14. internationalMindedness: name ≥ 2 non-European mathematicians connected to this mathematics.",
    "15. reflectionQuestions: exactly 3 — concept-map, epistemological, TOK-frame.",
    "16. atl: one sentence, names the ATL skill category (e.g. Transfer Skills, Critical Thinking).",
    "17. plantedErrorIntro: open positively — the framing sentence for the Broken Math Critique.",
    "18. Refinement: if conversation history shows a prior JSON draft, modify it per the new instruction. Return the complete updated JSON.",
    isIB
      ? "19. IBDP requirement: include at least one Prove question, one Broken Math Critique section, and one GDC/Technology task. The final two sections must be Reflection and Extension & IA-Seeding."
      : `19. ${gradeLevel} requirement: include at least one real-world application question and one error-analysis question.`,
    "20. Packet arc: the final student-facing question before Reflection must explicitly connect back to the opening idea in Part 0.",
  ].join("\n");
}

export function buildActivityGeneratorUserPrompt(description: string, gradeLevel: string): string {
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
  if (first < 0 || last <= first) throw new Error("AI response did not include a JSON object.");
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
                  ...(question.answerBoxLines !== undefined ? { answerBoxLines: question.answerBoxLines } : {}),
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

  if (sections.length === 0) throw new Error("AI response did not include any usable questions.");

  const instructions = Array.isArray(draft.instructions)
    ? draft.instructions.filter((line) => typeof line === "string" && line.trim().length > 0)
    : [];

  return {
    title: (draft.title || "Untitled Assignment").trim(),
    subtitle: (draft.subtitle || "Mathematics").trim(),
    instructions: instructions.length > 0 ? instructions : ["Complete all questions and show working."],
    sections,
    // Header metadata
    ...(draft.course ? { course: draft.course } : {}),
    ...(draft.syllabusTopics ? { syllabusTopics: draft.syllabusTopics } : {}),
    ...(draft.prerequisites ? { prerequisites: draft.prerequisites } : {}),
    ...(draft.materials ? { materials: draft.materials } : {}),
    // Nuanced Analysis extras
    ...(draft.atl ? { atl: draft.atl } : {}),
    ...(Array.isArray(draft.commandTerms) && draft.commandTerms.length > 0
      ? { commandTerms: draft.commandTerms }
      : {}),
    ...(Array.isArray(draft.tokProvocations) && draft.tokProvocations.length > 0
      ? { tokProvocations: draft.tokProvocations }
      : {}),
    ...(draft.internationalMindedness
      ? { internationalMindedness: draft.internationalMindedness }
      : {}),
    ...(draft.compulsoryCore ? { compulsoryCore: draft.compulsoryCore } : {}),
    ...(draft.plantedErrorIntro ? { plantedErrorIntro: draft.plantedErrorIntro } : {}),
    ...(Array.isArray(draft.reflectionQuestions) && draft.reflectionQuestions.length > 0
      ? { reflectionQuestions: draft.reflectionQuestions }
      : {}),
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
    questions: Array<{ prompt: string; marks?: number; answer?: string; answerBoxLines?: number }>;
  }>;
  formatting: FormattingRequirements;
};

export function generateAssignmentHtml(request: AssignmentPdfRequest): string {
  const { title, subtitle, instructions, sections, formatting } = request;
  const instructionsHtml = instructions.map((line, index) => `<li>${escapeHtml(`${index + 1}. ${line}`)}</li>`).join("");
  const sectionsHtml = sections
    .map((section, sectionIndex) => {
      const questionRows = section.questions
        .map((question, questionIndex) => {
          const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
          const marks = formatting.includeMarksColumn ? `<span class="marks">[${question.marks ?? 0}]</span>` : "";
          const answerStyle = formatting.answerStyle ?? "boxes";
          const lines = question.answerBoxLines ?? formatting.answerBoxLines ?? 4;
          let answerHtml = "";
          if (answerStyle !== "none") {
            const ruledLines = Array.from({ length: lines }, () => '<div class="answer-line"></div>').join("");
            answerHtml = answerStyle === "boxes"
              ? `<div class="answer-box-bordered">${ruledLines}</div>`
              : `<div class="answer-bare-lines">${ruledLines}</div>`;
          }
          return `<div class="question-block"><div class="q-row"><span class="q-label">${escapeHtml(label)}</span><span class="q-text">${escapeHtml(question.prompt)}</span>${marks}</div>${answerHtml}</div>`;
        })
        .join("");
      return `<section><h3>${escapeHtml(section.heading)}</h3>${questionRows}</section>`;
    })
    .join("");
  const answersHtml = formatting.includeAnswerKey
    ? `<section class="answers"><h3>Answer Key</h3>${sections.map((section, sectionIndex) => section.questions.map((question, questionIndex) => { const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle); return `<div class="answer-row"><span class="q-label">${escapeHtml(label)}</span><span>${escapeHtml(question.answer ?? "")}</span></div>`; }).join("")).join("")}</section>`
    : "";
  return `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8" />\n  <title>${escapeHtml(title)}</title>\n  <style>\n    @page { size: A4; margin: ${formatting.pageMarginsMm}mm; }\n    * { margin: 0; padding: 0; }\n    body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: ${formatting.fontSize}pt; line-height: ${formatting.lineSpacing === "compact" ? "1.3" : formatting.lineSpacing === "relaxed" ? "1.7" : "1.5"}; }\n    h1, h2, h3 { margin: 0; margin-top: 0.5em; }\n    h3 { margin-top: 1em; }\n    .doc-head { border-bottom: 1px solid #cfcfcf; padding-bottom: 8px; margin-bottom: 14px; }\n    .school { text-align: center; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; margin-bottom: 4px; }\n    .title { text-align: center; margin-top: 6px; margin-bottom: 2px; font-size: 18pt; font-weight: bold; }\n    .subtitle { text-align: center; margin-top: 2px; margin-bottom: 8px; font-size: 10pt; color: #444; }\n    .meta { margin-bottom: 8px; font-size: 10pt; display: flex; gap: 20px; flex-wrap: wrap; }\n    .meta-line { min-width: 200px; }\n    ul { margin: 8px 0 12px 18px; padding: 0; }\n    li { margin: 2px 0; }\n    section { margin-top: 12px; }\n    .q-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; margin: 6px 0; align-items: start; }\n    .question-block { break-inside: avoid; page-break-inside: avoid; margin: 10px 0 4px 0; padding-bottom: 4px; }\n    .q-label { font-weight: 600; min-width: 30px; }\n    .q-text { white-space: pre-wrap; word-wrap: break-word; }\n    .marks { font-size: 9pt; color: #555; text-align: right; }\n    .answer-box-bordered { margin: 6px 0 14px 38px; border: 1pt solid #999; border-radius: 2px; break-inside: avoid; page-break-inside: avoid; }\n    .answer-box-bordered .answer-line { border-bottom: 0.5pt solid #ddd; height: 8mm; min-height: 8mm; }\n    .answer-box-bordered .answer-line:last-child { border-bottom: none; }\n    .answer-bare-lines { margin: 4px 0 12px 38px; }\n    .answer-bare-lines .answer-line { border-bottom: 0.5pt solid #bbb; height: 8mm; min-height: 8mm; }\n    .answers { border-top: 1px solid #cfcfcf; margin-top: 18px; padding-top: 10px; }\n    .answer-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 4px 0; }\n  </style>\n</head>\n<body>\n  <div class="doc-head">\n    <div class="school">${escapeHtml(formatting.schoolName)}</div>\n    <h1 class="title">${escapeHtml(title)}</h1>\n    <h2 class="subtitle">${escapeHtml(subtitle)}</h2>\n    <div class="meta">\n      ${formatting.includeNameLine ? `<div class="meta-line">Name: ____________________</div>` : ""}\n      ${formatting.includeDateLine ? `<div class="meta-line">Date: ____________________</div>` : ""}\n      ${formatting.teacherName ? `<div class="meta-line">Teacher: ${escapeHtml(formatting.teacherName)}</div>` : ""}\n    </div>\n  </div>\n  <h3>Instructions</h3>\n  <ul>${instructionsHtml}</ul>\n  ${sectionsHtml}\n  ${answersHtml}\n</body>\n</html>`;
}
