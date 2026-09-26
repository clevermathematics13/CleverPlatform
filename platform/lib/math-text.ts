/**
 * Mixed prose-and-mathematics text, split into the pieces a renderer treats
 * differently: prose, inline maths ($...$) and display maths ($$...$$).
 *
 * The student mark scheme's worked explanations (lib/mark-scheme-explanation.ts)
 * are written in this form, and they are rendered in two places -- on the
 * server for the parts of a card that are always visible, and in the browser
 * for the "Explain more" slides a student opens -- so this module imports
 * nothing. In particular not KaTeX: only lib/tex-render.ts loads it, which is
 * what keeps it out of the self-grade form's first download.
 *
 * The rules are the ones the rest of the platform already writes by:
 *
 *  - `\$` is a literal dollar sign (a price), never a delimiter;
 *  - inline maths does not open or close on whitespace, so a bare "$28 ...
 *    $16" in prose stays prose (lib/document-orchestrator.ts renderMath);
 *  - inline maths does not run across a line break, so one missing dollar
 *    swallows a line at worst, never the rest of the text;
 *  - `**bold**` in prose is bold. Nothing else is markup.
 */

export type MathSegment =
  | { kind: "text"; text: string }
  | { kind: "inline"; tex: string }
  | { kind: "display"; tex: string };

/** Splits `src` into prose and maths, in order. Unmatched delimiters are prose. */
export function splitMathText(src: string): MathSegment[] {
  const out: MathSegment[] = [];
  let text = "";
  const flushText = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\" && src[i + 1] === "$") {
      text += "$";
      i += 2;
      continue;
    }

    if (ch === "$" && src[i + 1] === "$") {
      const end = findClosing(src, i + 2, "$$", true);
      if (end > i + 2 && src.slice(i + 2, end).trim() !== "") {
        flushText();
        out.push({ kind: "display", tex: src.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
      text += "$$";
      i += 2;
      continue;
    }

    if (ch === "$") {
      const end = findClosing(src, i + 1, "$", false);
      if (end > i + 1) {
        const inner = src.slice(i + 1, end);
        if (!/^\s/.test(inner) && !/\s$/.test(inner)) {
          flushText();
          out.push({ kind: "inline", tex: inner });
          i = end + 1;
          continue;
        }
      }
      text += "$";
      i += 1;
      continue;
    }

    text += ch;
    i += 1;
  }

  flushText();
  return out;
}

/**
 * Where the maths that opened just before `from` closes, or -1. A backslash
 * inside maths escapes the next character, so `\$` there is a dollar sign in
 * the maths, and `\\` (a LaTeX line break) does not hide the delimiter after it.
 */
function findClosing(src: string, from: number, delimiter: "$" | "$$", multiline: boolean): number {
  let j = from;
  while (j < src.length) {
    const c = src[j];
    if (!multiline && c === "\n") return -1;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (delimiter === "$$") {
      if (c === "$" && src[j + 1] === "$") return j;
    } else if (c === "$") {
      // "$a$$b$" is not a thing anyone writes; a "$$" inside inline maths is
      // an unclosed inline span running into display maths, so stop.
      return src[j + 1] === "$" ? -1 : j;
    }
    j += 1;
  }
  return -1;
}

/** Every piece of maths in `src`, with whether it is display maths. */
export function mathSpans(src: string): { tex: string; display: boolean }[] {
  return splitMathText(src).flatMap((seg) =>
    seg.kind === "text" ? [] : [{ tex: seg.tex, display: seg.kind === "display" }],
  );
}

/** The prose of `src` with every piece of maths removed -- what a check for
 *  wording (marking codes, forbidden words) should read, since a letter and
 *  a digit side by side are ordinary inside maths. */
export function proseOnly(src: string): string {
  return splitMathText(src)
    .map((seg) => (seg.kind === "text" ? seg.text : " "))
    .join("");
}

/** The words a screen reader or a caption should read for `src`: the prose
 *  as written and each piece of maths as its source, without delimiters. */
export function plainText(src: string): string {
  return splitMathText(src)
    .map((seg) => (seg.kind === "text" ? seg.text.replace(/\*\*/g, "") : seg.tex))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const AMP = String.fromCharCode(38);

/** Prose as HTML: escaped, `**bold**` made bold, line breaks kept. */
export function proseHtml(text: string): string {
  const escaped = text
    .replace(/&/g, `${AMP}amp;`)
    .replace(/</g, `${AMP}lt;`)
    .replace(/>/g, `${AMP}gt;`)
    .replace(/"/g, `${AMP}quot;`)
    .replace(/'/g, `${AMP}#39;`);
  // Only a matched pair is bold; a lone "**" stays as written.
  const bolded = escaped.replace(/\*\*(\S(?:[^*]*?\S)?)\*\*/g, "<strong>$1</strong>");
  return bolded.replace(/\n/g, "<br/>");
}
