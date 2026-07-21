/**
 * Visual verification of extracted LaTeX against its source scan.
 *
 * The OCR/extraction pipeline can silently lose or mangle content — a part
 * label that never made it into the text, a markscheme that stops mid-command,
 * a rendering rule that makes displayed equations the wrong size. None of that
 * is visible from the stored string alone; it only shows up when you put the
 * rendered panel and the original scan side by side.
 *
 * This module renders a LaTeX string through the REAL LatexRenderer component
 * (not a reimplementation of it) into a standalone HTML document. A headless
 * browser screenshots that document, and the screenshot is handed to Claude
 * together with the source scan for comparison. Because the same component the
 * teacher sees is what gets screenshotted, genuine renderer bugs — not just
 * data problems — are in scope for the check.
 *
 * Nothing here writes to the database. The API route that drives this returns
 * proposed corrections for a human to review and apply.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LatexRenderer from "@/components/LatexRenderer";

/**
 * Pinned to the katex version in package.json. Loaded from a CDN rather than
 * inlined from node_modules because KaTeX's stylesheet references its webfonts
 * by relative path — served from the CDN those resolve, so the screenshot uses
 * the same glyph metrics the browser does. Fall back to system serif if the
 * CDN is unreachable; the check still works, it just compares slightly
 * different letterforms.
 */
export const KATEX_CSS_URL =
  "https://cdn.jsdelivr.net/npm/katex@0.16.45/dist/katex.min.css";

/**
 * Width of the render harness in CSS pixels. Chosen to approximate the LaTeX
 * panel in Question Studio, which occupies roughly half of the Question Studio
 * modal. Line-wrapping is one of the things being checked, so this width
 * materially affects the comparison and should stay close to the real panel.
 */
export const RENDER_WIDTH_PX = 620;

/**
 * Mirrors the panel's own container styling in ImageSection.tsx:
 *   text-sm        -> 14px
 *   text-gray-800  -> #1f2937
 *   px-3 py-2.5    -> 12px / 10px
 * LatexRenderer sets its own font-family and line-height on its root element,
 * so those are deliberately not specified here — letting the component control
 * them is what keeps the screenshot faithful.
 */
const CONTAINER_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #latex-root {
    width: ${RENDER_WIDTH_PX}px;
    padding: 12px;
    background: #ffffff;
    font-size: 14px;
    color: #1f2937;
  }
`;

/** The element id the screenshot is clipped to. */
export const RENDER_ROOT_ID = "latex-root";

/**
 * Build a standalone HTML document showing `latex` as LatexRenderer would.
 *
 * Throws if the component fails to render (for example if a future change
 * introduces a hook or browser-only API into its render path) — the caller
 * should treat that as a check failure rather than silently comparing a blank
 * screenshot against the source, which would produce a confident and
 * completely wrong "everything is missing" report.
 */
export function buildRenderDocument(latex: string): string {
  const markup = renderToStaticMarkup(
    React.createElement(LatexRenderer, { latex }),
  );
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${KATEX_CSS_URL}" />
    <style>${CONTAINER_CSS}</style>
  </head>
  <body>
    <div id="${RENDER_ROOT_ID}">${markup}</div>
  </body>
</html>`;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

export type DiscrepancyKind =
  | "missing_content"
  | "extra_content"
  | "wrong_symbol"
  | "missing_label"
  | "layout"
  | "formatting";

export type DiscrepancySeverity = "high" | "medium" | "low";

export interface Discrepancy {
  kind: DiscrepancyKind;
  severity: DiscrepancySeverity;
  /** Human-findable anchor: nearby words, or a part label. */
  location: string;
  description: string;
  /** What the LaTeX should say instead, when the model can tell. */
  suggestedFix: string | null;
}

export interface VisualCheckPass {
  /** 1-indexed. */
  pass: number;
  matches: boolean;
  summary: string;
  discrepancies: Discrepancy[];
  /** The LaTeX that was rendered and compared on this pass. */
  latex: string;
  /** Base64 PNG of what was rendered, so the UI can show the comparison. */
  renderedPng: string;
}

const DISCREPANCY_KINDS: DiscrepancyKind[] = [
  "missing_content",
  "extra_content",
  "wrong_symbol",
  "missing_label",
  "layout",
  "formatting",
];

const DISCREPANCY_SEVERITIES: DiscrepancySeverity[] = ["high", "medium", "low"];

export const LATEX_VISUAL_CHECK_SYSTEM = `You are a meticulous proofreader for IB Mathematics past-paper transcription.

You will be shown:
1. One or more SOURCE images — scans of an official IB question or mark scheme.
2. One RENDERED image — a screenshot of how the transcribed LaTeX currently displays in the CleverPlatform question bank.

Report every place the RENDERED image fails to faithfully reproduce the SOURCE.

Kinds of problem to report:
- missing_content: text, an equation, a whole part, or a mark code present in the source but absent from the render.
- extra_content: something in the render that is not in the source.
- wrong_symbol: a number, variable, operator, subscript, superscript, vector arrow, or accent that differs between the two.
- missing_label: a part label such as (a), (b), (i) or (ii) present in the source but missing from the render or placed in the wrong position.
- layout: line breaks, paragraph grouping, indentation, or right-aligned mark codes whose structure does not match the source.
- formatting: bold, italic, or size differences that change how the content reads.

Rules:
- Compare CONTENT and STRUCTURE. Ignore purely presentational differences that are expected: exact typeface, colour, any highlighting the platform applies to command terms, any subtopic tags or badges the platform adds beside mark codes, background colour, and overall image dimensions.
- The source is authoritative. Where they disagree, the render is what is wrong.
- Truncation is important. If the render stops part-way through the source — for example the source runs to part (e) but the render stops during part (d) — report it as a high-severity missing_content.
- Be specific about location so a human can find it: quote a few words of nearby text, or name the part label.
- Report only what you can actually see. Do not speculate about content beyond the edge of an image.

Return ONLY a JSON object, with no markdown fences and no commentary:
{
  "matches": false,
  "summary": "one sentence overview",
  "discrepancies": [
    {
      "kind": "missing_label",
      "severity": "high",
      "location": "before the first displayed equation",
      "description": "what is wrong",
      "suggestedFix": "what the LaTeX should say instead, or null"
    }
  ]
}

Set "matches" to true only when discrepancies is empty. Severity is "high" for anything that changes the mathematics or loses content, "medium" for structural or layout problems that keep the content intact, and "low" for cosmetic issues.`;

export const LATEX_VISUAL_CORRECTION_SYSTEM = `You are correcting the LaTeX transcription of an IB Mathematics past paper.

You will be shown the SOURCE image(s), the current LaTeX, and a list of discrepancies found by rendering that LaTeX and comparing the result against the source.

Fix the listed discrepancies and return the corrected LaTeX.

Rules:
- Change only what is needed to fix the reported discrepancies. Everything else must be preserved exactly as given, character for character.
- Keep the existing conventions of the document: mark codes sit on their own line introduced by the hfill command, part labels sit on their own line, and a blank line separates blocks.
- Never invent content you cannot see in the source. If a discrepancy cannot be fixed from the source — for example because the source image itself is cut off — leave that part unchanged.
- Do not restyle, reformat, or "improve" anything that was not reported as a discrepancy.

Return ONLY the corrected LaTeX body. No explanation, no markdown fences.`;

/** Coerce one entry of the model's discrepancy array, dropping anything malformed. */
function parseDiscrepancy(raw: unknown): Discrepancy | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const kind = DISCREPANCY_KINDS.find((k) => k === r.kind);
  if (!kind) return null;

  const severity =
    DISCREPANCY_SEVERITIES.find((s) => s === r.severity) ?? "medium";

  const description =
    typeof r.description === "string" ? r.description.trim() : "";
  if (!description) return null;

  const location = typeof r.location === "string" ? r.location.trim() : "";
  const suggestedFix =
    typeof r.suggestedFix === "string" && r.suggestedFix.trim().length > 0
      ? r.suggestedFix.trim()
      : null;

  return { kind, severity, location, description, suggestedFix };
}

export interface ParsedComparison {
  matches: boolean;
  summary: string;
  discrepancies: Discrepancy[];
}

/**
 * Parse the comparison model's reply.
 *
 * Returns null when no JSON object can be found at all, so the caller can
 * distinguish "the model answered and found nothing wrong" from "the model
 * did not answer usefully". Conflating those would let a failed call be
 * reported to the teacher as a clean bill of health.
 */
export function parseComparisonResponse(text: string): ParsedComparison | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const p = parsed as Record<string, unknown>;
  const discrepancies = Array.isArray(p.discrepancies)
    ? p.discrepancies
        .map(parseDiscrepancy)
        .filter((d): d is Discrepancy => d !== null)
    : [];

  // Trust the discrepancy list over the model's own "matches" boolean — the
  // two disagree often enough (a populated list alongside matches:true) that
  // deriving it is more reliable than believing it.
  const matches = discrepancies.length === 0;

  const summary =
    typeof p.summary === "string" && p.summary.trim().length > 0
      ? p.summary.trim()
      : matches
        ? "No discrepancies found."
        : `${discrepancies.length} discrepancy/discrepancies found.`;

  return { matches, summary, discrepancies };
}

/** Strip markdown fences the correction model may add despite instructions. */
export function cleanCorrectedLatex(text: string): string {
  let out = text.trim();
  const fenced = out.match(/^```(?:latex|tex)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) out = fenced[1];
  return out.trim();
}

/** Render a discrepancy list into the prompt text for the correction pass. */
export function formatDiscrepanciesForPrompt(
  discrepancies: Discrepancy[],
): string {
  return discrepancies
    .map((d, i) => {
      const where = d.location ? ` (at: ${d.location})` : "";
      const fix = d.suggestedFix ? `\n   Suggested fix: ${d.suggestedFix}` : "";
      return `${i + 1}. [${d.severity}] ${d.kind}${where}\n   ${d.description}${fix}`;
    })
    .join("\n");
}
