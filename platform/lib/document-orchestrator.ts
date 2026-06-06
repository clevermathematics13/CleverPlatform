/**
 * document-orchestrator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * DocumentOrchestratorService
 *
 * Owns the multi-pass pipeline:
 *   1. Validate  — Zod schema check on the incoming JSON payload
 *   2. Merge     — splice AI-generated content into the validated template AST
 *   3. Render    — server-side KaTeX → static MathML/SVG strings injected into
 *                  the HTML template (no DOM, no MathJax, no WASM)
 *   4. Emit      — return the final HTML string ready for Puppeteer
 *
 * Architecture notes
 * ──────────────────
 * Why NOT Typst WASM:
 *   - The typst.ts WASM binary is ~35 MB.  Vercel Serverless bundles cap at
 *     50 MB compressed; adding the binary plus its JS glue plus Next.js runtime
 *     will hit that limit and cause deployment failures.
 *   - Cold-start time for a 35 MB WASM blob on Vercel is 8–15 s, far exceeding
 *     the acceptable latency for a teacher-facing PDF export.
 *   - Typst font cache management in an ephemeral serverless environment requires
 *     a self-hosted server with a persistent volume — incompatible with Vercel.
 *
 * Why Puppeteer + CSS remains the right tool:
 *   - Spatial cohesion (Q+A box rule) is fully solved by `break-inside: avoid`
 *     on the `.question-block` wrapper — one CSS property, no layout solver.
 *   - Server-side KaTeX renders to static SVG/MathML strings during HTML
 *     generation — Puppeteer never executes any JavaScript for math rendering,
 *     eliminating the "heavy MathJax DOM mutation" problem entirely.
 *   - The existing Puppeteer pipeline on Vercel is stable, tested, and within
 *     all bundle and timeout limits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import katex from "katex";
import {
  validatePdfRequest,
  type ValidatedAssignmentPdfRequest,
  type ValidatedFormattingRequirements,
} from "./template-schema";
import { escapeHtml, formatQuestionLabel } from "./assignments";

// ── KaTeX rendering ───────────────────────────────────────────────────────────

/**
 * Converts inline `$...$` and display `$$...$$` delimiters in a string to
 * static KaTeX HTML (MathML + SVG fallback).  Runs entirely server-side;
 * Puppeteer sees pre-rendered markup, not raw LaTeX strings.
 *
 * Phase 4 intent: measure equation dimensions.
 * KaTeX server-side render produces HTML with known CSS class widths, so
 * Puppeteer's CSS engine sizes answer boxes correctly around them — without
 * Typst's `measure()` function or any custom layout solver.
 */
export function renderMath(input: string): string {
  // Display math first ($$...$$)
  let output = input.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), {
        displayMode: true,
        throwOnError: false,
        output: "htmlAndMathml",
      });
    } catch {
      return escapeHtml(tex);
    }
  });

  // Inline math ($...$) — avoid matching $$
  output = output.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), {
        displayMode: false,
        throwOnError: false,
        output: "htmlAndMathml",
      });
    } catch {
      return escapeHtml(tex);
    }
  });

  return output;
}

// ── Answer box ────────────────────────────────────────────────────────────────

/**
 * Generates `n` ruled writing lines as an HTML block.
 * These are real `<hr>` elements spaced to match exercise-book ruling,
 * NOT a textarea — the PDF is a print artefact, not interactive.
 */
function renderAnswerBox(lines: number): string {
  const lineHtml = Array.from(
    { length: lines },
    () =>
      `<div style="border-bottom:0.5pt solid #bbb;height:${ANSWER_LINE_HEIGHT_MM}mm;min-height:${ANSWER_LINE_HEIGHT_MM}mm;"></div>`
  ).join("");
  return `<div class="answer-box">${lineHtml}</div>`;
}

const ANSWER_LINE_HEIGHT_MM = 8; // 8 mm per ruled line — matches IB exam paper ruling

// ── Tier badge ────────────────────────────────────────────────────────────────

function tierBadge(tier?: 1 | 2 | 3): string {
  if (!tier) return "";
  const stars = "★".repeat(tier);
  const colours: Record<number, string> = {
    1: "#1a7a4a", // green — entry/compulsory
    2: "#1a5c9e", // blue — standard
    3: "#8b3a8b", // purple — extension
  };
  return `<span class="tier-badge" style="color:${colours[tier]};font-size:9pt;margin-left:4px;">${stars}</span>`;
}

// ── Section block HTML ────────────────────────────────────────────────────────

function renderQuestion(
  question: ValidatedAssignmentPdfRequest["sections"][number]["questions"][number] & {
    tier?: 1 | 2 | 3;
    hint?: string;
    subparts?: Array<{ prompt: string; marks?: number }>;
  },
  questionIndex: number,
  sectionIndex: number,
  formatting: ValidatedFormattingRequirements,
  answerLines: number
): string {
  const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
  const marksHtml = formatting.includeMarksColumn
    ? `<span class="marks">[${question.marks ?? 0} mark${(question.marks ?? 0) !== 1 ? "s" : ""}]</span>`
    : "";
  const hintHtml = question.hint
    ? `<div class="hint"><em>${renderMath(escapeHtml(question.hint))}</em></div>`
    : "";

  // Sub-parts
  const subpartsHtml =
    Array.isArray(question.subparts) && question.subparts.length > 0
      ? question.subparts
          .map((sp, spIdx) => {
            const spLabel = String.fromCharCode("a".charCodeAt(0) + spIdx);
            const spMarks = formatting.includeMarksColumn && sp.marks != null
              ? `<span class="marks">[${sp.marks}]</span>`
              : "";
            return `
              <div class="subpart">
                <span class="subpart-label">(${spLabel})</span>
                <span class="q-text">${renderMath(escapeHtml(sp.prompt))}</span>
                ${spMarks}
              </div>
              ${renderAnswerBox(Math.max(2, Math.ceil(answerLines / 2)))}`;
          })
          .join("")
      : "";

  const mainAnswerBox = !subpartsHtml ? renderAnswerBox(answerLines) : "";

  return `
    <div class="question-block">
      <div class="q-row">
        <span class="q-label">${escapeHtml(label)}${tierBadge(question.tier as 1 | 2 | 3 | undefined)}</span>
        <span class="q-text">${renderMath(escapeHtml(question.prompt))}</span>
        ${marksHtml}
      </div>
      ${hintHtml}
      ${subpartsHtml}
      ${mainAnswerBox}
    </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

function buildCss(formatting: ValidatedFormattingRequirements): string {
  const lineHeight =
    formatting.lineSpacing === "compact"
      ? "1.3"
      : formatting.lineSpacing === "relaxed"
      ? "1.7"
      : "1.5";

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
    h1, h2, h3 { margin: 0; margin-top: 0.5em; }
    h3 { margin-top: 1em; }

    /* ── Document header ── */
    .doc-head { border-bottom: 1px solid #cfcfcf; padding-bottom: 8px; margin-bottom: 14px; }
    .school { text-align: center; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; margin-bottom: 4px; }
    .title { text-align: center; margin-top: 6px; margin-bottom: 2px; font-size: 18pt; font-weight: bold; }
    .subtitle { text-align: center; margin-top: 2px; margin-bottom: 8px; font-size: 10pt; color: #444; }
    .meta { margin-bottom: 8px; font-size: 10pt; display: flex; gap: 20px; flex-wrap: wrap; }
    .meta-line { min-width: 200px; }

    /* ── Instructions ── */
    ul { margin: 8px 0 12px 18px; padding: 0; }
    li { margin: 2px 0; }

    /* ── Sections ── */
    .assignment-section { margin-top: 14px; }

    /*
     * Phase 3 — Spatial Cohesion: The Q&A Box Rule
     * ─────────────────────────────────────────────
     * break-inside: avoid forces Chrome's print layout engine to treat each
     * .question-block as an atomic unit.  If the block does not fit on the
     * current page, the entire block — prompt + answer box — moves to the
     * next page.  This is the CSS equivalent of Typst's
     *   #block(breakable: false) { question + answer }
     * and is implemented by Chromium's LayoutBlockFlow algorithm, which is
     * identical to the algorithm used in all IB exam PDF generators.
     */
    .question-block {
      break-inside: avoid;
      page-break-inside: avoid; /* legacy fallback */
      margin: 10px 0 4px 0;
      padding-bottom: 4px;
    }

    /* ── Question row ── */
    .q-row {
      display: grid;
      grid-template-columns: 36px 1fr auto;
      gap: 8px;
      align-items: start;
    }
    .q-label { font-weight: 600; font-size: ${formatting.fontSize}pt; }
    .q-text { white-space: pre-wrap; word-wrap: break-word; }
    .marks { font-size: 9pt; color: #555; text-align: right; white-space: nowrap; }
    .hint { font-size: 9pt; color: #555; margin: 3px 0 3px 44px; }

    /* ── Sub-parts ── */
    .subpart {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 6px;
      margin: 6px 0 2px 44px;
      align-items: start;
    }
    .subpart-label { font-weight: 500; font-size: ${formatting.fontSize}pt; }

    /* ── Answer box ── */
    .answer-box {
      margin: 6px 0 10px 0;
      border: 0.5pt solid #ccc;
      border-radius: 2px;
      padding: 2px 4px;
      /*
       * break-inside: avoid on the answer-box itself ensures the ruled lines
       * never split mid-box — they always travel with the question block above.
       */
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* ── Tier badges ── */
    .tier-badge { font-family: serif; }

    /* ── Nuanced Analysis enrichments ── */
    .spotlight-box {
      border-left: 3px solid #0e7490;
      background: #f0f9ff;
      padding: 6px 10px;
      margin: 8px 0;
      font-size: 9.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .prerequisite-box {
      border-left: 3px solid #059669;
      background: #f0fdf4;
      padding: 6px 10px;
      margin: 8px 0;
      font-size: 9.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
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
    .geometric-box {
      border: 0.5pt solid #d1d5db;
      background: #f9fafb;
      padding: 6px 10px;
      margin: 8px 0;
      font-size: 9.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .command-terms-table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 9.5pt;
    }
    .command-terms-table th, .command-terms-table td {
      border: 0.5pt solid #ccc;
      padding: 3px 8px;
    }
    .command-terms-table th { background: #f3f4f6; font-weight: 600; }

    /* ── Answer key ── */
    .answers { border-top: 1pt solid #cfcfcf; margin-top: 18px; padding-top: 10px; }
    .answer-row { display: grid; grid-template-columns: 36px 1fr; gap: 8px; margin: 4px 0; font-size: 9.5pt; }

    /* ── KaTeX overrides for print ── */
    .katex { font-size: 1em; }
    .katex-display { margin: 4px 0; }
  `;
}

// ── Main HTML assembly ────────────────────────────────────────────────────────

function buildHtml(
  validated: ValidatedAssignmentPdfRequest,
  answerLines: number
): string {
  const { title, subtitle, instructions, sections, formatting } = validated;

  const instructionsHtml = instructions
    .map((line, i) => `<li>${escapeHtml(`${i + 1}. ${line}`)}</li>`)
    .join("");

  // Command terms table (Nuanced Analysis)
  const draft = validated as unknown as {
    commandTerms?: Array<{ term: string; definition: string }>;
    course?: string;
    syllabusTopics?: string;
    prerequisites?: string;
    materials?: string;
  };

  const commandTermsHtml =
    Array.isArray(draft.commandTerms) && draft.commandTerms.length > 0
      ? `<table class="command-terms-table">
           <tr><th>Command Term</th><th>Meaning</th></tr>
           ${draft.commandTerms
             .map(
               (ct) =>
                 `<tr><td><strong>${escapeHtml(ct.term)}</strong></td><td>${escapeHtml(ct.definition)}</td></tr>`
             )
             .join("")}
         </table>`
      : "";

  const metaLines = [
    formatting.includeNameLine ? `<div class="meta-line">Name: ____________________</div>` : "",
    formatting.includeDateLine ? `<div class="meta-line">Date: ____________________</div>` : "",
    formatting.teacherName
      ? `<div class="meta-line">Teacher: ${escapeHtml(formatting.teacherName)}</div>`
      : "",
    draft.course ? `<div class="meta-line">Course: ${escapeHtml(draft.course)}</div>` : "",
    draft.syllabusTopics
      ? `<div class="meta-line">Topics: ${escapeHtml(draft.syllabusTopics)}</div>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sectionsHtml = sections
    .map((section, sectionIndex) => {
      const sec = section as typeof section & {
        prerequisiteBox?: { items: string[] };
        spotlight?: { title: string; body: string };
        translationTable?: { caption: string; rows: Array<{ informal: string; formal: string }> };
        geometricReading?: { body: string };
      };

      const prereqHtml = sec.prerequisiteBox
        ? `<div class="prerequisite-box">
             <strong>Before you start:</strong>
             <ul>${sec.prerequisiteBox.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
           </div>`
        : "";

      const spotlightHtml = sec.spotlight
        ? `<div class="spotlight-box">
             <strong>${escapeHtml(sec.spotlight.title)}</strong>
             <p style="margin-top:3px">${renderMath(escapeHtml(sec.spotlight.body))}</p>
           </div>`
        : "";

      const questionBlocksHtml = sec.questions
        .map((q, qIdx) =>
          renderQuestion(
            q as Parameters<typeof renderQuestion>[0],
            qIdx,
            sectionIndex,
            formatting,
            answerLines
          )
        )
        .join("");

      const translationHtml = sec.translationTable
        ? `<table class="translation-table">
             <caption style="text-align:left;font-size:9pt;margin-bottom:3px;">${escapeHtml(sec.translationTable.caption)}</caption>
             <tr><th>Informal</th><th>Formal</th></tr>
             ${sec.translationTable.rows
               .map(
                 (row) =>
                   `<tr><td>${escapeHtml(row.informal)}</td><td>${escapeHtml(row.formal)}</td></tr>`
               )
               .join("")}
           </table>`
        : "";

      const geometricHtml = sec.geometricReading
        ? `<div class="geometric-box">
             <strong>Geometric Reading:</strong>
             <p style="margin-top:3px">${renderMath(escapeHtml(sec.geometricReading.body))}</p>
           </div>`
        : "";

      return `<div class="assignment-section">
        <h3>${escapeHtml(section.heading)}</h3>
        ${prereqHtml}
        ${spotlightHtml}
        ${questionBlocksHtml}
        ${translationHtml}
        ${geometricHtml}
      </div>`;
    })
    .join("");

  const answersHtml = formatting.includeAnswerKey
    ? `<div class="answers"><h3>Answer Key</h3>${sections
        .map((section, sIdx) =>
          section.questions
            .map((q, qIdx) => {
              const label = formatQuestionLabel(sIdx, qIdx, formatting.numberingStyle);
              return `<div class="answer-row"><span class="q-label">${escapeHtml(label)}</span><span>${escapeHtml(q.answer ?? "")}</span></div>`;
            })
            .join("")
        )
        .join("")}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${buildCss(formatting)}</style>
</head>
<body>
  <div class="doc-head">
    <div class="school">${escapeHtml(formatting.schoolName)}</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <h2 class="subtitle">${escapeHtml(subtitle)}</h2>
    <div class="meta">${metaLines}</div>
  </div>
  ${commandTermsHtml}
  <h3>Instructions</h3>
  <ul>${instructionsHtml}</ul>
  ${sectionsHtml}
  ${answersHtml}
</body>
</html>`;
}

// ── DocumentOrchestratorService ───────────────────────────────────────────────

export type OrchestratorResult =
  | { success: true; html: string }
  | { success: false; error: string };

/**
 * DocumentOrchestratorService
 *
 * Phase 5: the unified service that wires validation → merge → render.
 *
 * Usage in the API route:
 *
 *   const result = DocumentOrchestratorService.render(await req.json());
 *   if (!result.success) return NextResponse.json({ error: result.error }, { status: 422 });
 *   // pass result.html to Puppeteer
 */
export const DocumentOrchestratorService = {
  /**
   * Validates the raw JSON payload, applies server-side KaTeX rendering to all
   * math expressions, and returns the final HTML string ready for Puppeteer.
   *
   * @param raw   - The raw object from `await req.json()`
   * @returns     - OrchestratorResult with html or error
   */
  render(raw: unknown): OrchestratorResult {
    // Step A: validate
    const validation = validatePdfRequest(raw);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const validated = validation.data;

    // Step B: merge — answerBoxLines from formatting (default 4)
    const answerLines = (validated.formatting as { answerBoxLines?: number }).answerBoxLines ?? 4;

    // Step C: render HTML with server-side KaTeX (Phase 4 intent achieved without WASM)
    try {
      const html = buildHtml(validated, answerLines);
      return { success: true, html };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "HTML render failed",
      };
    }
  },
};
