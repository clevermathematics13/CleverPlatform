/**
 * nuanced-analysis-bridge.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts a row from the `nuanced_analyses` table (written by the Claude
 * Sonnet 5 packet generator at app/api/generate-packet) into the
 * AssignmentDraft shape used by Assignment Studio's editor
 * (app/dashboard/assignments/editor/[id]) and its working HTML+Puppeteer PDF
 * pipeline (document-orchestrator.ts).
 *
 * This is a deliberately lossy bridge in a couple of places:
 *  - teacher_companion's three fields (answer / mark_scheme / pedagogy_note)
 *    collapse into AssignmentQuestion's single .answer string, since that's
 *    the only slot the target schema has for per-question teacher content.
 *  - Original q_number labels ("1a", "1b"...) are dropped in favor of the
 *    target system's own sequential numbering (formatQuestionLabel) — the
 *    target schema has no field for a custom label.
 *  - vocabulary is packet-level in the source but section-level
 *    (translationTable) in the target, so it's attached once, to the first
 *    section, rather than duplicated across every part.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AssignmentDraft, AssignmentSection, AssignmentQuestion } from "./assignments";

export interface NuancedAnalysisRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  course: string | null;
  syllabus_topics: string[] | null;
  prerequisites: string[] | null;
  materials: string | null;
  vocabulary: Array<{ student_speak: string; ib_rigor: string }> | null;
  atl_statement: string | null;
  tok_provocations: string[] | null;
  parts:
    | Array<{
        part_number: number;
        title: string;
        content: string;
        questions: Array<{ q_number: string; text: string; marks: number }>;
      }>
    | null;
  teacher_companion:
    | Array<{
        q_number: string;
        answer: string;
        mark_scheme: string;
        pedagogy_note: string;
      }>
    | null;
}

function buildTeacherCompanionLookup(
  teacherCompanion: NuancedAnalysisRow["teacher_companion"]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const tc of teacherCompanion ?? []) {
    const pieces = [
      tc.answer ? `Answer: ${tc.answer}` : "",
      tc.mark_scheme ? `Mark scheme: ${tc.mark_scheme}` : "",
      tc.pedagogy_note ? `Common error: ${tc.pedagogy_note}` : "",
    ].filter(Boolean);
    if (pieces.length > 0) map.set(tc.q_number, pieces.join("\n\n"));
  }
  return map;
}

export function convertNuancedAnalysisToDraft(row: NuancedAnalysisRow): AssignmentDraft {
  const teacherCompanionByQNumber = buildTeacherCompanionLookup(row.teacher_companion);
  const vocabulary = row.vocabulary ?? [];
  const parts = [...(row.parts ?? [])].sort((a, b) => a.part_number - b.part_number);

  const sections: AssignmentSection[] = parts.map((part, index) => {
    const questions: AssignmentQuestion[] = (part.questions ?? []).map((q) => ({
      prompt: q.text,
      marks: q.marks,
      ...(teacherCompanionByQNumber.has(q.q_number)
        ? { answer: teacherCompanionByQNumber.get(q.q_number) }
        : {}),
    }));

    const section: AssignmentSection = {
      heading: `Part ${part.part_number} — ${part.title}`,
      questions,
      ...(part.content ? { spotlight: { title: "Overview", body: part.content } } : {}),
    };

    // Vocabulary has no per-part home in the source schema — attach it once,
    // to the first section, as a "Key Vocabulary" translation table, rather
    // than duplicating it (or arbitrarily picking a different part) for every
    // section.
    if (index === 0 && vocabulary.length > 0) {
      section.translationTable = {
        caption: "Key Vocabulary",
        rows: vocabulary.map((v) => ({ informal: v.student_speak, formal: v.ib_rigor })),
      };
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
    ...(row.tok_provocations && row.tok_provocations.length > 0
      ? {
          tokProvocations: row.tok_provocations.map((body, i) => ({
            id: `tok-${i + 1}`,
            body,
          })),
        }
      : {}),
  };

  return draft;
}

/** Total question count across all parts — used to populate assignmentInput.questionCount. */
export function countQuestions(row: NuancedAnalysisRow): number {
  return (row.parts ?? []).reduce((sum, part) => sum + (part.questions?.length ?? 0), 0);
}
