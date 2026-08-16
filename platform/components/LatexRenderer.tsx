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

// --- Line-first grouping -----------------------------------------------------
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
        out.push(BRACKET_A + LETTER_TOKEN + CLOSE_PAREN + EN2 + BRACKET_A + ROMAN_TOKEN + CLOSE_PAREN + EN2 + CONTENT);
        i = k + 1;
        continue;
      }
      const contentLine = j < lines.length ? lines[j].trim() : "";
      out.push(`(${letterMatch[1]}) ${contentLine}`);
      i = j + 1;
      continue;
    }

    if (isRoman) {
      let k = i + 1;
      while (k < lines.length && lines[k].trim() === "") k++;
      const contentLine = k < lines.length ? lines[k].trim() : "";
      out.push(`  (${trimmed.slice(1, -1)}) ${contentLine}`);
      i = k + 1;
      continue;
    }

    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}
