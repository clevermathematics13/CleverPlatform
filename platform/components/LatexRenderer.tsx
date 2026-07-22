"use client";

import katex from "katex";
import React from "react";
import dynamic from "next/dynamic";
import { type IbGraphSpec, GRAPH_MARKER_RE, decodeGraphSpec } from "./IbGraph";

const IbGraph = dynamic(() => import("./IbGraph"), { ssr: false });

interface Props {
  /** Raw string, may contain \(...\) inline math and \[...\] display math.
   *  Everything outside delimiters is rendered as plain text. */
  latex: string;
  className?: string;
  graphImageUrl?: string | null;
  /** When true, strips lines that are purely mark-scheme annotations (A1, M1, Total [N marks])
   *  from the rendered output. Use for question content displays. */
  stripMarkAnnotations?: boolean;
  /** Optional single command term to highlight inline in rendered text. */
  highlightCommandTerm?: string | null;
  /** Optional context/instructional term list to highlight inline in rendered text. */
  highlightContextTerms?: string[];
  /** Optional callback to render attribution next to a specific mark token. */
  renderMarkAttribution?: (tokenLabel: string, ordinal: number) => React.ReactNode;
}

const GRAPH_IMAGE_MARKER = "[[GRAPH_IMAGE]]";
const TABULAR_MARKER_RE = /^\[\[TABULAR_(\d+)\]\]$/;
const NOTE_MARKER_RE = /^\[\[NOTE_(\d+)\]\]$/;
const GRAPH_JSON_LINE_RE = /^\[\[GRAPH_JSON:[A-Za-z0-9+/=]+\]\]$/;

// --- Tabular environment support ---
interface TabularRow { hlineBefore: boolean; cells: string[] }
interface ParsedTabular { colSpec: string; rows: TabularRow[]; trailingHline: boolean }

function parseTabular(colSpec: string, body: string): ParsedTabular {
  const rows: TabularRow[] = [];
  let trailingHline = false;
  for (const rawRow of body.split(/\\\\/)) {
    let row = rawRow.trim();
    const hlineBefore = row.startsWith("\\hline");
    if (hlineBefore) row = row.slice(6).trim();
    if (!row) { if (hlineBefore) trailingHline = true; continue; }
    trailingHline = false;
    rows.push({ hlineBefore, cells: row.split("&").map((c) => c.trim()) });
  }
  return { colSpec, rows, trailingHline };
}

function parseColSpec(spec: string): { aligns: ("l" | "r" | "c")[]; hasBorders: boolean } {
  const aligns = (spec.match(/[lrc]/g) ?? []) as ("l" | "r" | "c")[];
  return { aligns, hasBorders: spec.includes("|") };
}

// Split a string into alternating text / math segments.
// Recognises: \[...\] (display), \(...\) (inline), $$...$$ (display), $...$ (inline).
function splitSegments(
  src: string
): { type: "text" | "inline" | "display"; content: string }[] {
  const re =
    /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]*?)\$/g;
  const segments: { type: "text" | "inline" | "display"; content: string }[] =
    [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(src)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", content: src.slice(last, match.index) });
    }
    const display = match[1] ?? match[3];
    const inline = match[2] ?? match[4];
    if (display !== undefined) {
      segments.push({ type: "display", content: display });
    } else {
      segments.push({ type: "inline", content: inline });
    }
    last = match.index + match[0].length;
  }
  if (last < src.length) {
    segments.push({ type: "text", content: src.slice(last) });
  }
  return segments;
}

// ─── Line-first grouping ─────────────────────────────────────────────────────
//
// splitSegments() above scans the WHOLE preprocessed string in one pass,
// pulling out $...$/$$...$$/\[...\]/\(...\) math wherever it appears and
// leaving text everywhere else — producing a FLAT sequence of independent
// text/inline/display segments with no notion of which ones belong to the
// same physical printed line. That breaks a common source pattern: a line
// like "$\overrightarrow{AB}=...$ (or in column vector form) \hfill (A1)"
// contains inline math followed by a trailing mark code, and both need to
// share ONE right-aligned row — but as independent flat segments, the text
// AFTER the math got its own flex-row wrapper (display:flex is block-level,
// so it forces a line break), stranding the mark code on its own row below
// the equation instead of beside it.
//
// groupSegmentsIntoLines re-groups that flat segment list back into the
// LOGICAL printed lines the source actually has: consecutive text/inline
// pieces up to the next newline (or the next display-math block, which is
// always its own line) become one group. A trailing "\hfill <mark>" found
// in the group's last text piece is pulled out as that group's mark code,
// so the whole group — text, embedded math, and all — can be rendered as a
// single flex row with the mark right-aligned against the end of that row,
// not a new one.
type Piece = { kind: "text"; content: string } | { kind: "inline"; content: string };

type LineGroup =
  | { kind: "content"; pieces: Piece[]; hfillMark: string | null }
  | { kind: "display"; content: string }
  | { kind: "blank" }
  | { kind: "note"; idx: number }
  | { kind: "tabular"; idx: number }
  | { kind: "graph_json"; content: string }
  | { kind: "graph_image" };

function groupSegmentsIntoLines(
  segments: { type: "text" | "inline" | "display"; content: string }[]
): LineGroup[] {
  const groups: LineGroup[] = [];
  let current: Piece[] = [];

  function flush() {
    if (current.length === 0) return;
    // A group consisting of exactly one text piece that is itself a marker
    // placeholder ([[NOTE_n]], [[TABULAR_n]], [[GRAPH_JSON:...]], or the
    // graph-image marker) renders as that special element instead of text.
    if (current.length === 1 && current[0].kind === "text") {
      const trimmed = current[0].content.trim();
      const tabularMatch = trimmed.match(TABULAR_MARKER_RE);
      if (tabularMatch) { groups.push({ kind: "tabular", idx: parseInt(tabularMatch[1], 10) }); current = []; return; }
      const noteMatch = trimmed.match(NOTE_MARKER_RE);
      if (noteMatch) { groups.push({ kind: "note", idx: parseInt(noteMatch[1], 10) }); current = []; return; }
      if (GRAPH_JSON_LINE_RE.test(trimmed)) { groups.push({ kind: "graph_json", content: trimmed }); current = []; return; }
      if (trimmed === GRAPH_IMAGE_MARKER) { groups.push({ kind: "graph_image" }); current = []; return; }
    }
    // A trailing "\hfill <mark>" only ever appears in the LAST piece of a
    // line (mark codes are always the final thing on their line), and only
    // ever in a text piece — inline math never contains \hfill.
    let hfillMark: string | null = null;
    const last = current[current.length - 1];
    if (last.kind === "text" && last.content.includes("\\hfill")) {
      const idx = last.content.indexOf("\\hfill");
      const beforeInLast = last.content.slice(0, idx);
      hfillMark = last.content.slice(idx + 7).trim();
      current = [...current.slice(0, -1), { kind: "text", content: beforeInLast }];
    }
    groups.push({ kind: "content", pieces: current, hfillMark });
    current = [];
  }

  for (const seg of segments) {
    if (seg.type === "display") {
      flush();
      groups.push({ kind: "display", content: seg.content });
      continue;
    }
    if (seg.type === "inline") {
      current.push({ kind: "inline", content: seg.content });
      continue;
    }
    // A text segment may itself span multiple physical lines (contain a
    // newline character); each one is a fresh line boundary relative to
    // whatever was accumulated from segments before it.
    const lines = seg.content.split("\n");
    lines.forEach((line, idx) => {
      if (idx > 0) {
        flush();
        if (line.trim() === "") {
          groups.push({ kind: "blank" });
          return;
        }
      }
      if (line !== "") current.push({ kind: "text", content: line });
    });
  }
  flush();
  return groups;
}

function renderMath(src: string, displayMode: boolean): string {
  try {
    return katex.renderToString(src, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      macros: {
        // Safety net: map legacy / OCR-artifact commands to KaTeX-native equivalents
        "\\bm": "\\boldsymbol",
        "\\mathbf": "\\boldsymbol",
        // IBPart is a custom enumerate environment — KaTeX doesn't know it;
        // silently ignore the environment tags so content still renders.
        "\\IBPart": "",
      },
    });
  } catch {
    return `<span class="text-red-500 font-mono text-xs">${src}</span>`;
  }
}

// Serif font stack that closely matches IB past-paper typesetting.
// Applied to text segments so they harmonise with KaTeX's Computer Modern math.
const IB_TEXT_STYLE: React.CSSProperties = {
  fontFamily: "'Times New Roman', Times, Georgia, serif",
  lineHeight: 1.6,
};

const COMMAND_TERM_SET = new Set([
  "calculate",
  "classify",
  "comment",
  "compare",
  "complete",
  "construct",
  "copy",
  "deduce",
  "demonstrate",
  "describe",
  "determine",
  "differentiate",
  "distinguish",
  "draw",
  "estimate",
  "evaluate",
  "expand",
  "explain",
  "express",
  "factorise",
  "find",
  "give",
  "hence",
  "identify",
  "integrate",
  "interpret",
  "investigate",
  "justify",
  "label",
  "let",
  "list",
  "mark",
  "measure",
  "outline",
  "plot",
  "predict",
  "prove",
  "represent",
  "show",
  "simplify",
  "sketch",
  "solve",
  "state",
  "suggest",
  "trace",
  "using",
  "verify",
  "write down",
]);

/**
 * Render a single line of text, handling \hfill by right-aligning everything
 * after it (used in IB mark schemes to place mark codes like (A1), M1, etc.).
 */
function normalizeComparable(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function renderWithTermHighlights(
  text: string,
  commandTerm: string | null | undefined,
  contextTerms: string[]
): React.ReactNode {
  const cmd = commandTerm?.trim() ?? "";
  const cmdAliases = (() => {
    const n = normalizeComparable(cmd);
    if (!n) return [] as string[];
    if (n === "write down") return [cmd, "Write"];
    if (n === "show") return [cmd, "Show that"];
    return [cmd];
  })();
  const cmdAliasSet = new Set(cmdAliases.map((t) => normalizeComparable(t)).filter(Boolean));
  const cleanedContextTerms = Array.from(new Set(contextTerms.map((t) => t.trim()).filter(Boolean))).filter((t) => normalizeComparable(t) !== normalizeComparable(cmd));
  const cleanedTerms = [...cmdAliases, ...cleanedContextTerms].filter(Boolean).sort((a, b) => b.length - a.length);
  if (cleanedTerms.length === 0) return text;

  const escapedTerms = cleanedTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  const re = new RegExp(`\\b(?:${escapedTerms.join("|")})\\b`, "gi");
  const nodes: React.ReactNode[] = [];

  let last = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = text.slice(match.index, re.lastIndex);
    const tokenNorm = normalizeComparable(token);
    const isCommand =
      cmdAliasSet.has(tokenNorm) || COMMAND_TERM_SET.has(tokenNorm);
    nodes.push(
      <span key={`ct-${keyIdx++}`} className={isCommand ? "font-bold text-red-600" : "font-bold text-blue-600"}>
        {token}
      </span>
    );
    last = re.lastIndex;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes.length > 0 ? <>{nodes}</> : text;
}

/** Expand the private-use-area bold/italic markers inserted by preprocessLatex. */
function renderStyledText(
  text: string,
  commandTerm: string | null | undefined,
  contextTerms: string[]
): React.ReactNode {
  const BOLD_OPEN = "\u{E001}", BOLD_CLOSE = "\u{E002}";
  const ITAL_OPEN = "\u{E003}", ITAL_CLOSE = "\u{E004}";
  const re = new RegExp(`[${BOLD_OPEN}${ITAL_OPEN}]`, "u");
  if (!re.test(text)) return renderWithTermHighlights(text, commandTerm, contextTerms);

  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const boldOpen = remaining.indexOf(BOLD_OPEN);
    const italOpen = remaining.indexOf(ITAL_OPEN);
    const next = boldOpen === -1 ? italOpen : italOpen === -1 ? boldOpen : Math.min(boldOpen, italOpen);
    if (next === -1) {
      nodes.push(renderWithTermHighlights(remaining, commandTerm, contextTerms));
      break;
    }
    if (next > 0) nodes.push(renderWithTermHighlights(remaining.slice(0, next), commandTerm, contextTerms));
    const isBold = remaining[next] === BOLD_OPEN;
    const closeChar = isBold ? BOLD_CLOSE : ITAL_CLOSE;
    const closeIdx = remaining.indexOf(closeChar, next + 1);
    const inner = closeIdx === -1 ? remaining.slice(next + 1) : remaining.slice(next + 1, closeIdx);
    const content = renderWithTermHighlights(inner, commandTerm, contextTerms);
    nodes.push(isBold
      ? <strong key={`s-${key++}`}>{content}</strong>
      : <em key={`s-${key++}`}>{content}</em>
    );
    remaining = closeIdx === -1 ? "" : remaining.slice(closeIdx + 1);
  }
  return <>{nodes}</>;
}

/**
 * Preprocess raw OCR LaTeX before segment-splitting:
 *  1. Remove IB-custom environment tags (IBPart, IBSubPart).
 *  2. Convert standard enumerate/itemize environments to indented plain-text
 *     so the labels appear naturally without raw \begin / \item noise.
 */
const ROMAN_SUBLABEL_RE = /^\((i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\)$/;
const LETTER_LABEL_RE = /^\(([a-z])\)$/;

/**
 * Merge bare part-label lines with the content that follows them.
 *
 * Some extracted/stored question LaTeX represents multi-part questions as a
 * standalone label on its own line (e.g. "(a)" then a blank line then "(i)"
 * then a blank line then the part text) rather than using \item[...]. Left
 * as-is this renders as literal floating "(a)" / "(i)" text with large gaps
 * around it. This pass merges each label with the text that follows it into
 * a single line: a top-level letter label plus its first roman-numeral
 * sub-label and content collapse onto one flush-left line ("(a) (i) ...");
 * a later roman-numeral sub-label under the same letter gets a plain
 * leading-space indent ("  (ii) ..."). Indentation is applied as literal
 * spacing characters rather than a wrapper element, since a line can be
 * split across multiple text/math segments by splitSegments() before
 * rendering — a CSS wrapper around just the first fragment would force a
 * line break before any inline math that follows on the same source line.
 */
function mergeLabelLines(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const isRoman = ROMAN_SUBLABEL_RE.test(trimmed);
    const letterMatch = !isRoman ? LETTER_LABEL_RE.exec(trimmed) : null;

    if (letterMatch) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const romanMatch = j < lines.length ? ROMAN_SUBLABEL_RE.exec(lines[j].trim()) : null;
      if (romanMatch) {
        let k = j + 1;
        while (k < lines.length && lines[k].trim() === "") k++;
        const contentLine = k < lines.length ? lines[k].trim() : "";
        out.push(`(${letterMatch[1]})\u2002(${romanMatch[1]})\u2002${contentLine}`);
        i = k + 1;
        continue;
      }
      const contentLine = j < lines.length ? lines[j].trim() : "";
      out.push(`(${letterMatch[1]})\u2002${contentLine}`);
      i = j + 1;
      continue;
    }

    if (isRoman) {
      let k = i + 1;
      while (k < lines.length && lines[k].trim() === "") k++;
      const contentLine = k < lines.length ? lines[k].trim() : "";
      out.push(`\u2003\u2003(${trimmed.slice(1, -1)})\u2002${contentLine}`);
      i = k + 1;
      continue;
    }

    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

const HFILL_ONLY_LINE_RE = /^\\hfill\b/;

/**
 * Merge a standalone "\hfill (MARK)" line into the end of the line before
 * it, when nothing but blank lines don't separate them.
 *
 * Extracted markscheme LaTeX consistently stores the mark code on its own
 * physical line right after the content it annotates — e.g. an equation
 * line, then "\hfill (A1)" on the next line with no blank in between. Left
 * as separate lines, renderTextLine's \hfill handling (which right-aligns
 * everything after \hfill against whatever precedes it ON THE SAME LINE)
 * has nothing on the left for that line, so the mark renders as its own
 * empty-left, right-aligned row BELOW the content instead of sharing its
 * row — which is why "(A1)" was appearing under the equation rather than
 * beside it. Joining the two lines here means the same line now reads
 * "...content... \hfill (A1)", which the existing per-line \hfill layout
 * already renders correctly as one right-aligned row.
 *
 * Guarded against merging onto a line that already contains \hfill, so two
 * adjacent bare \hfill lines (rare, but possible) don't collapse into one
 * line with two \hfill markers — renderTextLine only looks for the FIRST
 * \hfill on a line, so a second one would be swallowed into the mark text
 * instead of being treated as a separate mark.
 *
 * Must run before extractNoteBlocks/tabular extraction (both happen after
 * preprocessLatex returns): if a [[NOTE_n]] or [[TABULAR_n]] placeholder
 * existed yet, merging a trailing \hfill onto it would break those markers'
 * exact-line-match detection. Since this runs inside preprocessLatex and
 * those markers are only created afterwards, that risk doesn't arise.
 */
function mergeTrailingHfillLines(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const prev = out.length > 0 ? out[out.length - 1] : "";
    if (
      HFILL_ONLY_LINE_RE.test(trimmed) &&
      prev.trim() !== "" &&
      !prev.includes("\\hfill")
    ) {
      out[out.length - 1] = prev + " " + trimmed;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

function preprocessLatex(src: string): string {
  // Remove IB-specific env wrappers.
  // The labelled form carries the part label as a brace argument
  // (\begin{IBPart}{(a)}), so it must be handled BEFORE the bare-tag strip —
  // otherwise only the command is removed and the argument survives as
  // literal "{(a)}" text. Emitting the label on its own line lets
  // mergeLabelLines below fold it inline with the content that follows,
  // which is how the source scans present it.
  let out = src.replace(
    /\\begin\{IB(?:Part|SubPart)\}[ \t]*\{([^}]*)\}/g,
    "\n$1\n",
  );
  out = out.replace(/\\(?:begin|end)\{IB(?:Part|SubPart)\}/g, "");

  // Merge bare part-label lines (e.g. a standalone "(a)" or "(i)" line) with
  // the content that follows, so multi-part questions stored without
  // \item[...] markup still render with inline labels and light indentation
  // instead of the label sitting alone with large gaps around it.
  out = mergeLabelLines(out);
  out = mergeTrailingHfillLines(out);

  // Convert enumerate/itemize content:
  // \item[(label)] → newline + "label " (label already contains parens like (i), (a))
  // \item           → newline + "• "
  out = out.replace(/\\item\[([^\]]*)\]/g, "\n$1\u2002"); // (i), (ii), (a) ...
  out = out.replace(/\\item(?!\[)/g, "\n\u2022\u2002");    // bullet

  // Strip the container environment tags themselves
  out = out.replace(/\\(?:begin|end)\{(?:enumerate|itemize)\}/g, "");

  // Strip \begin{quote}/\end{quote} as a pure structural no-op. Extraction
  // sometimes wraps a markscheme "Note:" callout in a quote environment to
  // represent that it is visually set off in the source scan — but the
  // renderer already draws its own bordered box around Note: paragraphs
  // (see extractNoteBlocks below), so the quote wrapper is redundant and,
  // left unhandled, shows up as literal "\begin{quote}" / "\end{quote}"
  // text since this renderer has no other meaning for that environment.
  out = out.replace(/\\(?:begin|end)\{quote\}\n?/g, "");

  // Convert LaTeX text-mode formatting commands to Unicode/marker equivalents
  // so they render correctly in text segments (outside math mode).
  // We use distinctive markers that won't appear in normal LaTeX.
  out = out.replace(/\\textbf\{([^}]*)\}/g, "\u{E001}$1\u{E002}"); // bold markers
  out = out.replace(/\\textit\{([^}]*)\}/g, "\u{E003}$1\u{E004}"); // italic markers
  out = out.replace(/\\emph\{([^}]*)\}/g, "\u{E003}$1\u{E004}");   // treat \emph same as \textit

  return out;
}

/**
 * Extract IB markscheme "Note:" callouts into a side array, replacing each
 * with a [[NOTE_n]] placeholder line.
 *
 * IB markschemes print these in a bordered box (a distinct visual callout
 * for scorer guidance), but the stored text has no markup distinguishing
 * them from ordinary prose — only the literal "Note:" prefix. This pulls
 * each one out by scanning lines, similar in spirit to how tabular blocks
 * are pulled out below, except a Note has no explicit end delimiter: it
 * runs from a line starting with "Note:" through any immediately
 * following non-blank lines that aren't themselves a new "Note:", and
 * ends at the next blank line (source data does have a handful of notes
 * that wrap across two physical lines with no blank line between them —
 * those need to end up in the same box, not two separate ones).
 */
function extractNoteBlocks(src: string): { text: string; notes: string[] } {
  const lines = src.split("\n");
  const notes: string[] = [];
  const out: string[] = [];
  // Matches "Note:" whether it arrived as bare text or was already wrapped
  // in \textbf{Note:} by the extraction model — preprocessLatex converts
  // \textbf{} to a private-use bold-open marker before this runs, so a
  // literal "Note:" test alone would miss that case entirely.
  const NOTE_START_RE = /^\u{E001}?Note:/u;
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (NOTE_START_RE.test(trimmed)) {
      const blockLines: string[] = [trimmed];
      let j = i + 1;
      while (j < lines.length) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed === "" || /^Note:/.test(nextTrimmed)) break;
        blockLines.push(nextTrimmed);
        j++;
      }
      const idx = notes.length;
      notes.push(blockLines.join("\n"));
      out.push(`[[NOTE_${idx}]]`);
      i = j;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return { text: out.join("\n"), notes };
}

/**
 * Matches a leading "Note:" prefix in EITHER form it can arrive in: bare
 * text, or already wrapped in \textbf{Note:} by the extraction model (which
 * preprocessLatex converts to the private-use bold-open/close marker pair
 * before this ever runs). Used to strip the prefix — see renderNoteBox.
 */
const NOTE_PREFIX_RE = /^\u{E001}?Note:\u{E002}?\s*/u;

/**
 * Render one extracted note in a bordered box, matching the IB source
 * convention.
 *
 * CRITICAL: the "Note:" prefix must be stripped and rendered as a plain
 * React element here, OUTSIDE the recursive LatexRenderer call below —
 * never pass content that still starts with "Note:" (bare or bold-marked)
 * into that recursive call. An earlier version bolded the prefix in place
 * and passed the WHOLE string (still starting with "Note:") to a nested
 * <LatexRenderer>, whose own extractNoteBlocks pass would then detect that
 * SAME "Note:" prefix again and box it again — and since the content is
 * identical on every pass, this recurses forever and freezes the page.
 * Verified fixed by simulating the exact recursive chain: with the prefix
 * stripped first, the remaining content never again matches the note-start
 * pattern, so the recursion terminates after exactly one level.
 */
function renderNoteBox(noteContent: string, key: string | number): React.ReactNode {
  const rest = noteContent.replace(NOTE_PREFIX_RE, "");
  return (
    <div
      key={key}
      style={{
        display: "block",
        border: "1px solid #374151",
        borderRadius: "2px",
        padding: "6px 10px",
        margin: "6px 0",
      }}
    >
      <strong>Note:</strong> <LatexRenderer latex={rest} />
    </div>
  );
}

export default function LatexRenderer({ latex, className, graphImageUrl, stripMarkAnnotations, highlightCommandTerm, highlightContextTerms, renderMarkAttribution }: Props) {
  const MARK_LINE = /^(?:\\hfill\s*)?(?:\s*[\(\[]?(?:A|M|R|N)\d*[\)\]]?\s*)+$|^Total\s+\[\d+\s+marks?\]\s*$|^\[\d+\s+marks?\]\s*$/i;
  function applyStrip(src: string): string {
    if (!stripMarkAnnotations) return src;
    return src.split("\n").filter((line) => { const t = line.trim(); return t === "" || !MARK_LINE.test(t); }).join("\n");
  }
  const { text: withNoteMarkers, notes: noteStore } = extractNoteBlocks(
    preprocessLatex(applyStrip(latex)),
  );
  const tabularStore: ParsedTabular[] = [];
  const preprocessed = withNoteMarkers.replace(
    /\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g,
    (_, colSpec: string, body: string) => {
      const idx = tabularStore.length;
      tabularStore.push(parseTabular(colSpec, body));
      return `[[TABULAR_${idx}]]`;
    }
  );
  const segments = splitSegments(preprocessed);
  const groups = groupSegmentsIntoLines(segments);
  const contextTermsToHighlight = (highlightContextTerms ?? []).filter(Boolean);

  // Shared counter for the entire render pass so that ordinals match parseMSTokens
  const tokenCounter = { count: 0 };

  function renderTabularTable(tabular: ParsedTabular, key: string | number): React.ReactNode {
    const { aligns, hasBorders } = parseColSpec(tabular.colSpec);
    const alignMap: Record<string, React.CSSProperties["textAlign"]> = { l: "left", r: "right", c: "center" };
    const border = hasBorders ? "1px solid #374151" : undefined;
    return (
      <table
        key={key}
        style={{ borderCollapse: "collapse", margin: "0.5em 0",
          fontFamily: "'Times New Roman', Times, Georgia, serif", fontSize: "inherit" }}
      >
        <tbody>
          {tabular.rows.map((row, ri) => (
            <tr key={ri}>
              {row.cells.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "3px 10px",
                    textAlign: alignMap[aligns[ci] ?? "l"] ?? "left",
                    borderLeft: border,
                    borderRight: ci === row.cells.length - 1 ? border : undefined,
                    borderTop: row.hlineBefore ? border : undefined,
                    borderBottom: tabular.trailingHline && ri === tabular.rows.length - 1 ? border : undefined,
                  }}
                >
                  <LatexRenderer latex={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  /** Render every piece (text and embedded inline math, in source order) of a content group. */
  function renderPieces(pieces: Piece[]): React.ReactNode {
    return pieces.map((p, idx) =>
      p.kind === "inline"
        ? <span key={idx} dangerouslySetInnerHTML={{ __html: renderMath(p.content, false) }} />
        : <React.Fragment key={idx}>{renderStyledText(p.content, highlightCommandTerm ?? null, contextTermsToHighlight)}</React.Fragment>
    );
  }

  /**
   * Render one "content" group — a logical printed line's worth of text and
   * embedded inline math, with an optional trailing mark code.
   *
   * When a mark code IS present, the whole group renders as a single flex
   * row (left: every piece of the line, in order; right: the mark), so an
   * equation followed by "(or in column vector form) \hfill (A1)" shares
   * one row with the mark right-aligned against its end — the row is built
   * from the group as a whole rather than from one trailing text segment,
   * which is what let the mark end up stranded on its own line before.
   */
  function renderContentGroup(group: Extract<LineGroup, { kind: "content" }>, key: string | number): React.ReactNode {
    if (group.hfillMark === null) {
      // No mark on this line. Still need the old "bare mark token at EOL with
      // no \hfill" case (e.g. a stray trailing "(A2)") — only applies when
      // the group is a single plain-text piece, matching the original
      // single-string renderTextLine's exact scope for this branch.
      if (renderMarkAttribution && group.pieces.length === 1 && group.pieces[0].kind === "text") {
        const line = group.pieces[0].content;
        const TOKEN_RE = /\((([MAR][1-9])+)\)\s*$|\b(([MAR][1-9])+)\b\s*$/g;
        let m: RegExpExecArray | null;
        let found = false;
        const attributions: React.ReactNode[] = [];
        while ((m = TOKEN_RE.exec(line)) !== null) {
          found = true;
          const label = (m[1] ?? m[3]) as string;
          attributions.push(
            <span key={`attr-${tokenCounter.count}`} style={{ marginLeft: "0.5em" }}>
              {renderMarkAttribution(label, tokenCounter.count)}
            </span>
          );
          tokenCounter.count++;
        }
        if (found) {
          return (
            <React.Fragment key={key}>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1em" }}>
                <span>{renderStyledText(line, highlightCommandTerm ?? null, contextTermsToHighlight)}</span>
              </span>
              <span style={{ display: "flex", justifyContent: "flex-end", gap: "0.25em", marginBottom: "0.25em" }}>
                {attributions}
              </span>
            </React.Fragment>
          );
        }
      }
      return <React.Fragment key={key}>{renderPieces(group.pieces)}</React.Fragment>;
    }

    const markCode = group.hfillMark;
    // If the part before \hfill is itself a mark code (e.g. "A1", "(M1)"),
    // group it with the right-side code rather than showing it as left
    // content — only meaningful when the "before" content is plain text with
    // nothing else (matches the original single-string check).
    const soleTextPiece = group.pieces.length === 1 && group.pieces[0].kind === "text" ? group.pieces[0].content.trim() : null;
    const isMarkCode = soleTextPiece !== null && /^\(?[A-Z]{1,2}\d*\)?$/.test(soleTextPiece);

    // Reconstruct a "virtual line" of the group's text content (dropping
    // math, which never contains mark tokens) to run the SAME attribution
    // token regex the original single-string renderTextLine used, so
    // ordinals stay aligned with parseMSTokens exactly as before.
    const attributions: React.ReactNode[] = [];
    if (renderMarkAttribution) {
      const virtualLine =
        group.pieces.filter((p): p is Extract<Piece, { kind: "text" }> => p.kind === "text").map((p) => p.content).join("") +
        " \\hfill " + markCode;
      const TOKEN_RE = /\\hfill\s+\(?(([MAR][1-9])+)\)?|\((([MAR][1-9])+)\)\s*$|\b(([MAR][1-9])+)\b\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE.exec(virtualLine)) !== null) {
        const label = (m[1] ?? m[3] ?? m[5]) as string;
        attributions.push(
          <span key={`attr-${tokenCounter.count}`} style={{ marginLeft: "0.5em" }}>
            {renderMarkAttribution(label, tokenCounter.count)}
          </span>
        );
        tokenCounter.count++;
      }
    }

    return (
      <React.Fragment key={key}>
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1em" }}>
          <span>{isMarkCode ? null : renderPieces(group.pieces)}</span>
          <span style={{ fontStyle: "italic", color: "#374151", flexShrink: 0 }}>
            {isMarkCode ? `${soleTextPiece} ${markCode}` : markCode}
          </span>
        </span>
        {attributions.length > 0 && (
          <span style={{ display: "flex", justifyContent: "flex-end", gap: "0.25em", marginBottom: "0.25em" }}>
            {attributions}
          </span>
        )}
      </React.Fragment>
    );
  }

  const nodes: React.ReactNode[] = [];
  // Whether the last GROUP emitted was ordinary text content, as opposed to
  // display math or a marker element (note/tabular/graph) — mirrors the old
  // prevLineWasText/prevSegWasDisplay pairing, now tracked once per group
  // instead of once per raw newline-split line, since grouping already
  // resolved which pieces belong to the same logical line.
  //
  // Rule (unchanged from before):
  //   blank line after display math / a marker → suppress (equation or
  //     element separator, not a meaningful paragraph break)
  //   blank line after text                    → emit <br>
  let prevLineWasText = true;
  groups.forEach((g, i) => {
    if (g.kind === "blank") {
      if (prevLineWasText) nodes.push(<br key={`${i}-blank-br`} />);
      // prevLineWasText unchanged — the blank line itself is neutral.
      return;
    }
    if (g.kind === "display") {
      // KaTeX's stylesheet renders all math at 1.21x the surrounding font
      // size (.katex { font: normal 1.21em ... }), which makes display
      // blocks visibly larger than the body text — unlike IB source
      // documents, where displayed equations are typeset at body-text
      // size. 1/1.21 ≈ 0.826em on the wrapper cancels that factor so
      // display math matches the surrounding text, mirroring the source
      // image. (Inline math is left at KaTeX's default — at small sizes
      // the slight upscale aids readability of sub/superscripts and it
      // sits inside a text line, so it doesn't read as oversized.)
      nodes.push(
        <span
          key={i}
          className="block my-1 overflow-x-auto"
          style={{ fontSize: "0.826em" }}
          dangerouslySetInnerHTML={{ __html: renderMath(g.content, true) }}
        />
      );
      prevLineWasText = false;
      return;
    }
    if (g.kind === "note") {
      if (noteStore[g.idx] !== undefined) nodes.push(renderNoteBox(noteStore[g.idx], `${i}-note`));
      prevLineWasText = false;
      return;
    }
    if (g.kind === "tabular") {
      if (tabularStore[g.idx]) nodes.push(renderTabularTable(tabularStore[g.idx], `${i}-tabular`));
      prevLineWasText = false;
      return;
    }
    if (g.kind === "graph_json") {
      GRAPH_MARKER_RE.lastIndex = 0;
      const gm = GRAPH_MARKER_RE.exec(g.content);
      if (gm) {
        const spec: IbGraphSpec | null = decodeGraphSpec(gm[1]);
        if (spec) nodes.push(<IbGraph key={`${i}-graph-json`} spec={spec} />);
      }
      prevLineWasText = false;
      return;
    }
    if (g.kind === "graph_image") {
      nodes.push(
        graphImageUrl ? (
          <img
            key={`${i}-graph`}
            src={graphImageUrl}
            alt="Graph image"
            className="block my-2 max-w-full h-auto border border-gray-200 rounded"
          />
        ) : (
          <span key={`${i}-graph-placeholder`} className="text-gray-500 italic">
            [Graph image]
          </span>
        )
      );
      // Matches old behaviour: graph_image gets an automatic trailing break
      // when the next group isn't itself blank (which would supply its own).
      const nextIsBlank = i < groups.length - 1 && groups[i + 1].kind === "blank";
      if (i < groups.length - 1 && !nextIsBlank) nodes.push(<br key={`${i}-graph-br`} />);
      prevLineWasText = false;
      return;
    }
    // g.kind === "content"
    nodes.push(renderContentGroup(g, `${i}-content`));
    const nextIsBlank = i < groups.length - 1 && groups[i + 1].kind === "blank";
    if (i < groups.length - 1 && !nextIsBlank) nodes.push(<br key={`${i}-content-br`} />);
    prevLineWasText = true;
  });

  return (
    <span className={`text-gray-900 ${className ?? ""}`} style={IB_TEXT_STYLE}>
      {nodes}
    </span>
  );
}
