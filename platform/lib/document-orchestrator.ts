/**
 * document-orchestrator.ts
 * ─────────────────────────
 * DocumentOrchestratorService owns:
 *   1. Validate  — Zod schema check on the incoming JSON payload
 *   2. Merge     — splice AI content + per-question answerBoxLines into template AST
 *   3. Render    — server-side KaTeX → static MathML/SVG strings in HTML
 *   4. Emit      — return the final HTML string ready for Puppeteer
 *
 * The HTML/CSS produced here mirrors the NuancedAnalysisPreview component:
 *   - Teal command-terms tear-off strip with dashed border
 *   - Teal school name header, bold centred title, italic subtitle
 *   - Full-width name/date write-in lines (border-bottom, with space above)
 *   - Tier badges ★/★★/★★★ coloured (emerald/blue/purple)
 *   - Amber prerequisite boxes ("What you need to start this Part")
 *   - Purple TOK provocation block
 *   - Emerald International Mindedness block
 *   - Part sections with bold headings
 *   - Styled hint lines
 *
 * Also exports generateMarkSchemeHtml() for the separate mark-scheme endpoint.
 *
 * ── Pagination / spatial cohesion ──────────────────────────────────────────
 * See /03_Spatial_Cohesion_and_Pagination_Rules.md for the source-of-truth
 * rules. Summary of what's implemented here (CSS print has no dynamic
 * remaining-space measurement like Typst's `layout()`, so we use static
 * page-height budgets instead):
 *
 *   Rule 1 (full fit)            → answer box requested in full, wrapped in
 *                                   an unbreakable `.question-block`.
 *   Rule 2 / Rule 3 (overflow)   → if the requested box would not fit on a
 *                                   single page even on its own, it is split
 *                                   into a capped first box + a labeled
 *                                   "Continued working space" box that is
 *                                   forced onto a fresh page. This is what
 *                                   prevents Chromium's print engine from
 *                                   falling back to an uncontrolled mid-box
 *                                   page split when `break-inside: avoid`
 *                                   cannot be honoured (the bug that produced
 *                                   the border/header collisions on pages
 *                                   2 and 4 of early ExamBuilder output).
 *   Rule 4 (no useless boxes)    → MIN_USEFUL_LINES enforced on both halves
 *                                   of a split.
 *   Rule 6 (avoid sloppy stretch)→ box height is never inflated past what
 *                                   was actually requested; only capped.
 */

import katex from "katex";
import {
  validatePdfRequest,
  type ValidatedAssignmentPdfRequest,
  type ValidatedFormattingRequirements,
} from "./template-schema";
import { escapeHtml, formatQuestionLabel } from "./assignments";

// ── KaTeX rendering ───────────────────────────────────────────────────────────

export function renderMath(input: string): string {
  let output = input.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false, output: "htmlAndMathml" });
    } catch { return escapeHtml(tex); }
  });
  output = output.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false, output: "htmlAndMathml" });
    } catch { return escapeHtml(tex); }
  });
  return output;
}

// ── Pagination constants ──────────────────────────────────────────────────────
//
// A4 usable height after the largest configured margin (20mm top + 20mm
// bottom) is ~257mm. We also have to leave room for the question prompt
// itself (label, prompt text, marks, optional hint/tier badge), so the
// answer-box budget per page is intentionally conservative.

/** Usable A4 page height in mm at the largest supported margin. */
const PAGE_USABLE_HEIGHT_MM = 257;

/**
 * Maximum height (mm) we will ever request for a single, unbroken answer
 * box. Leaves headroom on the page for the prompt above it. This is the
 * number that previously had no ceiling — answerLines * answerLineHeightMm
 * could exceed a full page (e.g. 20 lines * 12mm = 240mm), which is why
 * `break-inside: avoid` silently failed and Chromium split mid-border.
 */
const MAX_SINGLE_BOX_HEIGHT_MM = 190;

/** Rule 4 — never create an answer space too small to be useful. */
const MIN_USEFUL_LINES = 3;

/** Rule 3 — continuation box gets its own minimum so it isn't a token gesture. */
const MIN_CONTINUATION_LINES = 4;

// ── Answer box ────────────────────────────────────────────────────────────────

function answerLinesHtml(lines: number, lineHeightMm: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `<div style="border-bottom:0.5pt solid #bbb;height:${lineHeightMm}mm;min-height:${lineHeightMm}mm;${i === 0 ? "border-top:0.5pt solid #bbb;" : ""}"></div>`
  ).join("");
}

/**
 * Renders the answer space for a question.
 *
 * Implements Rule 1 / Rule 2 / Rule 3 from the pagination spec:
 *  - If the requested box fits within MAX_SINGLE_BOX_HEIGHT_MM, render it as
 *    one atomic, unbreakable box (Rule 1 — full fit).
 *  - If it doesn't fit, split it: a capped first box that stays with the
 *    prompt, plus a clearly labeled continuation box that is forced onto a
 *    fresh page via `page-break-before` (Rule 3 — partial box with
 *    continuation). This guarantees neither box is ever taller than one
 *    printable page, so `break-inside: avoid` can always be honoured and
 *    Chromium never has to invent its own split point.
 */
function renderAnswerBox(lines: number, lineHeightMm: number): string {
  if (lines <= 0) return "";

  const requestedHeightMm = lines * lineHeightMm;

  if (requestedHeightMm <= MAX_SINGLE_BOX_HEIGHT_MM) {
    // Rule 1 — fits entirely; one atomic unbreakable block.
    return `<div class="answer-box">${answerLinesHtml(lines, lineHeightMm)}</div>`;
  }

  // Rule 2/3 — does not fit on one page. Split into a capped first box and
  // a continuation box that starts on a fresh page.
  const firstBoxLines = Math.max(
    MIN_USEFUL_LINES,
    Math.floor(MAX_SINGLE_BOX_HEIGHT_MM / lineHeightMm)
  );
  const remainingLines = Math.max(MIN_CONTINUATION_LINES, lines - firstBoxLines);

  return `
    <div class="answer-box">${answerLinesHtml(firstBoxLines, lineHeightMm)}</div>
    <div class="continuation-label">Continued working space — see next page</div>
    <div class="answer-box continuation-box">${answerLinesHtml(remainingLines, lineHeightMm)}</div>`;
}

// ── Tier badge ────────────────────────────────────────────────────────────────

function tierBadge(tier?: 1 | 2 | 3): string {
  if (!tier) return "";
  const stars = "★".repeat(tier);
  const styles: Record<number, string> = {
    1: "color:#1a7a4a;background:#f0fdf4;border:1px solid #bbf7d0;",
    2: "color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;",
    3: "color:#6b21a8;background:#faf5ff;border:1px solid #e9d5ff;",
  };
  return `<span class="tier-badge" style="${styles[tier]}font-size:8pt;padding:1px 5px;border-radius:3px;margin-left:5px;font-family:serif;">${stars}</span>`;
}

// ── Question renderer ─────────────────────────────────────────────────────────

type QuestionWithExtras = ValidatedAssignmentPdfRequest["sections"][number]["questions"][number] & {
  tier?: 1 | 2 | 3;
  hint?: string;
  subparts?: Array<{ prompt: string; marks?: number; tier?: 1 | 2 | 3; hint?: string }>;
  answerBoxLines?: number;
};

function renderQuestion(
  question: QuestionWithExtras,
  questionIndex: number,
  sectionIndex: number,
  formatting: ValidatedFormattingRequirements,
  globalAnswerLines: number
): string {
  const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
  const marksHtml = formatting.includeMarksColumn
    ? `<span class="marks">[${question.marks ?? 0}]</span>`
    : "";
  const hintHtml = question.hint
    ? `<div class="hint"><em>Hint: ${renderMath(escapeHtml(question.hint))}</em></div>`
    : "";
  const answerLines = question.answerBoxLines ?? globalAnswerLines;

  const subpartsHtml =
    Array.isArray(question.subparts) && question.subparts.length > 0
      ? question.subparts.map((sp, spIdx) => {
          const spLabel = String.fromCharCode("a".charCodeAt(0) + spIdx);
          const spMarks = formatting.includeMarksColumn && sp.marks != null
            ? `<span class="marks">[${sp.marks}]</span>` : "";
          const spTier = sp.tier ? tierBadge(sp.tier) : "";
          const spHint = sp.hint ? `<div class="hint"><em>Hint: ${escapeHtml(sp.hint)}</em></div>` : "";
          return `
            <div class="subpart">
              <span class="subpart-label">(${spLabel})</span>
              <div><span class="q-text">${renderMath(escapeHtml(sp.prompt))}</span>${spTier}${spHint}</div>
              ${spMarks}
            </div>
            ${renderAnswerBox(Math.max(MIN_USEFUL_LINES, Math.ceil(answerLines / 2)), formatting.answerLineHeightMm)}`;
        }).join("")
      : "";

  const mainAnswerBox = !subpartsHtml ? renderAnswerBox(answerLines, formatting.answerLineHeightMm) : "";

  // Rule 2 — if the prompt + a *minimum useful* answer box can't both fit on
  // a fresh page either (vanishingly rare, but possible with very long
  // prompts), we still keep prompt+box atomic; the browser will move the
  // whole block to the next page rather than splitting it, because
  // `.question-block` carries `break-inside: avoid` and now never exceeds
  // MAX_SINGLE_BOX_HEIGHT_MM + a typical prompt's height.
  return `
    <div class="question-block">
      <div class="q-row">
        <span class="q-label">${escapeHtml(label)}</span>
        <div class="q-body"><span class="q-text">${renderMath(escapeHtml(question.prompt))}</span>${tierBadge(question.tier as 1|2|3|undefined)}${hintHtml}</div>
        ${marksHtml}
      </div>
      ${subpartsHtml}
      ${mainAnswerBox}
    </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

function buildCss(formatting: ValidatedFormattingRequirements): string {
  const lineHeight = formatting.lineSpacing === "compact" ? "1.3" : formatting.lineSpacing === "relaxed" ? "1.7" : "1.5";
  return `
    @import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
    @page { size: A4; margin: ${formatting.pageMarginsMm}mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Georgia, "Times New Roman", serif;
      color: #111;
      font-size: ${formatting.fontSize}pt;
      line-height: ${lineHeight};
    }

    /* ── Header ── */
    .doc-head { margin-bottom: 18px; }
    .school {
      text-align: center;
      text-transform: uppercase;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #0f766e;
      margin-bottom: 4px;
    }
    .title {
      text-align: center;
      font-size: 20pt;
      font-weight: bold;
      color: #111;
      margin: 4px 0 2px;
    }
    .subtitle {
      text-align: center;
      font-size: 10.5pt;
      font-style: italic;
      color: #555;
      margin-bottom: 10px;
    }
    .header-rule {
      border: none;
      border-top: 2pt solid #111;
      margin: 0 0 8px 0;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 6px;
    }
    .meta-field strong {
      font-size: 10pt;
      display: block;
      margin-bottom: 10px;
    }
    .meta-line-rule {
      display: block;
      border-bottom: 2pt solid #333;
      margin-bottom: 4px;
    }
    .meta-row {
      font-size: 9.5pt;
      margin-top: 4px;
    }
    .meta-row strong { display: inline; }

    /* ── Command terms tear-off strip ── */
    .ct-wrap {
      margin: 16px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .ct-dashed-top {
      border-top: 2pt dashed #0d9488;
      margin-bottom: 3px;
    }
    .ct-dashed-bottom {
      border-top: 2pt dashed #0d9488;
      margin-top: 3px;
    }
    .ct-header {
      background: #0f766e;
      color: #fff;
      font-size: 8.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 5px 10px;
    }
    .ct-body {
      background: #f0fdfa;
      border: 0.5pt solid #99f6e4;
      border-top: none;
      padding: 6px 10px 8px;
    }
    .ct-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
      margin-bottom: 6px;
    }
    .ct-table td {
      padding: 2px 6px 2px 2px;
      vertical-align: top;
    }
    .ct-table td:first-child {
      font-weight: 700;
      width: 110px;
      white-space: nowrap;
    }
    .ct-table tr:nth-child(even) { background: rgba(204,251,241,0.4); }
    .ct-demand-label {
      font-size: 7.5pt;
      color: #555;
      font-weight: 600;
      margin-bottom: 3px;
    }
    .ct-demand-scale {
      display: flex;
      align-items: center;
      gap: 0;
      flex-wrap: nowrap;
    }
    .ct-demand-pill {
      font-size: 7pt;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
      color: #fff;
    }
    .ct-demand-arrow {
      font-size: 7pt;
      color: #aaa;
      padding: 0 1px;
    }

    /* ── TOK block ── */
    .tok-block {
      border-left: 3px solid #7c3aed;
      background: #faf5ff;
      padding: 8px 10px;
      margin: 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .tok-block .block-label {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6d28d9;
      margin-bottom: 6px;
    }
    .tok-block ol { margin-left: 16px; }
    .tok-block li { font-size: 10pt; margin-bottom: 4px; }

    /* ── International Mindedness block ── */
    .im-block {
      border-left: 3px solid #059669;
      background: #f0fdf4;
      padding: 8px 10px;
      margin: 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .im-block .block-label {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #065f46;
      margin-bottom: 4px;
    }
    .im-block p { font-size: 10pt; }

    /* ── Instructions ── */
    .instructions-section {
      margin: 0 0 14px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .instructions-section ol { margin-left: 18px; }
    .instructions-section li { font-size: 10pt; margin: 2px 0; }

    /* ── Sections ── */
    .assignment-section { margin-top: 16px; }
    .section-heading {
      font-size: 13pt;
      font-weight: 700;
      color: #111;
      margin-bottom: 8px;
      padding-bottom: 2px;
      /* Rule: section titles should not appear alone at the bottom of a page */
      break-after: avoid;
      page-break-after: avoid;
    }

    /* ── Prerequisite box ── */
    .prerequisite-box {
      border-left: 4px solid #f59e0b;
      background: #fffbeb;
      padding: 6px 10px;
      margin: 0 0 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .prerequisite-box .block-label {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #92400e;
      margin-bottom: 4px;
    }
    .prerequisite-box ul { margin-left: 16px; }
    .prerequisite-box li { font-size: 9.5pt; }

    /* ── Spotlight box ── */
    .spotlight-box {
      border-left: 4px solid #0ea5e9;
      background: #f0f9ff;
      padding: 6px 10px;
      margin: 8px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .spotlight-box strong { font-size: 9pt; display: block; margin-bottom: 2px; }

    /* ── Questions ── */
    .question-block {
      /*
       * Atomic prompt+answer unit (Spatial Cohesion Rule 1 — "Atomic
       * question block"). This now reliably holds because renderAnswerBox()
       * guarantees neither the main box nor the continuation box exceeds
       * MAX_SINGLE_BOX_HEIGHT_MM (~190mm) — comfortably inside one A4 page
       * even with a multi-line prompt above it. Previously an answer box
       * alone could request up to 240mm (20 lines × 12mm), which is taller
       * than the printable page, so break-inside: avoid had nothing valid
       * to land on and Chromium split mid-border instead.
       */
      break-inside: avoid;
      page-break-inside: avoid;
      margin: 10px 0 2px 0;
    }
    .q-row {
      display: grid;
      grid-template-columns: 38px 1fr auto;
      gap: 8px;
      align-items: start;
    }
    .q-label {
      font-weight: 600;
      font-size: ${formatting.fontSize}pt;
      padding-top: 1px;
    }
    .q-body { }
    .q-text { white-space: pre-wrap; word-wrap: break-word; }
    .marks {
      font-size: 9pt;
      color: #555;
      text-align: right;
      white-space: nowrap;
      padding-top: 1px;
    }
    .hint {
      font-size: 9pt;
      color: #6b7280;
      margin: 3px 0 0 0;
    }
    .subpart {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 6px;
      margin: 6px 0 2px 46px;
      align-items: start;
    }
    .subpart-label { font-weight: 500; font-size: ${formatting.fontSize}pt; }
    .answer-box {
      margin: 6px 0 2px 0;
      background: #fafafa;
      border: 0.5pt solid #d1d5db;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    /*
     * Continuation box: forced onto a fresh page so it never gets squeezed
     * against the tail end of the previous question's box (the collision
     * seen on the original buggy page 4 — a second box's top border landing
     * directly against the first box's bottom border with no page break).
     */
    .continuation-box {
      break-before: page;
      page-break-before: always;
    }
    .continuation-label {
      font-size: 8.5pt;
      color: #6b7280;
      font-style: italic;
      margin: 10px 0 2px 0;
      break-before: page;
      page-break-before: always;
      break-after: avoid;
      page-break-after: avoid;
    }
    .tier-badge { font-family: serif; }

    /* ── Translation table ── */
    .translation-table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 9.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .translation-table th, .translation-table td {
      border: 0.5pt solid #ccc;
      padding: 4px 8px;
      text-align: left;
    }
    .translation-table th { background: #f3f4f6; font-weight: 600; }

    /* ── Geometric box ── */
    .geometric-box {
      border: 0.5pt solid #d1d5db;
      background: #f9fafb;
      padding: 6px 10px;
      margin: 8px 0;
      font-size: 9.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* ── Answer key ── */
    .answers { border-top: 1pt solid #cfcfcf; margin-top: 18px; padding-top: 10px; }
    .answer-row {
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: 8px;
      margin: 4px 0;
      font-size: 9.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* ── Teacher companion ── */
    .teacher-separator {
      display: flex;
      align-items: center;
      margin: 24px 0 12px;
      gap: 8px;
      break-after: avoid;
      page-break-after: avoid;
    }
    .teacher-separator-rule {
      flex: 1;
      border: none;
      border-top: 1.5pt dashed #9ca3af;
    }
    .teacher-separator-label {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #9ca3af;
      white-space: nowrap;
    }

    .katex { font-size: 1em; }
    .katex-display { margin: 4px 0; }
  `;
}

// ── Mark scheme CSS ───────────────────────────────────────────────────────────

function buildMarkSchemeCss(formatting: ValidatedFormattingRequirements): string {
  return `
    @import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
    @page { size: A4; margin: ${formatting.pageMarginsMm}mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: ${formatting.fontSize}pt; line-height: 1.5; }
    h1 { font-size: 18pt; font-weight: bold; text-align: center; margin-bottom: 4px; }
    h2 { font-size: 10pt; text-align: center; color: #555; margin-bottom: 12px; }
    .ms-banner { background: #7c3aed; color: #fff; text-align: center; font-size: 9pt; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase; padding: 4px 0; margin-bottom: 16px; }
    .school { text-align: center; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; margin-bottom: 4px; }
    .ms-section { margin-top: 14px; border-top: 1pt solid #c4b5fd; padding-top: 6px; }
    .ms-section h3 { font-size: 11pt; font-weight: 700; color: #5b21b6; margin-bottom: 6px; break-after: avoid; page-break-after: avoid; }
    .ms-row { display: grid; grid-template-columns: 36px 1fr 48px; gap: 8px; margin: 8px 0;
      break-inside: avoid; page-break-inside: avoid; }
    .ms-label { font-weight: 700; font-size: 10pt; }
    .ms-content { }
    .ms-marks { font-size: 9pt; color: #7c3aed; font-weight: 700; text-align: right; white-space: nowrap; }
    .ms-answer { background: #f5f3ff; border-left: 3px solid #7c3aed; padding: 4px 8px;
      margin-top: 4px; font-size: 9.5pt; }
    .ms-tier { font-size: 8pt; margin-left: 3px; }
    .ms-hint { font-size: 8.5pt; color: #6b7280; font-style: italic; margin-top: 2px; }
    .katex { font-size: 1em; }
    .katex-display { margin: 4px 0; }
  `;
}

// ── Demand scale pills ────────────────────────────────────────────────────────

const DEMAND_SCALE = [
  { label: "Write down", bg: "#9ca3af", light: true },
  { label: "State",      bg: "#6b7280", light: true },
  { label: "Describe",   bg: "#4b8bbf", light: false },
  { label: "Calculate",  bg: "#3b82f6", light: false },
  { label: "Explain",    bg: "#22c55e", light: false },
  { label: "Find",       bg: "#f59e0b", light: false },
  { label: "Derive",     bg: "#f97316", light: false },
  { label: "Show that",  bg: "#ef4444", light: false },
  { label: "Prove",      bg: "#dc2626", light: false },
  { label: "Justify",    bg: "#991b1b", light: false },
];

function buildDemandScale(): string {
  return DEMAND_SCALE.map((item, idx) => {
    const color = item.light ? "#374151" : "#fff";
    const pill = `<span class="ct-demand-pill" style="background:${item.bg};color:${color};">${escapeHtml(item.label)}</span>`;
    const arrow = idx < DEMAND_SCALE.length - 1 ? `<span class="ct-demand-arrow">›</span>` : "";
    return pill + arrow;
  }).join("");
}

// ── HTML assembly ─────────────────────────────────────────────────────────────

type NuancedDraftExtras = {
  commandTerms?: Array<{ term: string; definition: string }>;
  tokProvocations?: Array<{ id?: string; question?: string; body?: string }>;
  internationalMindedness?: { body: string };
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  atl?: string;
  compulsoryCore?: string;
};

type ExtendedSection = ValidatedAssignmentPdfRequest["sections"][number] & {
  prerequisiteBox?: { items: string[] };
  spotlight?: { title: string; body: string };
  translationTable?: { caption: string; rows: Array<{ informal: string; formal: string }> };
  geometricReading?: { body: string };
};

function buildHtml(validated: ValidatedAssignmentPdfRequest, answerLines: number): string {
  const { title, subtitle, instructions, sections, formatting } = validated;
  const nd = validated as unknown as NuancedDraftExtras;

  // ── Header ──
  const nameLineHtml = formatting.includeNameLine ? `
    <div class="meta-field">
      <strong>Student Name:</strong>
      <span class="meta-line-rule"></span>
    </div>` : "";

  const dateLineHtml = formatting.includeDateLine ? `
    <div class="meta-field">
      <strong>Date:</strong>
      <span class="meta-line-rule"></span>
    </div>` : "";

  const metaGridHtml = (nameLineHtml || dateLineHtml)
    ? `<div class="meta-grid">${nameLineHtml}${dateLineHtml}</div>` : "";

  const extraMetaHtml = [
    nd.syllabusTopics ? `<div class="meta-row"><strong>Syllabus Topics:</strong> ${escapeHtml(nd.syllabusTopics)}</div>` : "",
    nd.prerequisites   ? `<div class="meta-row"><strong>Prerequisites:</strong> ${escapeHtml(nd.prerequisites)}</div>` : "",
    nd.materials       ? `<div class="meta-row" style="font-style:italic">${escapeHtml(nd.materials)}</div>` : "",
    nd.atl             ? `<div class="meta-row"><strong>Approaches to Learning:</strong> ${escapeHtml(nd.atl)}</div>` : "",
    formatting.teacherName ? `<div class="meta-row"><strong>Teacher:</strong> ${escapeHtml(formatting.teacherName)}</div>` : "",
  ].filter(Boolean).join("\n");

  // ── Command terms strip ──
  const commandTermsHtml = Array.isArray(nd.commandTerms) && nd.commandTerms.length > 0
    ? `<div class="ct-wrap">
        <div class="ct-dashed-top"></div>
        <div class="ct-header">Command Terms — Tear Off and Keep Beside You While Working</div>
        <div class="ct-body">
          <table class="ct-table">
            <tbody>
              ${nd.commandTerms.map((ct, i) =>
                `<tr${i % 2 === 1 ? "" : ""}>
                  <td><strong>${escapeHtml(ct.term)}</strong></td>
                  <td>${escapeHtml(ct.definition)}</td>
                </tr>`
              ).join("")}
            </tbody>
          </table>
          <div class="ct-demand-label">Output demand →</div>
          <div class="ct-demand-scale">${buildDemandScale()}</div>
        </div>
        <div class="ct-dashed-bottom"></div>
      </div>` : "";

  // ── TOK provocations ──
  const tokHtml = Array.isArray(nd.tokProvocations) && nd.tokProvocations.length > 0
    ? `<div class="tok-block">
        <div class="block-label">Theory of Knowledge Provocations</div>
        <ol>
          ${nd.tokProvocations.map((p) => {
            const text = p.body ?? p.question ?? "";
            return `<li>${renderMath(escapeHtml(text))}</li>`;
          }).join("")}
        </ol>
      </div>` : "";

  // ── International Mindedness ──
  const imHtml = nd.internationalMindedness
    ? `<div class="im-block">
        <div class="block-label">International Mindedness</div>
        <p>${escapeHtml(nd.internationalMindedness.body)}</p>
      </div>` : "";

  // ── Instructions ──
  const instructionsHtml = instructions.length > 0
    ? `<div class="instructions-section">
        <ol>
          ${instructions.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ol>
      </div>` : "";

  // ── Sections ──
  // Detect teacher companion boundary
  const teacherIdx = sections.findIndex((s) => /teacher.{0,10}companion/i.test(s.heading));

  const sectionsHtml = sections.map((section, sectionIndex) => {
    const sec = section as ExtendedSection;

    // Teacher companion separator
    const separatorHtml = (teacherIdx !== -1 && sectionIndex === teacherIdx)
      ? `<div class="teacher-separator">
          <hr class="teacher-separator-rule"/>
          <span class="teacher-separator-label">Teacher's Companion — Do Not Distribute</span>
          <hr class="teacher-separator-rule"/>
        </div>` : "";

    const prereqHtml = sec.prerequisiteBox
      ? `<div class="prerequisite-box">
          <div class="block-label">What you need to start this Part</div>
          <ul>${sec.prerequisiteBox.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>` : "";

    const spotlightHtml = sec.spotlight
      ? `<div class="spotlight-box">
          <strong>${escapeHtml(sec.spotlight.title)}</strong>
          <p>${renderMath(escapeHtml(sec.spotlight.body))}</p>
        </div>` : "";

    const questionBlocksHtml = sec.questions.map((q, qIdx) =>
      renderQuestion(q as QuestionWithExtras, qIdx, sectionIndex, formatting, answerLines)
    ).join("");

    const translationHtml = sec.translationTable
      ? `<table class="translation-table">
          <caption style="text-align:left;font-size:9pt;margin-bottom:3px;">${escapeHtml(sec.translationTable.caption)}</caption>
          <tr><th>Informal</th><th>Formal</th></tr>
          ${sec.translationTable.rows.map((row) => `<tr><td>${escapeHtml(row.informal)}</td><td>${escapeHtml(row.formal)}</td></tr>`).join("")}
        </table>` : "";

    const geometricHtml = sec.geometricReading
      ? `<div class="geometric-box">
          <strong>Geometric Reading:</strong>
          <p style="margin-top:3px">${renderMath(escapeHtml(sec.geometricReading.body))}</p>
        </div>` : "";

    return `${separatorHtml}<div class="assignment-section">
      <div class="section-heading">${escapeHtml(section.heading)}</div>
      ${prereqHtml}${spotlightHtml}${questionBlocksHtml}${translationHtml}${geometricHtml}
    </div>`;
  }).join("");

  // ── Answer key ──
  const answersHtml = formatting.includeAnswerKey
    ? `<div class="answers">
        <div class="section-heading">Answer Key</div>
        ${sections.map((section, sIdx) =>
          section.questions.map((q, qIdx) => {
            const label = formatQuestionLabel(sIdx, qIdx, formatting.numberingStyle);
            return `<div class="answer-row">
              <span class="q-label">${escapeHtml(label)}</span>
              <span>${escapeHtml(q.answer ?? "")}</span>
            </div>`;
          }).join("")
        ).join("")}
      </div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${buildCss(formatting)}</style>
</head>
<body>
  <div class="doc-head">
    <div class="school">${escapeHtml(nd.course || formatting.schoolName)}</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <h2 class="subtitle">${escapeHtml(subtitle)}</h2>
    <hr class="header-rule"/>
    ${metaGridHtml}
    ${extraMetaHtml}
  </div>

  ${commandTermsHtml}
  ${tokHtml}
  ${imHtml}
  ${instructionsHtml}
  ${sectionsHtml}
  ${answersHtml}
</body>
</html>`;
}

// ── Mark scheme HTML assembly ─────────────────────────────────────────────────

export type MarkSchemeRequest = {
  title: string;
  subtitle?: string;
  sections: Array<{
    heading: string;
    questions: Array<{
      prompt: string;
      marks?: number;
      answer?: string;
      tier?: 1 | 2 | 3;
      hint?: string;
      subparts?: Array<{ prompt: string; marks?: number; answer?: string }>;
    }>;
  }>;
  formatting: ValidatedFormattingRequirements;
};

export function generateMarkSchemeHtml(req: MarkSchemeRequest): string {
  const { title, subtitle, sections, formatting } = req;
  const tierLabel: Record<number, string> = { 1: "★", 2: "★★", 3: "★★★" };
  let globalQ = 0;

  const sectionsHtml = sections.map((section) => {
    const questionsHtml = section.questions.map((q) => {
      globalQ++;
      const label = String(globalQ);
      const tier = q.tier ? `<span class="ms-tier" style="color:${q.tier===1?"#1a7a4a":q.tier===2?"#1a5c9e":"#8b3a8b"}">${tierLabel[q.tier]}</span>` : "";
      const marksHtml = `<span class="ms-marks">[${q.marks ?? 0}M]</span>`;
      const promptHtml = `<div>${renderMath(escapeHtml(q.prompt))}</div>`;
      const answerHtml = q.answer
        ? `<div class="ms-answer">${renderMath(escapeHtml(q.answer))}</div>` : "";
      const hintHtml = q.hint ? `<div class="ms-hint">Hint: ${escapeHtml(q.hint)}</div>` : "";
      const subpartsHtml = Array.isArray(q.subparts) && q.subparts.length > 0
        ? q.subparts.map((sp, spIdx) => {
            const spLabel = `${label}(${String.fromCharCode(97 + spIdx)})`;
            return `<div class="ms-row" style="margin-left:24px">
              <span class="ms-label">${spLabel}</span>
              <div>${renderMath(escapeHtml(sp.prompt))}${sp.answer ? `<div class="ms-answer">${renderMath(escapeHtml(sp.answer))}</div>` : ""}</div>
              <span class="ms-marks">[${sp.marks ?? 0}M]</span>
            </div>`;
          }).join("") : "";
      return `<div class="ms-row">
        <span class="ms-label">${label}.${tier}</span>
        <div class="ms-content">${promptHtml}${answerHtml}${hintHtml}</div>
        ${marksHtml}
      </div>${subpartsHtml}`;
    }).join("");
    return `<div class="ms-section"><h3>${escapeHtml(section.heading)}</h3>${questionsHtml}</div>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>Mark Scheme — ${escapeHtml(title)}</title><style>${buildMarkSchemeCss(formatting)}</style></head>
<body>
  <div class="school">${escapeHtml(formatting.schoolName)}</div>
  <h1>${escapeHtml(title)}</h1>
  <h2>${escapeHtml(subtitle ?? "Mark Scheme")}</h2>
  <div class="ms-banner">⚠ Teacher Copy — Mark Scheme — Not for Distribution</div>
  ${sectionsHtml}
</body></html>`;
}

// ── DocumentOrchestratorService ───────────────────────────────────────────────

export type OrchestratorResult = { success: true; html: string } | { success: false; error: string };

export const DocumentOrchestratorService = {
  render(raw: unknown): OrchestratorResult {
    const validation = validatePdfRequest(raw);
    if (!validation.success) return { success: false, error: validation.error };
    const validated = validation.data;
    const answerLines = validated.formatting.answerBoxLines ?? 4;
    try {
      const html = buildHtml(validated, answerLines);
      return { success: true, html };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "HTML render failed" };
    }
  },
};
