/**
 * paper-anchor-marks.ts
 * -----------------------------------------------------------------------------
 * The contract between the paper renderer and the layout deriver: an invisible
 * mark printed inside every answer box, naming the part that box belongs to.
 *
 * WHY MARKS AND NOT MEASUREMENT. A paper layout is geometry for one physical
 * printing, and the only moment that geometry is known exactly is the moment
 * the PDF is made. Measuring it afterwards means guessing: a model guesses
 * (badly -- see MODEL_DOWNWARD_BIAS in lib/evidence-crops.ts), a CV pass over a
 * scan guesses, and re-rendering to measure gives the geometry of a DIFFERENT
 * printing than the one the students wrote on. Chromium knows where it put
 * each box, but the DOM cannot say which printed page a box landed on, because
 * pagination happens after layout. So the renderer writes the answer into the
 * page itself and the deriver reads it back out of the finished PDF, where the
 * page each mark sits on is no longer in question.
 *
 * WHY IT IS INVISIBLE AND NOT ABSENT. The mark is white text at the corner of
 * a white answer box: present in the PDF's text layer, absent from the printed
 * page. Nothing a student sees changes.
 *
 * Pure and dependency-free on purpose -- both ends import it, so the encoding
 * can never drift between the paper and the thing that reads the paper.
 * -----------------------------------------------------------------------------
 */

/**
 * ASCII only. A glyph like U+27E6 would depend on the print font having it,
 * and a missing glyph is a .notdef in the text layer -- an invisible mark that
 * cannot be invisible-and-readable is worse than no mark. Doubled so it cannot
 * collide with a mark allocation like "[4]" or with ordinary prose.
 */
const OPEN = "@@";
const CLOSE = "@@";

/** A part with no letter (a question with no subparts) is written "_". */
const NO_PART = "_";

/** Which corner of the box a mark sits in: A(bove-left) and Z (below-right). */
export type AnchorMarkCorner = "A" | "Z";

export interface ParsedAnchorMark {
  corner: AnchorMarkCorner;
  questionNumber: number;
  /** "" for a question with no subparts, matching test_items.part_label. */
  partLabel: string;
  /** Offset of the match in the string it was parsed from. */
  index: number;
}

/**
 * The key naming one part, as it appears between the sentinels: "4b", "7_".
 *
 * question_number and part_label are the natural key test_items is stored
 * under and the one test_item_anchors is keyed on (see
 * buildTestItemsFromSections and the anchors migration), so a mark carries
 * exactly the two fields the anchor needs and nothing that has to be looked up.
 */
export function anchorMarkKey(questionNumber: number, partLabel: string): string {
  const part = partLabel.trim().toLowerCase();
  return `${questionNumber}${part === "" ? NO_PART : part}`;
}

/** The two marks for one answer box, to be placed inside it. */
export function anchorMarkHtml(questionNumber: number, partLabel: string): string {
  const key = anchorMarkKey(questionNumber, partLabel);
  return (
    `<span class="anchor-mark anchor-mark-a">${OPEN}A${key}${CLOSE}</span>` +
    `<span class="anchor-mark anchor-mark-z">${OPEN}Z${key}${CLOSE}</span>`
  );
}

/**
 * The style that makes a mark invisible without moving anything.
 *
 * Absolutely positioned so it is out of flow entirely -- an answer box's
 * height is set by its ruled lines and must not gain a text line's worth of
 * height from being marked. White on the box's near-white fill; `printBackground`
 * does not change text colour, so it stays invisible in the PDF as on paper.
 */
export const ANCHOR_MARK_CSS = `
    .answer-box { position: relative; }
    .anchor-mark {
      position: absolute;
      font-size: 5pt;
      line-height: 1;
      color: #ffffff;
      pointer-events: none;
    }
    .anchor-mark-a { top: 0; left: 0; }
    .anchor-mark-z { bottom: 0; right: 0; }`;

/**
 * Every mark in a page's text, in the order it appears.
 *
 * Takes the page's text CONCATENATED rather than one item at a time: a PDF
 * text layer is free to split a run wherever it likes -- "@@A4b@@" can arrive
 * as three items -- so a per-item match would miss most of them. The caller
 * joins the page's items, matches here, and maps `index` back to whichever
 * item the match started in to get its position.
 */
export function parseAnchorMarks(text: string): ParsedAnchorMark[] {
  const pattern = new RegExp(`${OPEN}([AZ])(\\d+)([a-z]|${NO_PART})${CLOSE}`, "g");
  const out: ParsedAnchorMark[] = [];
  for (const m of text.matchAll(pattern)) {
    out.push({
      corner: m[1] as AnchorMarkCorner,
      questionNumber: Number(m[2]),
      partLabel: m[3] === NO_PART ? "" : m[3],
      index: m.index ?? 0,
    });
  }
  return out;
}
