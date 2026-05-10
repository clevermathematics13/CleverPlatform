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
  /** Optional command term to highlight inline in rendered text (first occurrence only). */
  highlightCommandTerm?: string | null;
}

const GRAPH_IMAGE_MARKER = "[[GRAPH_IMAGE]]";
const TABULAR_MARKER_RE = /^\[\[TABULAR_(\d+)\]\]$/;
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

/**
 * Render a single line of text, handling \hfill by right-aligning everything
 * after it (used in IB mark schemes to place mark codes like (A1), M1, etc.).
 */
function renderWithCommandTermHighlight(
  text: string,
  commandTerm: string | null | undefined,
  state: { used: boolean }
): React.ReactNode {
  if (!commandTerm || state.used) return text;
  const escaped = commandTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  const match = re.exec(text);
  if (!match) return text;
  state.used = true;
  const start = match.index;
  const end = start + match[0].length;
  return (
    <>
      {text.slice(0, start)}
      <span className="font-bold text-red-600">{text.slice(start, end)}</span>
      {text.slice(end)}
    </>
  );
}

function renderTextLine(
  line: string,
  key: string | number,
  commandTerm: string | null | undefined,
  highlightState: { used: boolean }
): React.ReactNode {
  if (line.includes("\\hfill")) {
    const hfillIdx = line.indexOf("\\hfill");
    const before = line.slice(0, hfillIdx).trim();
    const markCode = line.slice(hfillIdx + 7).trim(); // skip \hfill + trailing space
    // If the part before \hfill is itself a mark code (e.g. "A1", "(M1)", "N2", "AG"),
    // group it with the right-side code rather than showing it as left content.
    const isMarkCode = /^\(?[A-Z]{1,2}\d*\)?$/.test(before);
    return (
      <span key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1em" }}>
        <span>{isMarkCode ? null : (before ? renderWithCommandTermHighlight(before, commandTerm, highlightState) : null)}</span>
        <span style={{ fontStyle: "italic", color: "#374151", flexShrink: 0 }}>
          {isMarkCode ? `${before} ${markCode}` : markCode}
        </span>
      </span>
    );
  }
  return renderWithCommandTermHighlight(line, commandTerm, highlightState);
}

/**
 * Preprocess raw OCR LaTeX before segment-splitting:
 *  1. Remove IB-custom environment tags (IBPart, IBSubPart).
 *  2. Convert standard enumerate/itemize environments to indented plain-text
 *     so the labels appear naturally without raw \begin / \item noise.
 */
function preprocessLatex(src: string): string {
  // Remove IB-specific env wrappers
  let out = src.replace(/\\(?:begin|end)\{IB(?:Part|SubPart)\}/g, "");

  // Convert enumerate/itemize content:
  // \item[(label)] → newline + "label " (label already contains parens like (i), (a))
  // \item           → newline + "• "
  out = out.replace(/\\item\[([^\]]*)\]/g, "\n$1\u2002"); // (i), (ii), (a) ...
  out = out.replace(/\\item(?!\[)/g, "\n\u2022\u2002");    // bullet

  // Strip the container environment tags themselves
  out = out.replace(/\\(?:begin|end)\{(?:enumerate|itemize)\}/g, "");

  return out;
}

export default function LatexRenderer({ latex, className, graphImageUrl, stripMarkAnnotations, highlightCommandTerm }: Props) {
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
  const commandTermHighlightState = { used: false };

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
          // Split on newlines but skip blank lines to avoid double-spacing
          // between display equations in mark schemes.
          const lines = seg.content.split("\n");
          const nodes: React.ReactNode[] = [];
          lines.forEach((line, j) => {
            const trimmed = line.trim();
            // Check for tabular marker
            const tabularMatch = trimmed.match(TABULAR_MARKER_RE);
            if (tabularMatch) {
              const idx = parseInt(tabularMatch[1], 10);
              if (tabularStore[idx]) nodes.push(renderTabularTable(tabularStore[idx], `${i}-${j}-tabular`));
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
              return;
            }
            // Skip blank lines that only exist to separate equations
            if (trimmed === "") return;
            nodes.push(renderTextLine(line, `${i}-${j}-line`, highlightCommandTerm, commandTermHighlightState));
            // Add a single line break after non-blank lines (except the last)
            if (j < lines.length - 1) nodes.push(<br key={`${i}-${j}-br`} />);
          });
          return <React.Fragment key={i}>{nodes}</React.Fragment>;
        }
        const html = renderMath(seg.content, seg.type === "display");
        if (seg.type === "display") {
          return (
            <span
              key={i}
              className="block my-1 overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
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
