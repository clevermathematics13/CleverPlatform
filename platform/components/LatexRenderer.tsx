"use client";

import katex from "katex";
import React from "react";

interface Props {
  /** Raw string, may contain \(...\) inline math and \[...\] display math.
   *  Everything outside delimiters is rendered as plain text. */
  latex: string;
  className?: string;
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
function renderTextLine(line: string, key: string | number): React.ReactNode {
  if (line.includes("\\hfill")) {
    const hfillIdx = line.indexOf("\\hfill");
    const before = line.slice(0, hfillIdx).trim();
    const markCode = line.slice(hfillIdx + 7).trim(); // 7 = "\\hfill".length
    return (
      <span key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1em" }}>
        <span>{before || null}</span>
        <span style={{ fontStyle: "italic", color: "#374151", flexShrink: 0 }}>{markCode}</span>
      </span>
    );
  }
  return line;
}

export default function LatexRenderer({ latex, className }: Props) {
  const segments = splitSegments(latex);

  return (
    <span className={`text-gray-900 ${className ?? ""}`} style={IB_TEXT_STYLE}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          // Split on newlines but skip blank lines to avoid double-spacing
          // between display equations in mark schemes.
          const lines = seg.content.split("\n");
          const nodes: React.ReactNode[] = [];
          lines.forEach((line, j) => {
            // Skip blank lines that only exist to separate equations
            if (line.trim() === "") return;
            nodes.push(renderTextLine(line, `${i}-${j}-line`));
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
