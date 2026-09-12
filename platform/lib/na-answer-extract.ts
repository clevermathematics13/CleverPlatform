/**
 * na-answer-extract.ts
 * -----------------------------------------------------------------------------
 * Turns the marking rubric into the short answers-only list a student uses to
 * check their own work: the answer, and nothing about how to mark it.
 *
 * Every rule below was found by running it over every anchor and rubric row in
 * the live tables, not by reading the schema. Three things shape it.
 *
 * 1. THERE ARE TWO SOURCES, AND THE TERSER ONE IS PER-BOX. na_rubric_items
 *    owns one key per question; na_anchors.answer_sketch owns one line per
 *    printed answer box, written to fit beside it. On A.1 the sketch is
 *    markedly shorter than the key it belongs to -- Q1 is "(a) 420 (b) 330
 *    (c) 750 (d) 750" against a 99-character key, Q2 is "(a) expr (b) eqn
 *    (c) expr (d) eqn (e) expr." against roughly 200 -- so the sketch is
 *    preferred wherever a packet has one. A.2 has no sketches at all and
 *    falls back to the key, which its author wrote in labelled sections that
 *    cut cleanly (see 2).
 *
 * 2. ONLY SOME KEYS ARE LABELLED. The Binomial and A.2 keys are written
 *    "Answer: ... Mark scheme: ... Common error: ...", so the answer lifts out
 *    exactly. A.1's are not: they are one freeform string per box, with no
 *    marker saying where the answer stops and the advice to the marker begins.
 *    Guessing that boundary would quietly hand a student a marking instruction
 *    ("Accept any observation that...") dressed up as an answer, so this module
 *    does not guess: an unlabelled key is passed through whole.
 *
 * 3. A NULL answer_key MEANS THE QUESTION HAS NO ANSWER TO GIVE. This is the
 *    load-bearing rule, because a sketch alone is not enough to tell an answer
 *    from marking guidance. On A.1 every box whose rubric row has no
 *    answer_key carries a sketch addressed to the marker rather than the
 *    student -- Q3 "Entry conjecture -- any reasonable prediction...", Q4
 *    "Student's own definitions ... self-marked against...", Q29 and Q30 the
 *    same -- and every box that does have an answer_key carries a sketch that
 *    really is the answer. Four out of four, and twenty-eight out of
 *    twenty-eight, on the one packet released to a student. So a row with no
 *    key is reported as open or unmarked and its sketch is never shown.
 *
 * 4. SUBPART BOXES INHERIT THE WHOLE QUESTION'S TEXT. A.1's Q6/Q6(f),
 *    Q7/Q7(b), Q13/Q13(b)/Q13(c), Q19/Q19(b)/Q19(c) and Q26(a)/(b)/(c) each
 *    repeat one string across every box of the question, because that packet
 *    was authored one row per printed box and a box that exists only for page
 *    layout inherited the question's whole entry. Listed verbatim that reads
 *    as the same answer printed three times, so consecutive boxes of one base
 *    question that share an answer collapse into a single line.
 * -----------------------------------------------------------------------------
 */

/**
 * One printed answer box and the rubric entry behind it: the anchor columns
 * on the left, the na_rubric_items columns on the right. A caller working
 * from the rubric alone (no print master, so no boxes) can leave the anchor
 * fields out -- `part_label` and `answer_sketch` are both optional.
 */
export interface RubricAnswerRow {
  qid: string;
  base_qid: string;
  /** na_anchors.part_label, e.g. "Part 2". Part of the label a student sees. */
  part_label?: string | null;
  question_number: number | null;
  /** na_anchors.answer_sketch -- the terse per-box answer, where one exists. */
  answer_sketch?: string | null;
  answer_key: string | null;
  open_rubric: string | null;
  marks: number | null;
}

/** One line of the student-facing answers list. */
export interface AnswerLine {
  /** The label shown to the student, e.g. "Q1", "Q13(b)" or "Q9 (Part 2)". */
  label: string;
  /** The answer, or null when this entry is deliberately unanswered. */
  answer: string | null;
  /**
   * Why there is no answer, when there isn't one. "open" for a question with
   * an open rubric and no single correct answer; "unmarked" for thinking
   * space that carries no marks and no key.
   */
  kind: "answer" | "open" | "unmarked";
  marks: number | null;
}

/**
 * Sections that belong to the teacher, not the student. Cutting at the first
 * of these is safe because each is a literal label the generator writes; a key
 * that never uses one is left alone entirely (see 2 in the header).
 */
const TEACHER_SECTION = /\b(Mark scheme|Common error|Marking note|Misconception tested)\s*:/i;

/** Collapses newlines and runs of spaces so a key reads as one line. */
function oneLine(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed === "" ? null : collapsed;
}

/**
 * The answer from one key, with the teacher-facing sections removed.
 * Returns null when nothing is left, so a caller can distinguish "no answer"
 * from an empty string.
 */
export function extractAnswerOnly(answerKey: string | null | undefined): string | null {
  if (!answerKey) return null;

  const beforeTeacherSections = answerKey.split(TEACHER_SECTION)[0];
  const withoutLabel = beforeTeacherSections.replace(/^\s*Answer\s*:\s*/i, "");

  return oneLine(withoutLabel);
}

/**
 * The answer for one box: the per-box sketch where the packet has one, the
 * key otherwise -- but only where the rubric row has a key at all, which is
 * what distinguishes an answer from guidance to the marker (see 3).
 */
export function answerForRow(row: RubricAnswerRow): string | null {
  if (!row.answer_key) return null;
  return (row.answer_sketch ? oneLine(row.answer_sketch) : null) ?? extractAnswerOnly(row.answer_key);
}

/** The label a student sees, matching the detailed view's label exactly. */
export function answerLabel(row: RubricAnswerRow): string {
  return row.part_label ? `${row.qid} (${row.part_label})` : row.qid;
}

/**
 * The whole answers list for one packet, in printed order.
 *
 * Rows arrive in the order the boxes appear on the page -- na_anchors.sort_order
 * for a scanned packet, question_number then qid for a rubric with no print
 * master. Consecutive boxes of the same base question whose answer is identical
 * collapse to the first of them, keeping that box's label, so A.1's Q6 and
 * Q6(f) become a single "Q6" line rather than the same paragraph twice.
 */
export function buildAnswerList(rows: RubricAnswerRow[]): AnswerLine[] {
  const lines: AnswerLine[] = [];
  let lastEmitted: { row: RubricAnswerRow; answer: string | null } | null = null;

  for (const row of rows) {
    const answer = answerForRow(row);

    // Collapse only against the box immediately before, only within one base
    // question, and only on an exact match: two genuinely different subparts
    // that happen to share a short answer must both still be listed.
    if (
      lastEmitted &&
      answer !== null &&
      lastEmitted.answer === answer &&
      lastEmitted.row.base_qid === row.base_qid
    ) {
      continue;
    }

    lines.push(
      answer !== null
        ? { label: answerLabel(row), answer, kind: "answer", marks: row.marks }
        : {
            label: answerLabel(row),
            answer: null,
            kind: row.open_rubric ? "open" : "unmarked",
            marks: row.marks,
          },
    );
    lastEmitted = { row, answer };
  }

  return lines;
}
