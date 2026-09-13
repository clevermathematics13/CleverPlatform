/**
 * Splitting a trailing "\hfill <mark>" off a line of LaTeX.
 *
 * Lives here rather than inside LatexRenderer.tsx so it can be tested without
 * a DOM: the renderer is a React component and this repo's Vitest setup has no
 * jsdom, so logic buried in the component is logic nothing can check.
 *
 * The bug this exists to prevent: the original did `slice(idx + 7)`, which
 * skips "\hfill" (six characters) PLUS one more on the assumption that a space
 * always follows. It does not. A LaTeX control word ends at the first
 * non-letter, so "\hfill[6]" is exactly as valid as "\hfill [6]" -- and the
 * generated practice questions emit both. The fixed-7 slice ate the opening
 * bracket and the tariff rendered as "6]".
 */

const HFILL = "\\hfill";

export interface HfillSplit {
  /** Everything before the \hfill, unchanged. */
  before: string;
  /** The mark text after it, trimmed; null when the line has no \hfill. */
  mark: string | null;
}

/**
 * Splits at the FIRST \hfill, matching the renderer's layout rule that a line
 * has at most one right-aligned mark. A "\hfill" immediately followed by a
 * letter is a different command (there is none in LaTeX starting "\hfill", but
 * matching the control-word rule rather than a prefix keeps this honest) and
 * is left alone.
 */
export function splitHfillMark(content: string): HfillSplit {
  let idx = -1;
  for (let at = content.indexOf(HFILL); at !== -1; at = content.indexOf(HFILL, at + 1)) {
    const next = content[at + HFILL.length];
    if (next === undefined || !/[a-zA-Z]/.test(next)) {
      idx = at;
      break;
    }
  }
  if (idx === -1) return { before: content, mark: null };

  return {
    before: content.slice(0, idx),
    mark: content.slice(idx + HFILL.length).trim(),
  };
}

/**
 * The tariff form the renderer lays out correctly: "\hfill [n]" at the end of
 * the text it belongs to. Generated questions are normalised to this before
 * they are stored, so the three spellings a model reaches for -- bare inline,
 * bare on its own line, and \hfill with no space -- all end up rendering the
 * same way.
 */
export function canonicalTariff(marks: number): string {
  return `\\hfill [${marks}]`;
}

/**
 * Replace maths spans with same-length filler, so a "[n]" inside them can
 * never be mistaken for a tariff. Offsets are preserved, which is what lets a
 * match found in the mask index straight back into the original line.
 */
function maskMaths(line: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return line.replace(/\\\[[\s\S]*?\\\]/g, blank).replace(/\$[^$]*\$/g, blank);
}

// Both lookbehinds keep these rewrites idempotent: a tariff that already
// carries \hfill must not collect a second one. That matters because the
// generator normalises on every parse and a teacher's edit is re-normalised,
// so the same text goes through here more than once.
const TRAILING_TARIFF = /(?<!\\hfill )\[(\d+)\]\s*$/;
const PART_END_TARIFF = /(?<!\\hfill )\[(\d+)\](\s*)\\end\{IBPart\}/g;

/** "[n] \end{IBPart}" -> "\hfill [n] \end{IBPart}", outside maths only. */
function hfillBeforePartEnd(line: string): string {
  const mask = maskMaths(line);
  const edits: { at: number; len: number; marks: string; gap: string }[] = [];
  PART_END_TARIFF.lastIndex = 0;
  for (let m = PART_END_TARIFF.exec(mask); m !== null; m = PART_END_TARIFF.exec(mask)) {
    edits.push({ at: m.index, len: m[0].length, marks: m[1], gap: m[2] });
  }
  let result = line;
  for (const e of edits.reverse()) {
    result =
      result.slice(0, e.at) +
      `\\hfill [${e.marks}]${e.gap}\\end{IBPart}` +
      result.slice(e.at + e.len);
  }
  return result;
}

/**
 * Rewrite every mark tariff in a generated question to `\hfill [n]`.
 *
 * The authoring guide asks for this form, but a guide is a request and this is
 * a guarantee -- the first thirteen generated questions came back with four
 * different spellings between them and sixteen of twenty-six tariffs rendered
 * wrongly: bare ones sat mid-sentence, ones alone on a line rendered
 * left-aligned under the question, and `\hfill[6]` lost its bracket.
 *
 * Only touches text outside display maths, and only a tariff that ends a line
 * or closes an IBPart, so an interval like $[0,3]$ or a spacing argument is
 * never rewritten.
 */
export function normaliseTariffs(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inDisplay = false;

  for (const line of lines) {
    const opens = (line.match(/\\\[/g) || []).length;
    const closes = (line.match(/\\\]/g) || []).length;

    if (inDisplay) {
      out.push(line);
      if (closes > opens) inDisplay = false;
      continue;
    }
    if (opens > closes) {
      out.push(line);
      inDisplay = true;
      continue;
    }

    // A line that is nothing but the tariff renders left-aligned on its own
    // row; \hfill turns the same row into a right-aligned one.
    const alone = line.trim().match(/^\[(\d+)\]$/);
    if (alone) {
      out.push(`\\hfill [${alone[1]}]`);
      continue;
    }

    if (/\\hfill\[/.test(line)) {
      out.push(line.replace(/\\hfill\[(\d+)\]/g, "\\hfill [$1]"));
      continue;
    }

    // A whole question on one physical line puts its tariffs before
    // \end{IBPart} rather than at any line end.
    const work = /\\end\{IBPart\}/.test(line) ? hfillBeforePartEnd(line) : line;

    // No early return on "the line already has \hfill": a line can carry an
    // already-aligned part tariff AND a bare one at its end. The lookbehind in
    // TRAILING_TARIFF is what stops the aligned one being rewritten twice.
    const m = maskMaths(work).match(TRAILING_TARIFF);
    if (m) {
      out.push(`${work.slice(0, m.index).trimEnd()} \\hfill [${m[1]}]`);
      continue;
    }

    out.push(work);
  }

  return out.join("\n");
}
