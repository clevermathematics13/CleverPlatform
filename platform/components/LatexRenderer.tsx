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
const GRAPH_JSON_LINE_RE = /^\[\[GRAPH_JSON:[A-Za-z0-9+/=]+\]\]$/;

// Markers used to tag merged part-label lines (e.g. a standalone "(a)" or
// "(i)" line merged with the text that follows) with their nesting depth, so
// renderTextLine can apply the correct indent. L0 = top-level letter label
// (a), (b), (c)...; L1 = nested roman-numeral sub-label (i), (ii), (iii)...
const LABEL_INDENT_L0 = "\u{E010}";
const LABEL_INDENT_L1 = "\u{E011}";

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

function renderTextLine(
  line: string,
  key: string | number,
  commandTerm: string | null | undefined,
  contextTerms: string[],
  renderMarkAttribution?: (tokenLabel: string, ordinal: number) => React.ReactNode,
  tokenCounter?: { count: number }
): React.ReactNode {
  // A line merged by mergeLabelLines() carries an indent-depth marker at its
  // start (L0 = top-level letter label, L1 = nested roman-numeral sub-label).
  // Strip it, remember the depth, and indent the rendered result at the end.
  let indentLevel = -1;
  let text = line;
  if (line.startsWith(LABEL_INDENT_L0)) {
    indentLevel = 0;
    text = line.slice(LABEL_INDENT_L0.length);
  } else if (line.startsWith(LABEL_INDENT_L1)) {
    indentLevel = 1;
    text = line.slice(LABEL_INDENT_L1.length);
  }

  let result: React.ReactNode;

  if (text.includes("\\hfill")) {
    const hfillIdx = text.indexOf("\\hfill");
    const before = text.slice(0, hfillIdx).trim();
    const markCode = text.slice(hfillIdx + 7).trim(); // skip \hfill + trailing space
    // If the part before \hfill is itself a mark code (e.g. "A1", "(M1)", "N2", "AG"),
    // group it with the right-side code rather than showing it as left content.
    const isMarkCode = /^\(?[A-Z]{1,2}\d*\)?$/.test(before);
    
    // Find all countable tokens in this line to render attributions next to them
    const attributions: React.ReactNode[] = [];
    if (renderMarkAttribution && tokenCounter) {
      const TOKEN_RE = /\\hfill\s+\(?((M1|A1|R1)+)\)?|\(((M1|A1|R1)+)\)\s*$|\b((M1|A1|R1)+)\b\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        const label = (m[1] ?? m[3] ?? m[5]);
        attributions.push(
          <span key={`attr-${tokenCounter.count}`} style={{ marginLeft: "0.5em" }}>
            {renderMarkAttribution(label, tokenCounter.count)}
          </span>
        );
        tokenCounter.count++;
      }
    }

    result = (
      <React.Fragment key={key}>
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1em" }}>
          <span>{isMarkCode ? null : (before ? renderStyledText(before, commandTerm, contextTerms) : null)}</span>
          <span style={{ fontStyle: "italic", color: "#374151", flexShrink: 0 }}>
            {isMarkCode ? `${before} ${markCode}` : markCode}
          </span>
        </span>
        {attributions.length > 0 && (
          <span style={{ display: "flex", justifyContent: "flex-end", gap: "0.25em", marginBottom: "0.25em" }}>
            {attributions}
          </span>
        )}
      </React.Fragment>
    );
  } else {
    // If no \hfill, there could still be a bare mark token at the end of the line
    let bareTokenResult: React.ReactNode | null = null;
    if (renderMarkAttribution && tokenCounter) {
      const TOKEN_RE = /\(((M1|A1|R1)+)\)\s*$|\b((M1|A1|R1)+)\b\s*$/g; // (M1) or bare M1 at EOL
      let m: RegExpExecArray | null;
      let foundBareTokens = false;
      const attributions: React.ReactNode[] = [];
      while ((m = TOKEN_RE.exec(text)) !== null) {
        foundBareTokens = true;
        const label = (m[1] ?? m[3]);
        attributions.push(
          <span key={`attr-${tokenCounter.count}`} style={{ marginLeft: "0.5em" }}>
            {renderMarkAttribution(label, tokenCounter.count)}
          </span>
        );
        tokenCounter.count++;
      }
      if (foundBareTokens) {
        bareTokenResult = (
          <React.Fragment key={key}>
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1em" }}>
              <span>{renderStyledText(text, commandTerm, contextTerms)}</span>
            </span>
            <span style={{ display: "flex", justifyContent: "flex-end", gap: "0.25em", marginBottom: "0.25em" }}>
              {attributions}
            </span>
          </React.Fragment>
        );
      }
    }
    result = bareTokenResult ?? renderStyledText(text, commandTerm, contextTerms);
  }

  if (indentLevel >= 0) {
    return (
      <span key={key} style={{ display: "flex", alignItems: "baseline", gap: "0.5em", marginLeft: `${indentLevel * 1.75}em` }}>
        {result}
      </span>
    );
  }

  return result;
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
 * around it. This pass detects that pattern and merges each label with the
 * text that immediately follows it into a single line, tagged with an
 * indent-depth marker (LABEL_INDENT_L0 for a top-level letter label,
 * LABEL_INDENT_L1 for a nested roman-numeral sub-label) so renderTextLine
 * can lay it out with proper nested indentation, matching how these
 * questions look in the original exam paper.
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
        out.push(`${LABEL_INDENT_L0}(${letterMatch[1]})\u2002${LABEL_INDENT_L1}(${romanMatch[1]})\u2002${contentLine}`);
        i = k + 1;
        continue;
      }
      const contentLine = j < lines.length ? lines[j].trim() : "";
      out.push(`${LABEL_INDENT_L0}(${letterMatch[1]})\u2002${contentLine}`);
      i = j + 1;
      continue;
    }

    if (isRoman) {
      let k = i + 1;
      while (k < lines.length && lines[k].trim() === "") k++;
      const contentLine = k < lines.length ? lines[k].trim() : "";
      out.push(`${LABEL_INDENT_L1}(${trimmed.slice(1, -1)})\u2002${contentLine}`);
      i = k + 1;
      continue;
    }

    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

function preprocessLatex(src: string): string {
  // Remove IB-specific env wrappers
  let out = src.replace(/\\(?:begin|end)\{IB(?:Part|SubPart)\}/g, "");

  // Merge bare part-label lines (e.g. a standalone "(a)" or "(i)" line) with
  // the content that follows, so multi-part questions stored without
  // \item[...] markup still render with inline labels and proper nested
  // indentation instead of the label sitting alone with large gaps around it.
  out = mergeLabelLines(out);

  // Convert enumerate/itemize content:
  // \item[(label)] → newline + "label " (label already contains parens like (i), (a))
  // \item           → newline + "• "
  out = out.replace(/\\item\[([^\]]*)\]/g, "\n$1\u2002"); // (i), (ii), (a) ...
  out = out.replace(/\\item(?!\[)/g, "\n\u2022\u2002");    // bullet

  // Strip the container environment tags themselves
  out = out.replace(/\\(?:begin|end)\{(?:enumerate|itemize)\}/g, "");

  // Convert LaTeX text-mode formatting commands to Unicode/marker equivalents
  // so they render correctly in text segments (outside math mode).
  // We use distinctive markers that won't appear in normal LaTeX.
  out = out.replace(/\\textbf\{([^}]*)\}/g, "\u{E001}$1\u{E002}"); // bold markers
  out = out.replace(/\\textit\{([^}]*)\}/g, "\u{E003}$1\u{E004}"); // italic markers
  out = out.replace(/\\emph\{([^}]*)\}/g, "\u{E003}$1\u{E004}");   // treat \emph same as \textit

  return out;
}

export default function LatexRenderer({ latex, className, graphImageUrl, stripMarkAnnotations, highlightCommandTerm, highlightContextTerms, renderMarkAttribution }: Props) {
  const MARK_LINE = /^(?:\\hfill\s*)?(?:\s*[\(\[]?(?:A|M|R|N)\d*[\)\]]?\s*)+$|^Total\s+\[\d+\s+marks?\]\s*$|^\[\d+\s+marks?\]\s*$/i;
  function applyStrip(src: string): string {
    if (!stripMarkAnnotations) return src;
    return src.split("\n").filter((line) => { const t = line.trim(); return t === "" || !MARK_LINE.test(t); }).join("\n");
  }
  const tabularStore: ParsedTabular[] = [];
  const preprocessed = preprocessLatex(applyStrip(latex)).replace(
    /\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g,
    (_, colSpec: string, body: string) => {
      const idx = tabularStore.length;
      tabularStore.push(parseTabular(colSpec, body));
      return `[[TABULAR_${idx}]]`;
    }
  );
  const segments = splitSegments(preprocessed);
  const contextTermsToHighlight = (highlightContextTerms ?? []).filter(Boolean);
  
  // Shared counter for the entire render pass so that ordinals match parseMSTokens
  const tokenCounter = { count: 0 };

  // Track whether the segment immediately preceding the current one was a
  // display-math block. Used to decide whether a blank text line is a
  // meaningful paragraph break (emit <br>) or just a LaTeX vertical-space
  // separator between equations (suppress).
  //
  // Rule:
  //   blank line after display math  → suppress  (equation separator)
  //   blank line after text          → emit <br> (paragraph / sentence break)
  let prevSegWasDisplay = false;

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

  return (
    <span className={`text-gray-900 ${className ?? ""}`} style={IB_TEXT_STYLE}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          // Split on newlines and process each line.
          //
          // Blank-line handling:
          //   • A blank line that follows a display-math segment is an equation
          //     separator — suppress it (old behaviour, prevents double-spacing).
          //   • A blank line that follows ordinary text is a meaningful paragraph
          //     or sentence break — emit a <br> so the layout matches the source.
          const lines = seg.content.split("\n");
          const nodes: React.ReactNode[] = [];
          // Within this text segment, track whether the last emitted item was
          // a non-blank text line (so we can decide what to do with the next
          // blank line we encounter).
          let prevLineWasText = !prevSegWasDisplay;
          lines.forEach((line, j) => {
            const trimmed = line.trim();
            // Check for tabular marker
            const tabularMatch = trimmed.match(TABULAR_MARKER_RE);
            if (tabularMatch) {
              const idx = parseInt(tabularMatch[1], 10);
              if (tabularStore[idx]) nodes.push(renderTabularTable(tabularStore[idx], `${i}-${j}-tabular`));
              prevLineWasText = false;
              return;
            }
            // [[GRAPH_JSON:<base64>]] — render an IbGraph component
            if (GRAPH_JSON_LINE_RE.test(trimmed)) {
              GRAPH_MARKER_RE.lastIndex = 0;
              const gm = GRAPH_MARKER_RE.exec(trimmed);
              if (gm) {
                const spec: IbGraphSpec | null = decodeGraphSpec(gm[1]);
                if (spec) {
                  nodes.push(<IbGraph key={`${i}-${j}-graph-json`} spec={spec} />);
                  prevLineWasText = false;
                  return;
                }
              }
            }
            if (trimmed === GRAPH_IMAGE_MARKER) {
              nodes.push(
                graphImageUrl ? (
                  <img
                    key={`${i}-${j}-graph`}
                    src={graphImageUrl}
                    alt="Graph image"
                    className="block my-2 max-w-full h-auto border border-gray-200 rounded"
                  />
                ) : (
                  <span key={`${i}-${j}-graph-placeholder`} className="text-gray-500 italic">
                    [Graph image]
                  </span>
                )
              );
              if (j < lines.length - 1) nodes.push(<br key={`${i}-${j}-graph-br`} />);
              prevLineWasText = false;
              return;
            }
            // Blank line:
            //   after display math → suppress (equation gap, not a paragraph break)
            //   after text         → emit <br> (preserve the source line break)
            if (trimmed === "") {
              if (prevLineWasText) {
                nodes.push(<br key={`${i}-${j}-blank-br`} />);
              }
              // Do not update prevLineWasText — the blank line itself is neutral.
              return;
            }
            nodes.push(renderTextLine(line, `${i}-${j}-line`, highlightCommandTerm ?? null, contextTermsToHighlight, renderMarkAttribution, tokenCounter));
            // Add a line break after non-blank lines (except the last in this segment).
            if (j < lines.length - 1) nodes.push(<br key={`${i}-${j}-br`} />);
            prevLineWasText = true;
          });
          // After processing this text segment, the next segment's blank-line
          // decision should treat this as "following text" (not display math).
          prevSegWasDisplay = false;
          return <React.Fragment key={i}>{nodes}</React.Fragment>;
        }
        const html = renderMath(seg.content, seg.type === "display");
        if (seg.type === "display") {
          prevSegWasDisplay = true;
          return (
            <span
              key={i}
              className="block my-1 overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        // inline math — treat like text for blank-line purposes
        prevSegWasDisplay = false;
        return (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}
