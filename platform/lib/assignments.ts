// Shared types and utilities for assignment sandboxes across all grade levels

import { sanitizeJsonBackslashes, sanitizeJsonEmbeddedQuotes } from "./json-repair";

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
  answerBoxLines?: number;
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
  tier?: 1 | 2 | 3;
  hint?: string;
  /**
   * IB syllabus content reference visible to the student.
   * E.g. "Topic 1.13 — De Moivre's Theorem"
   */
  contentTag?: string;
  /**
   * Mathematical practice or ATL skill visible to the student.
   * E.g. "Proof by mathematical induction"
   */
  skillTag?: string;
  subparts?: Array<{
    prompt: string;
    marks?: number;
    hint?: string;
    tier?: 1 | 2 | 3;
    contentTag?: string;
    skillTag?: string;
  }>;
  answerBoxLines?: number;
};

// ── Nuanced Analysis section enrichments ──────────────────────────────────────

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
  atl?: string;
  commandTerms?: CommandTermEntry[];
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

// ── Tier distribution ──────────────────────────────────────────────────────────

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

// ── Duplicate detection ────────────────────────────────────────────────────────

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
  // A literal double-quote character, built at runtime so the math-syntax rule
  // below can show a quoted-operator example via template-literal interpolation
  // instead of a hand-escaped \" sequence embedded in a single-quoted string
  // literal (that escaping is exactly the kind of thing that's easy to get
  // wrong when this file is regenerated — see escapeHtml() further down in
  // this same file for the same String.fromCharCode pattern).
  const q = String.fromCharCode(34);
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
    '  "title": "string — packet title",',
    '  "subtitle": "string — e.g. \\"Mastery Packet: IBDP Mathematics AA HL\\"",',
    '  "course": "string — e.g. \\"IBDP Mathematics AA HL\\"",',
    '  "syllabusTopics": "string",',
    '  "prerequisites": "string",',
    '  "materials": "string",',
    '  "atl": "string — one sentence naming the ATL skill built across the whole packet",',
    '  "compulsoryCore": "string",',
    '  "plantedErrorIntro": "string",',
    '  "instructions": ["string"],',
    '  "commandTerms": [{ "term": "string", "definition": "string" }],',
    '  "tokProvocations": [{ "id": "tok1", "body": "string" }, { "id": "tok2", "body": "string" }],',
    '  "internationalMindedness": { "body": "string" },',
    '  "reflectionQuestions": ["string"],',
    '  "sections": [',
    '    {',
    '      "heading": "Part 0 — Activating Prior Knowledge",',
    '      "prerequisiteBox": { "items": ["string"] },',
    '      "spotlight": { "title": "string", "body": "string" },',
    '      "questions": [',
    '        {',
    '          "prompt": "string",',
    '          "marks": 2,',
    '          "tier": 1,',
    '          "contentTag": "Topic X.Y — Content name",',
    '          "skillTag": "ATL/mathematical skill name",',
    '          "hint": "string (optional)",',
    '          "answer": "string (teacher-only answer sketch)",',
    '          "subparts": [',
    '            { "prompt": "string", "marks": 1, "tier": 1, "contentTag": "string", "skillTag": "string" }',
    '          ]',
    '        }',
    '      ],',
    '      "translationTable": { "caption": "string", "rows": [{ "informal": "string", "formal": "string" }] },',
    '      "geometricReading": { "body": "string" }',
    '    }',
    '  ]',
    '}',
    "",
    "DESIGN RULES:",
    "1. Every section must be Part 0, Part 1, etc. Start with Part 0 as Activating Prior Knowledge.",
    "2. tier: 1=★ (compulsory/entry), 2=★★ (standard), 3=★★★ (optional extension). ALL questions must have a tier.",
    "3. commandTerms: include only terms actually used in the packet.",
    "4. spotlight: the most important command-term distinction for this packet.",
    "5. prerequisiteBox: 2–4 bullet items for Parts 1 onwards.",
    "6. translationTable: where informal→formal language adds clear value.",
    "7. geometricReading: at end of parts where geometric interpretation follows algebraic work.",
    "8. hints: for proof scaffolding and complex multi-step questions.",
    "9. subparts: (a),(b),(c) for questions with distinct phases.",
    "10. Marks: write-down=1–2, show-that/prove=3–5, extended investigation=4–8.",
    "11. Use IB vocabulary: 'intersects' not 'crosses through'; 'even multiplicity' not 'bounces'.",
    `11b. MATH: write equations as $...$ using native Typst math syntax — NOT LaTeX. No backslash commands (no \\frac, \\sqrt, \\alpha). Use: x^2, x_1, sqrt(x), (a)/(b) or frac(a,b), alpha, beta, sigma, mu, sum_(k=1)^n, integral, macron(x) for a bar/overline. Named operators with no Typst symbol (Var, Cov, Corr, SD) MUST be quoted so they render upright and compile correctly, e.g. $${q}Var${q}(X) = sigma^2$ — an unquoted $Var(X)$ will fail to compile. CRITICAL JSON RULE: every ${q} character you write — including these quoted operators — MUST be escaped as \\${q} inside JSON string values, exactly like any other quote mark. A raw, unescaped ${q} inside a string breaks the JSON.`,
    "12. tokProvocations: exactly 2, both referencing a real philosophical tension in the mathematics.",
    "13. internationalMindedness: name at least 2 mathematicians from non-European traditions.",
    "14. reflectionQuestions: 3 questions — concept-map, epistemological, TOK position statement.",
    "15. atl: one precise sentence, e.g. 'You will build representational fluency: the same object as algebra, geometry, and series.'",
    "16. CONTENT AND SKILL TAGS (REQUIRED on every question and subpart):",
    "    contentTag: the specific IB syllabus bullet being addressed, e.g. 'Topic 1.13 — De Moivre's Theorem' or 'Topic 5.7 — Maclaurin series'.",
    "    skillTag: the mathematical practice or ATL skill, e.g. 'Proof by mathematical induction', 'Conjecture from numerical evidence', 'Representational transfer: algebra → geometry', 'Error analysis', 'GDC as instrument of verification'.",
    "    These tags appear on the student page — make them informative and concise (under 10 words each).",
    "17. Refinement: if conversation history shows a prior JSON draft, modify it per the new instruction. Return complete updated JSON.",
    isIB
      ? "18. For IBDP: include at least one proof question (Show that/Prove), one Broken Math Critique part, and one technology task (GeoGebra/Desmos)."
      : `18. For ${gradeLevel}: include at least one real-world application and one error-analysis question.`,
  ].join("\n");
}

export function buildActivityGeneratorUserPrompt(description: string, gradeLevel: string): string {
  return [
    `Grade level: ${gradeLevel}`,
    `Activity description: ${description}`,
    "Generate a complete Nuanced Analysis activity sheet. Return only JSON.",
  ].join("\n");
}

// ── Standard template system prompt ───────────────────────────────────────────

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
                  ...(question.contentTag ? { contentTag: question.contentTag } : {}),
                  ...(question.skillTag ? { skillTag: question.skillTag } : {}),
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
    ...(draft.course ? { course: draft.course } : {}),
    ...(draft.syllabusTopics ? { syllabusTopics: draft.syllabusTopics } : {}),
    ...(draft.prerequisites ? { prerequisites: draft.prerequisites } : {}),
    ...(draft.materials ? { materials: draft.materials } : {}),
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

/**
 * Parses a raw Claude text reply into a validated AssignmentDraft, repairing
 * the JSON along the way. The Activity Generator's system prompt requires
 * quoted Typst named operators (e.g. $op("Var")(X)$ — see the 11b MATH rule
 * above), and the model doesn't always escape that inner quote as \" in its
 * JSON output. sanitizeJsonEmbeddedQuotes fixes that; sanitizeJsonBackslashes
 * catches any stray backslash/control character on top. Both are no-ops on
 * already-valid JSON, so it's safe to run them unconditionally rather than
 * only as a fallback after a parse failure.
 *
 * Throws a descriptive Error (with full diagnostics sent to console.error,
 * mirroring the pattern used in app/api/generate-packet/route.ts) if the
 * text still can't be parsed after repair — most commonly because the reply
 * was truncated at max_tokens before any closing brace was ever written.
 */
export function parseAssignmentDraftJson(rawText: string, stopReason?: string): AssignmentDraft {
  const extracted = extractJsonObject(rawText);
  const repaired = sanitizeJsonBackslashes(sanitizeJsonEmbeddedQuotes(extracted));

  let parsed: AssignmentDraft;
  try {
    parsed = JSON.parse(repaired) as AssignmentDraft;
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : "unknown parse error";
    const positionMatch = message.match(/position (\d+)/);
    const position = positionMatch ? Number(positionMatch[1]) : null;
    const context =
      position !== null
        ? repaired.slice(Math.max(0, position - 300), position + 300)
        : repaired.slice(0, 2000);

    console.error("[assignments] JSON parse error after repair:", message);
    console.error("[assignments] stop_reason:", stopReason ?? "unknown");
    console.error("[assignments] context around failure position:", context);
    console.error("[assignments] full repaired JSON length:", repaired.length);
    console.error("[assignments] full repaired JSON:", repaired);

    throw new Error(
      stopReason === "max_tokens"
        ? `The AI reply was cut off before the draft JSON was complete (stop_reason: max_tokens, ${rawText.length} chars received). Try again — and if it repeats, send fewer attachments in one message.`
        : `Claude generated invalid JSON even after repair: ${message}. Check the browser console for the exact failure context.`,
    );
  }

  return sanitizeDraft(parsed);
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

/**
 * Canonical (a), (b), (c) ... (z), (aa), (ab) ... lettering for a question's
 * subparts, indexed from 0. This is the single source of truth for subpart
 * letters — every place that displays or references a subpart label (the
 * on-screen preview, the command-term validator's issue locations, etc.)
 * should import this rather than reimplementing its own char-code math.
 * That duplication is exactly what let the preview's labels (which used a
 * stray offset of 105 — the code for 'i', not 'a') silently drift out of
 * sync with the validator's labels (which were already correct), so a
 * teacher would see "(i)" on screen while a warning banner referenced the
 * same subpart as "(a)".
 */
export function subpartLetter(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(97 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
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
