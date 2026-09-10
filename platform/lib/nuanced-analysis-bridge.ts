/**
 * nuanced-analysis-bridge.ts
 * -----------------------------------------------------------------------------
 * Converts a row from the `nuanced_analyses` table into the AssignmentDraft
 * shape used by Assignment Studio's editor
 * (app/dashboard/assignments/editor/[id]) and its working HTML+Puppeteer PDF
 * pipeline (document-orchestrator.ts).
 *
 * THREE PARTS SHAPES, ONE TARGET. The table has accumulated three different
 * `parts` encodings, because three different writers have filled it over
 * time and none of them migrated what came before:
 *
 *   A. "generated"  - app/api/generate-packet writes
 *                     { part_number, title, content, questions[{q_number,
 *                     text, marks}] } and an ARRAY teacher_companion.
 *   B. "legacy"     - the earlier packet generator wrote
 *                     { part_number, title, micro_box[], geometric_reading,
 *                     questions[{number, stem, marks, command_term, tier}] }.
 *   C. "sections"   - app/api/nuanced-analyses POST writes `parts:
 *                     draft.sections` verbatim, so parts IS already
 *                     AssignmentSection[] - { heading, spotlight,
 *                     prerequisiteBox, questions[{prompt, marks, answer,
 *                     ...}] }. Every Grade 9/10 rolling-bundle packet is
 *                     this shape.
 *
 * Until this module handled all three, only shape A converted: shape B and C
 * produced questions with `prompt: undefined` (they carry the text under
 * `stem`/`prompt`, not `text`) and headings reading "Part undefined -
 * undefined", and any packet with an OBJECT teacher_companion - which is
 * every shape B and C packet - threw "teacherCompanion is not iterable"
 * before it got that far, surfacing as a 500 from
 * /api/assignments/from-nuanced-analysis. That is what made the "Open"
 * button in the Manage Nuanced Analysis tab unusable for 5 of the 6 saved
 * packets.
 *
 * This is a deliberately lossy bridge in a few places:
 *  - An ARRAY teacher_companion's three fields (answer / mark_scheme /
 *    pedagogy_note) collapse into AssignmentQuestion's single .answer
 *    string, since that's the only slot the target schema has for
 *    per-question teacher content.
 *  - An OBJECT teacher_companion is the packet-level Teacher's Companion
 *    (designNote, answerSketches, integrationMap, ...). It has no
 *    per-question mapping at all, so it contributes no answers rather than
 *    being guessed at from its prose. Shape C carries the real per-question
 *    answer on the question itself; for shape B the authoritative key is
 *    na_rubric_items, exported by /api/na-review/rubric/[id]?format=html.
 *  - Shape B's `command_term` has no field in AssignmentQuestion and is
 *    dropped.
 *  - Original q_number labels ("1a", "1b"...) are dropped in favor of the
 *    target system's own sequential numbering (formatQuestionLabel) - the
 *    target schema has no field for a custom label.
 *  - vocabulary is packet-level in the source but section-level
 *    (translationTable) in the target, so it's attached once, to the first
 *    section, rather than duplicated across every part.
 * -----------------------------------------------------------------------------
 */

import type { AssignmentDraft, AssignmentSection, AssignmentQuestion } from "./assignments";

/** A vocabulary entry in any of the three encodings the column has held. */
export type RawVocabularyEntry =
  | string
  | { student_speak?: string; ib_rigor?: string; term?: string; definition?: string };

/** One entry of an ARRAY-shaped teacher_companion (shape A packets). */
export interface TeacherCompanionEntry {
  q_number: string;
  answer: string;
  mark_scheme: string;
  pedagogy_note: string;
}

/**
 * A `parts` element as it actually comes out of the database: one of the
 * three shapes above. Every field is optional because which ones are
 * present is exactly what distinguishes the shapes.
 */
export interface RawPart {
  // shape A + B
  part_number?: number;
  title?: string;
  // shape A
  content?: string;
  // shape B
  micro_box?: string[];
  geometric_reading?: string;
  // shape C (already an AssignmentSection)
  heading?: string;
  spotlight?: AssignmentSection["spotlight"];
  prerequisiteBox?: AssignmentSection["prerequisiteBox"];
  translationTable?: AssignmentSection["translationTable"];
  geometricReading?: AssignmentSection["geometricReading"];
  questions?: RawQuestion[];
}

/** A question in any of the three shapes. */
export interface RawQuestion {
  /** shape A */
  q_number?: string;
  text?: string;
  /** shape B */
  number?: number | string;
  stem?: string;
  command_term?: string;
  /** shape C (already an AssignmentQuestion) */
  prompt?: string;
  answer?: string;
  hint?: string;
  contentTag?: string;
  skillTag?: string;
  subparts?: AssignmentQuestion["subparts"];
  answerBoxLines?: number;
  /** all shapes */
  marks?: number;
  tier?: 1 | 2 | 3;
}

export interface NuancedAnalysisRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  course: string | null;
  syllabus_topics: string[] | null;
  prerequisites: string[] | null;
  materials: string | null;
  /**
   * Three element shapes in the live table: {student_speak, ib_rigor} from
   * the packet generator, {term, definition} from a sandbox save (which
   * writes draft.commandTerms into this column), and bare strings from the
   * hand-authored migrations.
   */
  vocabulary: RawVocabularyEntry[] | null;
  atl_statement: string | null;
  /**
   * Bare strings in every row written so far; {id, body} objects from a
   * sandbox save, which writes draft.tokProvocations here.
   */
  tok_provocations: Array<string | { id?: string; body?: string }> | null;
  parts: RawPart[] | null;
  /**
   * Array for shape A packets, object (the packet-level Teacher's Companion)
   * for shapes B and C. Typed as unknown for the object case so that reading
   * it wrongly is a compile error rather than a runtime throw.
   */
  teacher_companion: TeacherCompanionEntry[] | Record<string, unknown> | null;
}

/**
 * Per-question answers, keyed by the source's own question label.
 * Empty for an object-shaped (packet-level) teacher_companion, which has no
 * per-question entries to key on.
 */
function buildTeacherCompanionLookup(
  teacherCompanion: NuancedAnalysisRow["teacher_companion"]
): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(teacherCompanion)) return map;

  for (const tc of teacherCompanion) {
    const pieces = [
      tc.answer ? `Answer: ${tc.answer}` : "",
      tc.mark_scheme ? `Mark scheme: ${tc.mark_scheme}` : "",
      tc.pedagogy_note ? `Common error: ${tc.pedagogy_note}` : "",
    ].filter(Boolean);
    if (pieces.length > 0) map.set(tc.q_number, pieces.join("\n\n"));
  }
  return map;
}

/**
 * Vocabulary as {informal, formal} pairs for the target's two-column
 * "what you say / what you write" translation table.
 *
 * A bare-string entry is a term with no gloss - there is no second column to
 * put anywhere - so it is dropped rather than rendered as a half-empty row.
 * Those packets keep their vocabulary in the source record; it is only this
 * one presentation of it that needs a pair.
 */
function normalizeVocabulary(
  vocabulary: RawVocabularyEntry[]
): Array<{ informal: string; formal: string }> {
  const rows: Array<{ informal: string; formal: string }> = [];
  for (const v of vocabulary) {
    if (typeof v === "string") continue;
    const informal = v.student_speak ?? v.term;
    const formal = v.ib_rigor ?? v.definition;
    if (informal && formal) rows.push({ informal, formal });
  }
  return rows;
}

/** TOK provocations as {id, body}, from either a bare string or an object. */
function normalizeTokProvocations(
  provocations: NonNullable<NuancedAnalysisRow["tok_provocations"]>
): Array<{ id: string; body: string }> {
  const out: Array<{ id: string; body: string }> = [];
  provocations.forEach((p, i) => {
    const body = typeof p === "string" ? p : p.body;
    if (!body) return;
    const id = (typeof p === "string" ? undefined : p.id) ?? `tok-${i + 1}`;
    out.push({ id, body });
  });
  return out;
}

/**
 * True when a part is already an AssignmentSection (shape C). `heading` is
 * the discriminator: shapes A and B both carry `title` + `part_number` and
 * never a `heading`.
 */
function isSectionShaped(part: RawPart): boolean {
  return typeof part.heading === "string" && part.heading.length > 0;
}

/** The question's prompt text, wherever this shape happens to keep it. */
function questionPrompt(q: RawQuestion): string {
  return q.prompt ?? q.text ?? q.stem ?? "";
}

/** The label the ARRAY teacher_companion keys its entries by. */
function questionKey(q: RawQuestion): string | null {
  if (q.q_number != null) return String(q.q_number);
  if (q.number != null) return String(q.number);
  return null;
}

function normalizeQuestion(
  q: RawQuestion,
  companionByKey: Map<string, string>
): AssignmentQuestion {
  const key = questionKey(q);
  // A per-question companion entry wins over an inline answer: it is the
  // richer text (answer + mark scheme + common error), and only shape A
  // packets have both.
  const companionAnswer = key ? companionByKey.get(key) : undefined;
  const answer = companionAnswer ?? q.answer;

  return {
    prompt: questionPrompt(q),
    ...(q.marks != null ? { marks: q.marks } : {}),
    ...(answer ? { answer } : {}),
    ...(q.tier ? { tier: q.tier } : {}),
    ...(q.hint ? { hint: q.hint } : {}),
    ...(q.contentTag ? { contentTag: q.contentTag } : {}),
    ...(q.skillTag ? { skillTag: q.skillTag } : {}),
    ...(q.subparts ? { subparts: q.subparts } : {}),
    ...(q.answerBoxLines != null ? { answerBoxLines: q.answerBoxLines } : {}),
  };
}

/** Turns any of the three part shapes into one AssignmentSection. */
function normalizePart(
  part: RawPart,
  index: number,
  companionByKey: Map<string, string>
): AssignmentSection {
  const questions = (part.questions ?? []).map((q) => normalizeQuestion(q, companionByKey));

  if (isSectionShaped(part)) {
    // Already an AssignmentSection - carry its enrichments through as-is
    // rather than rebuilding a heading it already has.
    return {
      heading: part.heading as string,
      questions,
      ...(part.spotlight ? { spotlight: part.spotlight } : {}),
      ...(part.prerequisiteBox ? { prerequisiteBox: part.prerequisiteBox } : {}),
      ...(part.translationTable ? { translationTable: part.translationTable } : {}),
      ...(part.geometricReading ? { geometricReading: part.geometricReading } : {}),
    };
  }

  const partNumber = part.part_number ?? index + 1;
  const heading = part.title ? `Part ${partNumber} — ${part.title}` : `Part ${partNumber}`;

  // Shape A keeps its overview prose in `content`; shape B keeps it as
  // `micro_box` bullets. Both land in the same spotlight slot.
  const spotlightBody =
    part.content ??
    (part.micro_box && part.micro_box.length > 0 ? part.micro_box.join("\n") : undefined);

  return {
    heading,
    questions,
    ...(spotlightBody ? { spotlight: { title: "Overview", body: spotlightBody } } : {}),
    ...(part.geometric_reading ? { geometricReading: { body: part.geometric_reading } } : {}),
  };
}

export function convertNuancedAnalysisToDraft(row: NuancedAnalysisRow): AssignmentDraft {
  const companionByKey = buildTeacherCompanionLookup(row.teacher_companion);
  const vocabularyRows = normalizeVocabulary(row.vocabulary ?? []);
  const tokProvocations = normalizeTokProvocations(row.tok_provocations ?? []);

  // Shape C has no part_number to sort by; its array order IS the order.
  // Sorting is therefore stable-by-index for those and by part_number for
  // the shapes that carry one.
  const parts = [...(row.parts ?? [])].sort(
    (a, b) => (a.part_number ?? 0) - (b.part_number ?? 0)
  );

  const sections: AssignmentSection[] = parts.map((part, index) => {
    const section = normalizePart(part, index, companionByKey);

    // Vocabulary has no per-part home in the source schema - attach it once,
    // to the first section, as a "Key Vocabulary" translation table, rather
    // than duplicating it (or arbitrarily picking a different part) for every
    // section. A shape C part that already carries its own translationTable
    // keeps it.
    if (index === 0 && vocabularyRows.length > 0 && !section.translationTable) {
      section.translationTable = { caption: "Key Vocabulary", rows: vocabularyRows };
    }

    return section;
  });

  const draft: AssignmentDraft = {
    title: row.title,
    subtitle: row.subtitle ?? "",
    instructions: [
      "Show all working clearly — a correct final answer with no working shown will not receive full marks.",
      "Unless told otherwise, give non-exact numerical answers to 3 significant figures.",
    ],
    sections,
    ...(row.course ? { course: row.course } : {}),
    ...(row.syllabus_topics && row.syllabus_topics.length > 0
      ? { syllabusTopics: row.syllabus_topics.join(", ") }
      : {}),
    ...(row.prerequisites && row.prerequisites.length > 0
      ? { prerequisites: row.prerequisites.join("; ") }
      : {}),
    ...(row.materials ? { materials: row.materials } : {}),
    ...(row.atl_statement ? { atl: row.atl_statement } : {}),
    ...(tokProvocations.length > 0 ? { tokProvocations } : {}),
  };

  return draft;
}

/** Total question count across all parts — used to populate assignmentInput.questionCount. */
export function countQuestions(row: NuancedAnalysisRow): number {
  return (row.parts ?? []).reduce((sum, part) => sum + (part.questions?.length ?? 0), 0);
}
