/**
 * Which answer boxes a practice question gets, and what a saved answer means.
 *
 * Pure, so the decision that shapes the whole answer UI can be checked without
 * a browser or a database.
 */

/** The single slot used by a question with no labelled parts. */
export const WHOLE_QUESTION = "";

/**
 * The part labels in a generated question, in the order they appear.
 *
 * `\begin{IBPart}{(a)}` is the only way a generated question may label a part
 * -- the authoring guide mandates it and forbids `enumerate` -- so this reads
 * the labels rather than guessing at "(a)" in prose, which would also match a
 * coordinate or a citation.
 *
 * Returns [""] when there are no parts, so every caller handles exactly one
 * shape: a non-empty list of slots. A scanned bank question has no LaTeX at
 * all and lands here too.
 */
export function answerSlots(questionLatex: string | null): string[] {
  if (!questionLatex) return [WHOLE_QUESTION];

  const labels: string[] = [];
  const re = /\\begin\{IBPart\}\{([^}]*)\}/g;
  for (let m = re.exec(questionLatex); m !== null; m = re.exec(questionLatex)) {
    const label = m[1].trim();
    // A duplicate label would collide on the table's unique key, and two parts
    // both called "(a)" is a question to fix rather than one to answer twice.
    if (label && !labels.includes(label)) labels.push(label);
  }

  return labels.length > 0 ? labels : [WHOLE_QUESTION];
}

/**
 * Whether a slot counts as answered.
 *
 * Whitespace-only is not an answer, and neither is the LaTeX the editor leaves
 * behind when a student types something and deletes it again: MathLive emits
 * an empty group or a lone placeholder rather than an empty string.
 */
export function isAnswered(answerLatex: string | null | undefined): boolean {
  if (!answerLatex) return false;
  const stripped = answerLatex
    .replace(/\\placeholder\s*(\{[^}]*\})?/g, "")
    .replace(/[{}\s]/g, "");
  return stripped.length > 0;
}

export interface AnswerProgress {
  /** Slots with something in them. */
  answered: number;
  /** Slots in the whole set. */
  total: number;
}

/**
 * How far through a set a student is, counted in PARTS rather than questions.
 *
 * Parts, because a nineteen-mark question with five of them is not one
 * thirteenth of the work, and a progress line that says otherwise is the kind
 * that makes a student think they are nearly done when they are not.
 */
export function answerProgress(
  items: { position: number; slots: string[] }[],
  answers: Map<string, string>
): AnswerProgress {
  let answered = 0;
  let total = 0;
  for (const item of items) {
    for (const slot of item.slots) {
      total += 1;
      if (isAnswered(answers.get(answerKey(item.position, slot)))) answered += 1;
    }
  }
  return { answered, total };
}

/**
 * The client-side key for one answer box.
 *
 * Position and label rather than the item's uuid, because the student page
 * builds its map from the rendered view, which is keyed by position. The
 * DATABASE key is (item id, profile, part) -- this one never leaves the
 * browser.
 */
export function answerKey(position: number, partLabel: string): string {
  return `${position}::${partLabel}`;
}

/**
 * How an answer box tells the page it changed.
 *
 * A window event rather than a callback prop, because the practice page is a
 * server component: it renders the progress line and the answer boxes, and it
 * cannot hand a function to either. The alternative was making the whole
 * question list a client component to hold one number.
 */
export const ANSWER_EVENT = "clev:practice-answer";

export interface AnswerEventDetail {
  /** "<practice_set_items.id>::<part label>". */
  key: string;
  answered: boolean;
}
