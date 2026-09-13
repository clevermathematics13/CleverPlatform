/**
 * rubric-latex.ts
 * -----------------------------------------------------------------------------
 * Turns a rubric field into HTML for the printable answer key at
 * app/api/na-review/rubric/[nuancedAnalysisId], rendering LaTeX with KaTeX
 * where the packet actually uses it and escaping everything otherwise.
 *
 * WHY THIS IS NOT JUST "SPLIT ON $": a dollar sign means two different things
 * in this table, and guessing per-span gets it wrong in both directions.
 *
 *   Sixty Times a Person (A.1), answer key:
 *     "(a) The price of one adult ticket, $60 per adult."
 *   What Undoing Really Means (A.2), question text:
 *     "Shirts cost $18 each and pants cost $25 each."
 *
 * The A.2 example is the dangerous one: its dollars come in an EVEN number,
 * so a plain pair-matching parser reads "18 each and pants cost" as a maths
 * span and renders that sentence as gibberish -- on a packet with 22 scanned
 * student copies whose marks are read against this key.
 *
 * Per-span heuristics were tried against all 169 live rubric fields and failed
 * the other way too: requiring "no English word" inside the span rejects real
 * maths like $(1 + kx)^7$ and $(1 + (\text{something}))^n$, because kx, nx and
 * \text's argument all look like words.
 *
 * So the decision is made ONCE PER PACKET, from two signals that are cheap and
 * hard to fool:
 *
 *   1. every $-bearing field has an EVEN number of unescaped $, so the
 *      delimiters are at least well-formed; and
 *   2. at least one $...$ span contains real LaTeX syntax -- a backslash
 *      command, ^ or _.
 *
 * Prose about money satisfies neither in practice: prices are unbalanced as
 * often as not, and no price contains \binom or ^. Checked against every
 * packet in the table: the Binomial Theorem packet renders, both Grade 9
 * packets stay literal, and the two with no $ at all are unaffected.
 *
 * The failure mode is deliberately asymmetric. Refusing to render leaves the
 * teacher reading LaTeX source, which is ugly but true; rendering wrongly
 * rewrites a marking key into nonsense, which is neither.
 * -----------------------------------------------------------------------------
 */

import katex from "katex";

/** The rubric columns whose text may carry maths or money. */
export const RUBRIC_TEXT_FIELDS = [
  "question_text",
  "answer_key",
  "open_rubric",
  "misconception_context",
  "teacher_notes",
] as const;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Unescaped $ only -- \$ is a literal dollar in LaTeX, not a delimiter. */
const UNESCAPED_DOLLAR = /(?<!\\)\$/g;

/**
 * Does this packet use $ as a maths delimiter, or as a currency symbol?
 *
 * Pass every text field on the packet; the answer applies to all of them, so
 * a teacher never sees half a rubric typeset and half not.
 */
export function packetUsesLatexDelimiters(texts: Array<string | null | undefined>): boolean {
  let sawLatexSyntax = false;

  for (const text of texts) {
    if (!text) continue;
    const dollars = text.match(UNESCAPED_DOLLAR)?.length ?? 0;
    if (dollars === 0) continue;
    // One unbalanced field is enough to disqualify the whole packet: it means
    // at least one $ is not a delimiter, and we cannot tell which.
    if (dollars % 2 !== 0) return false;

    for (const match of text.matchAll(/(?<!\\)\$([^$]*)(?<!\\)\$/g)) {
      if (/[\\^_]/.test(match[1])) sawLatexSyntax = true;
    }
  }

  return sawLatexSyntax;
}

/**
 * Matches the four delimiter styles, longest first so $$ is not read as two
 * empty $ spans. Inline $...$ deliberately refuses to span a newline: an
 * unclosed delimiter should swallow one line at worst, never the rest of a
 * field.
 */
const SEGMENT = /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<!\\)\$([^$\n]*?)(?<!\\)\$/g;

function renderMath(src: string, displayMode: boolean): string {
  const trimmed = src.trim();
  if (trimmed === "") return "";
  try {
    return katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      // Rendered into a standalone page that is printed, not into the app,
      // so there is no surrounding stylesheet to inherit sizing from.
      output: "html",
      strict: false,
    });
  } catch {
    // KaTeX only throws here for genuinely malformed input given
    // throwOnError:false. Show the source rather than an empty gap.
    return escapeHtml(displayMode ? `$$${src}$$` : `$${src}$`);
  }
}

/**
 * Escapes `text` for HTML, rendering maths with KaTeX when `renderLatex` is
 * true. Prose is always escaped; only KaTeX's own output is trusted markup.
 */
export function renderRubricText(text: unknown, renderLatex: boolean): string {
  const src = String(text ?? "");
  if (!renderLatex) return escapeHtml(src);

  let out = "";
  let last = 0;
  SEGMENT.lastIndex = 0;

  for (let m = SEGMENT.exec(src); m !== null; m = SEGMENT.exec(src)) {
    out += escapeHtml(src.slice(last, m.index));
    const [, dd, bracket, paren, inline] = m;
    if (dd !== undefined) out += renderMath(dd, true);
    else if (bracket !== undefined) out += renderMath(bracket, true);
    else if (paren !== undefined) out += renderMath(paren, false);
    else out += renderMath(inline ?? "", false);
    last = m.index + m[0].length;
  }

  out += escapeHtml(src.slice(last));
  // A literal dollar written \$ has served its purpose once the delimiters
  // above are resolved; show it as a dollar sign.
  return out.replace(/\\\$/g, "$");
}
