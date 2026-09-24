// Shared types and utilities for assignment sandboxes across all grade levels

import { askWhatYouMarkBlock } from "./ask-what-you-mark";
import { mathematicalRegisterBlock } from "./mathematical-register";
import { tokProvocationBlock } from "./tok-provocations";
import { sanitizeJsonBackslashes, sanitizeJsonEmbeddedQuotes } from "./json-repair";
import { typesetDraftMath } from "./math-typesetting";
import { formatQuestionLabel } from "./paper-labels";

export type DocumentKind = "activity-sheet" | "practice-set" | "investigation";

/**
 * What a student may compute with, printed on the cover of both the paper and
 * the mark scheme. Declared here rather than beside its renderer in
 * lib/exam-conditions.ts so the dependency runs one way only: that module
 * needs escapeHtml from this one.
 *
 * An enum rather than free text -- this line is read under exam pressure and
 * quoted back afterwards in an academic-honesty conversation, so it has to say
 * the same thing every time. Nuance that does not fit ("no calculator until
 * Level 3") belongs in `instructions`, which already prints on the cover.
 */
export type CalculatorPolicy =
  | "not-permitted"
  | "basic"
  | "graphing"
  | "graphing-required";

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
  /**
   * Formative Assessment title page: a write-in line for the student's
   * class/block, alongside the existing name/date lines.
   */
  includeBlockLine?: boolean;
  /**
   * Exam conditions, printed on BOTH the paper and the mark scheme by
   * lib/exam-conditions.ts. These live on the formatting rather than on the
   * draft on purpose: formatting is already handed to both renderers and to
   * the PDF archiver, so a field added here reaches the paper, the mark
   * scheme and the archived copies at once. A draft field would need six
   * separate edits, one of them to MarkSchemeRequest, and the mark scheme is
   * the copy that gets forgotten.
   *
   * All optional and all absent by default, so every document that predates
   * them renders exactly as it did.
   */
  calculatorPolicy?: CalculatorPolicy;
  /** Minutes allowed for the whole paper. */
  timeAllowedMinutes?: number;
  /** Print "Total: n marks" on the cover, n computed from the sections. */
  showTotalMarks?: boolean;
  /** The declaration the student is sitting under. */
  academicHonestyLine?: string;
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
  /**
   * Formative Assessment mark scheme: free-text, M/A/R/FT-coded marking
   * notes for this question (e.g. "M1 for a correct substitution shown; A1
   * for the correct value"). This is exactly the shape
   * `GradingUnit.markscheme: string` in lib/ai-grading.ts already expects,
   * so authoring it here makes a saved question gradeable with no
   * translation step — see lib/formative-assessment-bridge.ts.
   */
  markScheme?: string;
  /**
   * Formative Assessment: render a labeled "Working / reasoning" box before
   * the answer line, for a question whose command term (solve/show/hence/
   * determine) requires visible working, not just a final answer.
   */
  requiresWorking?: boolean;
  subparts?: Array<{
    prompt: string;
    marks?: number;
    answer?: string;
    hint?: string;
    /**
     * Lines of answer space for THIS subpart. Without it a subpart inherits
     * half the question's allowance and never drops below MIN_USEFUL_LINES,
     * which gives three ruled lines to "state the coefficient" -- three times
     * the space the answer needs, and a signal to the student that more is
     * wanted than a single value.
     */
    answerBoxLines?: number;
    tier?: 1 | 2 | 3;
    contentTag?: string;
    skillTag?: string;
    markScheme?: string;
    requiresWorking?: boolean;
  }>;
  answerBoxLines?: number;
  /**
   * Turns this question's answer space into a table with these columns.
   * Weights are relative widths; see AnswerBoxSpec.columns.
   */
  answerBoxColumns?: Array<{ header: string; weight: number }>;
  /**
   * Prints a labelled rectangle partitioned into cells between the prompt and
   * the answer space, for the student to fill in. See AreaModelSpec in
   * lib/typst-payload.ts.
   */
  areaModel?: {
    topLabels: string[];
    sideLabels: string[];
    /** Relative lengths, in one unit shared by both axes. See AreaModelSpec. */
    topWeights?: number[];
    sideWeights?: number[];
    cells?: string[][];
    caption?: string;
  };
};

// ---- Nuanced Analysis section enrichments ----

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
  /** Formative Assessment: shown in the section banner, e.g. "Suggested time: 10 min". */
  estimatedMinutes?: number;
};

// ---- Formative Assessment enrichments ----

/** One row of a "if marks were lost here, reteach this" table. */
export type ReteachGuideEntry = { questions: string; topic: string };

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
  /** Formative Assessment: general marking rules, e.g. "Accept equivalent correct forms". */
  markingPrinciples?: string[];
  /** Formative Assessment: mark-scheme-PDF-only "if marks were lost here, reteach this" table. */
  reteachGuide?: ReteachGuideEntry[];
  /** Formative Assessment: render a per-section "Score: ___/N" summary box on the title page. */
  showSectionScoreSummary?: boolean;
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
  /**
   * The nuanced_analyses packet this template is the working copy of, or null
   * for one authored directly in a grade sandbox. Where it is set, the packet
   * owns the content: the editor refreshes from it on open and writes back to
   * it on save. See the column comment in
   * supabase/migrations/20260910173204_assignment_templates_nuanced_analysis_link.sql.
   */
  nuanced_analysis_id?: string | null;
  created_at: string;
  updated_at: string;
};

export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

// ---- Tier distribution ----

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

// ---- Duplicate detection ----

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

// ---- Activity Generator (Nuanced Analysis format) ----

// Pre-DP rolling-bundle rules for Grade 9/10, appended when the target grade
// is not IB DP. Each distribution is one stapled document: the current
// section's classwork/homework, then the NEXT section's pre-class prep
// (P-prefixed so it never collides with the current section's own numbering),
// then the Teacher's Companion to be torn off before handing out.
const MYP_ROLLING_BUNDLE_RULES: string[] = [
  "",
  "PRE-DP ROLLING BUNDLE STRUCTURE (Grade 9 and Grade 10):",
  "19. This packet is ONE stapled distribution with three zones, in this order:",
  "    (a) the current section's classwork and homework, numbered Q1, Q2, Q3, …",
  "    (b) the NEXT section's pre-class prep, numbered P1, P2, P3, … — the P prefix is mandatory so prep never collides with the packet's own numbering",
  "    (c) the Teacher's Companion, as the final section, headed so it can be torn off",
  "20. Do not generate zone (b) if the continuity block states the next section's prep has already shipped.",
  "21. Zone (b) is preparation, not assessment: it surfaces the intuition the next section will formalise, and it must be completable without any instruction the student has not yet had.",
  "22. Marks language: always call them Clev's Marks. Never write 'points', 'score', or a bare 'grade'.",
  "23. Pre-DP command-term demand bands, applied consistently: Write down / State / List = 1 mark; Calculate = 3; Interpret / Describe / Explain / Determine = 4-5; Show that / Justify = 6-7.",
  "24. Age register: Grade 9 students are 14-15. Keep sentences short and concrete. Introduce formal notation only after the idea it names has been met informally in the same packet.",
  "25. Plant exactly two misconceptions across the packet, each targeting an error this cohort actually makes, and flag both in the Teacher's Companion with the misconception named.",
  "",
  // Measured from the two packets actually taught and marked in Grade 9
  // Extended -- A.1 "Sixty Times a Person" and A.2 "What Undoing Really
  // Means" -- not invented. Both are EIGHT sections with identical roles in
  // the same order, and a packet generated without rules 26-30 came back with
  // five sections, no Reflection, no Optional Extension, and subparts
  // throughout, which neither model uses at all. The shape is the house
  // style; describing it is cheaper than a teacher rebuilding it by hand.
  "PACKET SHAPE (Grade 9/10) — follow the shape of the packets this course has already taught:",
  "26. Produce EIGHT sections, in this order: Part 0, then five named teaching Parts, then Reflection, then Optional Extension. Reflection and Optional Extension are full sections in the sections array with their own questions, NOT the short top-level reflectionQuestions field, which you still fill in as well.",
  "27. Part 0 is headed exactly 'Part 0 — Warming the Engine'. 3-4 questions, 10-11 marks in total, every question tier 1. Parts 1-5 carry evocative thematic headings naming the idea they turn on, in the register of 'Part 1 — The Anatomy of an Expression', 'Part 2 — One Situation, Four Languages', 'Part 4 — Two Expressions, One Truth' — never a bare label like 'Part 1 — Structure' or 'Part 2 — Practice'. Each teaching Part carries 3-6 questions and 12-24 marks, and each gets a prerequisiteBox; give a spotlight to about two of them, not all five.",
  "28. The Reflection section carries exactly 3 questions, around 15-16 marks, all tier 2, and they are always these three: (a) a concept-map question asking the student to list at least six ideas, words or results this analysis confirmed or connected, answered in a table (this is the one question that takes answerBoxColumns, weighted per rule 6b); (b) a representation question asking them to compare the same object as it appeared in several different languages across the packet; (c) a TOK position statement telling them to return to the two provocations, choose one, take a position and defend it with a specific numbered result from this packet.",
  "29. The Optional Extension section carries 3-4 questions, EVERY ONE worth 0 marks and tier 3. The first two or three are headed 'Branch A — ', 'Branch B — ', 'Branch C — ', each a genuinely different direction out of the packet rather than more of the same practice. The last is headed 'Toolbox Wondering (exploration seed)' and states an explicit 'Initial research question:' a student could actually pursue.",
  "30. Do NOT use subparts. Neither model packet contains a single one: every question stands alone with its own number and its own marks, and a question that would have had (a), (b), (c) is written as separate consecutive questions instead. This matters beyond style -- each printed question becomes its own anchor box for scanning and AI marking, and lettered subparts inside one box cannot be marked separately. The only answerBoxColumns in the packet is the Reflection concept map from rule 28.",
  "31. Aim for 25-35 questions and 100-132 marks across the whole packet, and let the tiers climb: Part 0 entirely tier 1, the middle Parts mixing tier 1 and 2, the later Parts mixing tier 2 and 3.",
  "32. Do not reuse a section heading an earlier packet in this course already used; the continuity block lists them. A heading that merely rephrases one (a 'Backward' where the course already has a 'Backwards') is a reuse.",
];

/**
 * Is this grade in the Diploma Programme?
 *
 * Exported because the TOK bar (lib/tok-provocations.ts) is spliced in for
 * exactly these grades and the TOK validator
 * (lib/tok-provocation-validator.ts) must check exactly the same set. Two
 * copies of this condition would eventually disagree, and the failure would
 * be a Grade 10 packet flagged against rules it was never given.
 */
export function isDiplomaProgrammeGrade(gradeLevel: string): boolean {
  return gradeLevel === "Grade 12" || gradeLevel === "Grade 11";
}

export function buildActivityGeneratorSystemPrompt(
  gradeLevel: string,
  continuityContext?: string,
): string {
  const isIB = isDiplomaProgrammeGrade(gradeLevel);
  const isMYP = gradeLevel === "Grade 9" || gradeLevel === "Grade 10";
  // A literal backslash, built at runtime for the same reason the quote
  // character used to be: the math-syntax rule below is one long string full
  // of LaTeX, and a hand-escaped "\\\\frac" inside a quoted TypeScript string
  // is exactly the kind of thing that's easy to get wrong when this file is
  // edited (see escapeHtml() further down for the same String.fromCharCode
  // pattern). BS is one backslash; BS + BS is the two a JSON string needs.
  const BS = String.fromCharCode(92);
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
    '  "course": "string — e.g. \\"IBDP Mathematics: Analysis & Approaches HL\\" or \\"Grade 9 Mathematics (Extended)\\"",',
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
    '          "answerBoxColumns": [{ "header": "string", "weight": 4 }],',
    '          "areaModel": { "topLabels": ["string"], "sideLabels": ["string"], "cells": [["string"]], "caption": "string" },',
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
    "0. SELF-CONTAINMENT (applies to every prose field in this schema — internationalMindedness, tokProvocations, spotlight, geometricReading, translationTable, reflectionQuestions, plantedErrorIntro, and every question/subpart prompt): the packet is the student's ONLY source. They will never see whatever source material, textbook, or web content you drew inspiration from while writing this — only the JSON you output. Two failure patterns to actively avoid:\n    (a) A prompt or box assumes a fact, definition, dataset, or prior result that was never established earlier in THIS packet. If a later question needs a result from an earlier one, that earlier result must actually appear in this packet's own text (as a question the student answered, or as content given directly in the prompt) — reference other packets/topics by name only if you also inline the specific fact needed, in the student-visible text, right where it's used.\n    (b) A CONTRASTIVE OPENING that assumes the reader already knows the thing being contrasted against — e.g. internationalMindedness beginning \"X did not begin in [time/place]\" or \"Contrary to the common belief that...\" implicitly assumes the packet already taught that conventional story, which it has not. State the non-European (or otherwise intended) content directly and affirmatively instead: describe what DID happen, not what supposedly didn't. Never phrase international/historical content as a correction to an unstated claim.\n    Before finalising, check every prose field against this rule: could a student who has read ONLY this packet, front to back, understand this sentence with no outside knowledge? If not, add the missing fact inline or rewrite the sentence so it doesn't need it.",
    "1. Every section must be Part 0, Part 1, etc. Start with Part 0 as Activating Prior Knowledge. Part 0's questions are ORDINARY computational, definitional, or short-answer questions on the specific prerequisite skills named in \"prerequisites\"/\"syllabusTopics\" — e.g. a concrete numeric example, a named formula applied to given values, a short definition applied to a specific case. They must read exactly like any other question in the packet (a real number, a real named scenario, a real formula to apply), NOT like a meta-question about the packet itself. NEVER write a Part 0 prompt that refers to \"this analysis\", \"this packet\", \"the prerequisite topic\", \"the topic this builds on\", or any other phrase describing the packet rather than asking the student to do mathematics. If you are unsure what to ask, pick the single most basic fact, formula, or worked example the FIRST real mathematical step of Part 1 depends on, and turn that into a direct question with real numbers.",
    "2. tier: 1=★ (compulsory/entry), 2=★★ (standard), 3=★★★ (optional extension). ALL questions must have a tier.",
    "3. commandTerms: include only terms actually used in the packet.",
    "4. spotlight: the most important command-term distinction for this packet.",
    "5. prerequisiteBox: 2–4 bullet items for Parts 1 onwards.",
    "6. translationTable: where informal→formal language adds clear value.",
    "6b. answerBoxColumns: include it on any question whose prompt asks the student to fill in a table — a concept map, a compare/contrast grid, a \"list what you learned\" reflection — and omit it everywhere else. Two rules decide the weights, and getting them wrong is the specific failure this field exists to prevent. First, weight each column by HOW MUCH THE STUDENT WRITES IN IT, never by how long its header is: a column headed \"Where it appeared (Q number)\" holds answers like \"Q13\", so it is the NARROWEST column in the table even though its header is the longest. A header may wrap onto two lines; that is fine and costs nothing. Second, the column holding the student\'s explanation or reasoning takes the most room — usually more than the other columns combined. For the standard concept map (the idea / where it appeared / what it connected to), that means weights of about 4, 2 and 8. Real packets printed this table with all three columns roughly equal, and students\' explanations ran off the right edge of the paper where no scan could recover them.",
    "6c. areaModel: a labelled rectangle partitioned into cells, printed between the prompt and the answer space. Use it whenever a question would otherwise tell a student to DRAW a rectangle and cut it up: the drawing is not what is being assessed, and a fourteen-year-old who mis-draws it cannot attempt the mathematics. topLabels runs along the top edge, sideLabels down the left, and the cells are left empty for the student unless `cells` gives them (row-major) as a worked example. Every label goes through the same renderer as a prompt, so write them as $...$ math: topLabels [\"$x$\", \"$+2$\"] and sideLabels [\"$x$\", \"$+3$\"] draw the area model for $(x+3)(x+2)$. Give topWeights and sideWeights too whenever the labels carry numbers, as relative LENGTHS in one unit shared by both axes: [5, 2] and [5, 3] for that example, so the piece of length 2 is drawn shorter than the piece of length 3 and the unknown x is longer than both. A model drawn with equal cells tells a student that 2 and 3 are the same length. Omit the field entirely on every question that does not need a figure.",
    "6d. LINE BREAKS: a newline inside a prompt, a hint or an answer is a line break on the printed page and in the preview. Use them. A prompt whose stem is followed by several short items must put the stem on the first line and each item on its own line after it, never run together in a paragraph - a student hunting for item (d) should find it by scanning down the left, not by reading a block of prose. In JSON a newline is written \\n.",
    "7. geometricReading: at end of parts where geometric interpretation follows algebraic work.",
    "8. hints: for proof scaffolding and complex multi-step questions.",
    "9. subparts: (a),(b),(c) for questions with distinct phases.",
    "10. Marks: write-down=1–2, show-that/prove=3–5, extended investigation=4–8.",
    "11. Use IB vocabulary: 'intersects' not 'crosses through'; 'even multiplicity' not 'bounces'.",
    "11c. COMMAND TERMS MUST BE FROM THE CANONICAL IB LIST ONLY (Calculate, Comment, Compare, Compare and contrast, Construct, Contrast, Deduce, Demonstrate, Describe, Determine, Differentiate, Distinguish, Draw, Estimate, Explain, Find, Hence, Hence or otherwise, Identify, Integrate, Interpret, Investigate, Justify, Label, List, Plot, Predict, Prove, Show, Show that, Sketch, Solve, State, Suggest, Verify, Write down).\n    NOT ONE of the four verbs the mathematical register uses for operations on an expression -- simplify, expand, factor, evaluate -- is on that list, and neither is a bare 'Write'. Each reads like a perfectly good instruction, and each produces a question with no recognised command term in it. The recipe is always the same: keep the mathematics, and pair a CANONICAL verb with the register's own NOUN." +
      "\n    - 'Simplify x' -> 'Solve, giving your answer as a fraction in its lowest terms', or 'Calculate the value, giving your answer in its simplest form'.\n    - 'Expand $(1+x)^4$' -> 'Find the expansion of $(1+x)^4$', or 'Write down the expansion of $(1+x)^4$'.\n    - 'Evaluate $4!$' -> 'Calculate $4!$', or 'Find the value of $4!$'.\n    - 'Factorise $x^2-5x+6$' -> 'Find the factors of $x^2-5x+6$', or 'Show that $x^2-5x+6=(x-2)(x-3)$'.\n    - 'Write $7^n$ as $(1+6)^n$' -> 'Write down $7^n$ in the form $(1+6)^n$' (the canonical term is the two-word 'Write down')." +
      "\n    This does NOT overrule the mathematical register set out below, and the two are not in conflict: simplify, expand, factor and evaluate remain the correct words for what is DONE to an expression, and stay correct in prose and in their noun forms ('the expansion', 'the value', 'the factors', 'in its simplest form'). This rule governs only the imperative that ISSUES the task, which must be a term from the list above. It applies to every question and subpart prompt, not just the first sentence of the packet.",
    `11b. MATH: write EVERY mathematical expression as LaTeX inside single $...$ delimiters — one pair per expression, inline in the sentence. Do NOT use $$...$$, \\[...\\] or \\(...\\); this packet format has one math delimiter and it is $. Never leave mathematics as plain ASCII: "cos(3pi/2)", "x^2+2ab", "<=", "!=", "sqrt(2)", "1/2" and "alpha" are all wrong, whatever surrounds them.
    Use the full language, not a subset of it. ${BS}frac{a}{b} and ${BS}dfrac{a}{b}; ${BS}sqrt{x} and ${BS}sqrt[3]{x}; ${BS}left( ... ${BS}right) (also ${BS}left| ... ${BS}right|, ${BS}left${BS}{ ... ${BS}right${BS}}, ${BS}left${BS}lfloor ... ${BS}right${BS}rfloor) so brackets grow around what they hold; ${BS}sum_{k=1}^{n}, ${BS}prod, ${BS}int_{a}^{b}, ${BS}lim_{x ${BS}to 0}; ${BS}sin ${BS}cos ${BS}tan ${BS}ln ${BS}log ${BS}arctan ${BS}min ${BS}max ${BS}det ${BS}gcd, and ${BS}operatorname{Var}, ${BS}operatorname{Cov}, ${BS}operatorname{SD} for a named operator that has no command of its own; Greek by name (${BS}alpha ${BS}beta ${BS}theta ${BS}pi ${BS}sigma ${BS}lambda ${BS}Delta ${BS}Omega); ${BS}times ${BS}div ${BS}cdot ${BS}pm ${BS}leq ${BS}geq ${BS}neq ${BS}approx ${BS}equiv ${BS}propto ${BS}in ${BS}notin ${BS}subseteq ${BS}cup ${BS}cap ${BS}setminus ${BS}infty ${BS}to ${BS}Rightarrow ${BS}iff ${BS}forall ${BS}exists; ${BS}mathbb{R} ${BS}mathbb{Z} ${BS}mathbb{N} ${BS}mathbb{Q} ${BS}mathbb{C} for the number sets; ${BS}text{...} for words inside an expression; 30^${BS}circ for degrees; ${BS}overline{x} or ${BS}bar{x} for a mean, ${BS}hat{y} for an estimate; ${BS}mathrm{d}x for a differential; ${BS}binom{n}{k}; ${BS}begin{pmatrix} ... ${BS}end{pmatrix} for a column vector or matrix, ${BS}begin{cases} ... ${BS}end{cases} for a piecewise definition, ${BS}begin{aligned} ... ${BS}end{aligned} for working that lines up on its equals signs.
    Follow this platform's vector conventions exactly (they are the ones in platform/AGENTS.md): ${BS}boldsymbol{a} for a named vector — NEVER ${BS}mathbf, ${BS}vec or ${BS}overrightarrow for one — ${BS}boldsymbol{${BS}cdot} between two vectors for a dot product, pmatrix (round brackets) for a column vector, and plain italic for a scalar parameter such as ${BS}lambda.
    JSON ESCAPING, and this is where generated packets most often break: a backslash inside a JSON string must be DOUBLED, so write "${BS}${BS}frac{3${BS}${BS}pi}{2}" to produce $${BS}frac{3${BS}pi}{2}$. A LaTeX row break inside pmatrix/cases/aligned is two backslashes, so it is FOUR in JSON ("${BS}${BS}${BS}${BS}"); alternatively write ${BS}${BS}cr, which needs only two and means the same thing.`,
    "11d. NEVER write a literal $ for currency in prose (e.g. \"costs $2\", \"a $10 prize\", \"the $2 cost to play\"). The renderer treats every $ as a math-mode delimiter — see rule 11b — with no special case for dollar signs meaning money. A single stray currency $ pairs up with the next $ anywhere else in the packet and gets parsed as a math expression, which reliably breaks the compile (observed failure: \"$2 to play\" parsed as math and crashed on the word \"to\", since Typst tried to evaluate \"2 to play\" as code). For any monetary amount, always spell it out in words instead: \"costs 2 dollars\", \"a 10-dollar prize\", \"a net profit of 3.50 dollars\". This applies everywhere in the packet, not just inside $...$ math — the danger is the bare $ character appearing in prose at all.",
    isIB
      ? "12. tokProvocations: exactly 2, held to the TOK PROVOCATIONS quality bar set out below (rules T1-T8). Write them AFTER you know what the packet proves and assumes, so they can name it, and apply T7 while writing the Parts rather than bolting it on at the end."
      : "12. tokProvocations: exactly 2, both referencing a real philosophical tension in the mathematics.",
    "13. internationalMindedness: name at least 2 mathematicians from non-European traditions and describe their actual contribution in enough detail that a student needs no outside knowledge to follow it. Open with a direct, affirmative statement about what these mathematicians did (e.g. \"The Persian mathematician al-Khwarizmi developed...\") — do NOT open by negating or contrasting against a conventional/European narrative the packet never told (banned pattern, see rule 0b: \"X did not begin in [country/century]\", \"Contrary to popular belief...\"). If a connection to this packet's own mathematics is drawn, state that connection's substance in the same sentence rather than assuming the reader already sees it.",
    isIB
      ? "14. reflectionQuestions: 3 questions — concept-map, epistemological, and a TOK position statement returning to one of the two provocations. The position-statement prompt must ask for a specific numbered result from this packet as the evidence (T8)."
      : "14. reflectionQuestions: 3 questions — concept-map, epistemological, TOK position statement.",
    "15. atl: one precise sentence, e.g. 'You will build representational fluency: the same object as algebra, geometry, and series.'",
    "16. CONTENT AND SKILL TAGS (REQUIRED on every question and subpart):",
    "    contentTag: the specific IB syllabus bullet being addressed, e.g. 'Topic 1.13 — De Moivre's Theorem' or 'Topic 5.7 — Maclaurin series'.",
    "    skillTag: the mathematical practice or ATL skill, e.g. 'Proof by mathematical induction', 'Conjecture from numerical evidence', 'Representational transfer: algebra → geometry', 'Error analysis', 'GDC as instrument of verification'.",
    "    These tags appear on the student page — make them informative and concise (under 10 words each).",
    "17. Refinement: if conversation history shows a prior JSON draft, modify it per the new instruction. Return complete updated JSON.",
    isIB
      ? "18. For IBDP: include at least one proof question (Show that/Prove), one Broken Math Critique part, and one technology task (GeoGebra/Desmos)."
      : `18. For ${gradeLevel}: include at least one real-world application and one error-analysis question.`,
    ...(isMYP ? MYP_ROLLING_BUNDLE_RULES : []),
    // DP only. Grade 9/10 students are not in TOK, so their packets keep the
    // one-line rule 12 above rather than the full bar.
    ...(isIB ? ["", tokProvocationBlock()] : []),
    "",
    askWhatYouMarkBlock(),
    "",
    mathematicalRegisterBlock(),
    ...(continuityContext ? ["", continuityContext] : []),
  ].join("\n");
}

export function buildActivityGeneratorUserPrompt(
  description: string,
  gradeLevel: string,
  sectionCode?: string,
): string {
  return [
    `Grade level: ${gradeLevel}`,
    ...(sectionCode ? [`Section being generated: ${sectionCode}`] : []),
    `Activity description: ${description}`,
    "Generate a complete Nuanced Analysis activity sheet. Return only JSON.",
  ].join("\n");
}

// ---- Standard template system prompt ----

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
    "",
    askWhatYouMarkBlock(),
    "",
    mathematicalRegisterBlock(),
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

/**
 * Normalises a raw AI draft into a usable AssignmentDraft.
 *
 * The last step is typesetDraftMath(), and it is not cosmetic. The 11b MATH
 * rule asks the generator to delimit equations with $...$, and a request is
 * all it is: the B.4 packet (Grade 9 Extended, 16 Sep 2026) came back with
 * ZERO dollar signs in twelve pages and printed every equation as literal
 * ASCII -- "a^2+2ab+b^2" -- to a class of fourteen-year-olds. Typesetting
 * here rather than at render time means the packet is stored correct, so the
 * saved row, the rubric items derived from it and the PDF all agree.
 * See lib/math-typesetting.ts.
 */
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
                  ...(question.markScheme ? { markScheme: question.markScheme } : {}),
                  ...(question.requiresWorking !== undefined ? { requiresWorking: question.requiresWorking } : {}),
                  ...(Array.isArray(question.subparts) ? { subparts: question.subparts } : {}),
                  ...(question.answerBoxLines !== undefined ? { answerBoxLines: question.answerBoxLines } : {}),
                  ...(question.areaModel ? { areaModel: question.areaModel } : {}),
                }))
                .filter((question) => question.prompt.length > 0)
            : [],
          ...(section.prerequisiteBox ? { prerequisiteBox: section.prerequisiteBox } : {}),
          ...(section.spotlight ? { spotlight: section.spotlight } : {}),
          ...(section.translationTable ? { translationTable: section.translationTable } : {}),
          ...(section.geometricReading ? { geometricReading: section.geometricReading } : {}),
          ...(section.estimatedMinutes !== undefined ? { estimatedMinutes: section.estimatedMinutes } : {}),
        }))
        .filter((section) => section.questions.length > 0)
    : [];

  if (sections.length === 0) throw new Error("AI response did not include any usable questions.");

  const instructions = Array.isArray(draft.instructions)
    ? draft.instructions.filter((line) => typeof line === "string" && line.trim().length > 0)
    : [];

  return typesetDraftMath({
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
    ...(Array.isArray(draft.markingPrinciples) && draft.markingPrinciples.length > 0
      ? { markingPrinciples: draft.markingPrinciples }
      : {}),
    ...(Array.isArray(draft.reteachGuide) && draft.reteachGuide.length > 0
      ? { reteachGuide: draft.reteachGuide }
      : {}),
    ...(draft.showSectionScoreSummary !== undefined
      ? { showSectionScoreSummary: draft.showSectionScoreSummary }
      : {}),
  });
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

// formatQuestionLabel and paperQuestionPrefixes live in lib/paper-labels.ts,
// which has no imports, so a client page can use them without shipping this
// module. Re-exported here so every existing import keeps working.
export { formatQuestionLabel, paperQuestionPrefixes } from "./paper-labels";

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
