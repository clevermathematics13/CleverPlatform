/**
 * document-orchestrator.ts
 * ─────────────────────────
 * DocumentOrchestratorService owns:
 *   1. Validate  — Zod schema check on the incoming JSON payload
 *   2. Merge     — splice AI content + per-question answerBoxLines into template AST
 *   3. Render    — server-side KaTeX → static MathML/SVG strings in HTML
 *   4. Emit      — return the final HTML string ready for Puppeteer
 *
 * Also exports generateMarkSchemeHtml() for the separate mark-scheme endpoint.
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

// ── Answer box ────────────────────────────────────────────────────────────────

function renderAnswerBox(lines: number, lineHeightMm: number): string {
  const lineHtml = Array.from(
    { length: lines },
    () => `<div style="border-bottom:0.5pt solid #bbb;height:${lineHeightMm}mm;min-height:${lineHeightMm}mm;"></div>`
  ).join("");
  return `<div class="answer-box">${lineHtml}</div>`;
}

// ── Tier badge ────────────────────────────────────────────────────────────────

function tierBadge(tier?: 1 | 2 | 3): string {
  if (!tier) return "";
  const stars = "★".repeat(tier);
  const colours: Record<number, string> = { 1: "#1a7a4a", 2: "#1a5c9e", 3: "#8b3a8b" };
  return `<span class="tier-badge" style="color:${colours[tier]};font-size:9pt;margin-left:4px;">${stars}</span>`;
}

// ── Question renderer ─────────────────────────────────────────────────────────

type QuestionWithExtras = ValidatedAssignmentPdfRequest["sections"][number]["questions"][number] & {
  tier?: 1 | 2 | 3;
  hint?: string;
  subparts?: Array<{ prompt: string; marks?: number }>;
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
    ? `<span class="marks">[${question.marks ?? 0} mark${(question.marks ?? 0) !== 1 ? "s" : ""}]</span>`
    : "";
  const hintHtml = question.hint
    ? `<div class="hint"><em>${renderMath(escapeHtml(question.hint))}</em></div>`
    : "";
  // Per-question override, falling back to global
  const answerLines = question.answerBoxLines ?? globalAnswerLines;

  const subpartsHtml =
    Array.isArray(question.subparts) && question.subparts.length > 0
      ? question.subparts.map((sp, spIdx) => {
          const spLabel = String.fromCharCode("a".charCodeAt(0) + spIdx);
          const spMarks = formatting.includeMarksColumn && sp.marks != null
            ? `<span class="marks">[${sp.marks}]</span>` : "";
          return `
            <div class="subpart">
              <span class="subpart-label">(${spLabel})</span>
              <span class="q-text">${renderMath(escapeHtml(sp.prompt))}</span>
              ${spMarks}
            </div>
            ${renderAnswerBox(Math.max(2, Math.ceil(answerLines / 2)), formatting.answerLineHeightMm)}`;
        }).join("")
      : "";

  const mainAnswerBox = !subpartsHtml ? renderAnswerBox(answerLines, formatting.answerLineHeightMm) : "";

  return `
    <div class="question-block">
      <div class="q-row">
        <span class="q-label">${escapeHtml(label)}${tierBadge(question.tier as 1|2|3|undefined)}</span>
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
  const lineHeight = formatting.lineSpacing === "compact" ? "1.3" : formatting.lineSpacing === "relaxed" ? "1.7" : "1.5";
  return `
    @import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
    @page { size: A4; margin: ${formatting.pageMarginsMm}mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: ${formatting.fontSize}pt; line-height: ${lineHeight}; }
    h1, h2, h3 { margin: 0; margin-top: 0.5em; }
    h3 { margin-top: 1em; }
    .doc-head { border-bottom: 1px solid #cfcfcf; padding-bottom: 8px; margin-bottom: 14px; }
    .school { text-align: center; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; margin-bottom: 4px; }
    .title { text-align: center; margin-top: 6px; margin-bottom: 2px; font-size: 18pt; font-weight: bold; }
    .subtitle { text-align: center; margin-top: 2px; margin-bottom: 8px; font-size: 10pt; color: #444; }
    .meta { margin-bottom: 8px; font-size: 10pt; display: flex; gap: 20px; flex-wrap: wrap; }
    .meta-line { min-width: 200px; }
    ul { margin: 8px 0 12px 18px; padding: 0; }
    li { margin: 2px 0; }
    .assignment-section { margin-top: 14px; }
    .question-block { break-inside: avoid; page-break-inside: avoid; margin: 10px 0 4px 0; padding-bottom: 4px; }
    .q-row { display: grid; grid-template-columns: 36px 1fr auto; gap: 8px; align-items: start; }
    .q-label { font-weight: 600; font-size: ${formatting.fontSize}pt; }
    .q-text { white-space: pre-wrap; word-wrap: break-word; }
    .marks { font-size: 9pt; color: #555; text-align: right; white-space: nowrap; }
    .hint { font-size: 9pt; color: #555; margin: 3px 0 3px 44px; }
    .subpart { display: grid; grid-template-columns: 28px 1fr auto; gap: 6px; margin: 6px 0 2px 44px; align-items: start; }
    .subpart-label { font-weight: 500; font-size: ${formatting.fontSize}pt; }
    .answer-box { margin: 6px 0 10px 0; border: 0.5pt solid #ccc; border-radius: 2px; padding: 2px 4px; break-inside: avoid; page-break-inside: avoid; }
    .tier-badge { font-family: serif; }
    .spotlight-box { border-left: 3px solid #0e7490; background: #f0f9ff; padding: 6px 10px; margin: 8px 0; font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid; }
    .prerequisite-box { border-left: 3px solid #059669; background: #f0fdf4; padding: 6px 10px; margin: 8px 0; font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid; }
    .translation-table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid; }
    .translation-table th, .translation-table td { border: 0.5pt solid #ccc; padding: 4px 8px; text-align: left; }
    .translation-table th { background: #f3f4f6; font-weight: 600; }
    .geometric-box { border: 0.5pt solid #d1d5db; background: #f9fafb; padding: 6px 10px; margin: 8px 0; font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid; }
    .command-terms-table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; }
    .command-terms-table th, .command-terms-table td { border: 0.5pt solid #ccc; padding: 3px 8px; }
    .command-terms-table th { background: #f3f4f6; font-weight: 600; }
    .answers { border-top: 1pt solid #cfcfcf; margin-top: 18px; padding-top: 10px; }
    .answer-row { display: grid; grid-template-columns: 36px 1fr; gap: 8px; margin: 4px 0; font-size: 9.5pt; }
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
    .ms-section h3 { font-size: 11pt; font-weight: 700; color: #5b21b6; margin-bottom: 6px; }
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

// ── HTML assembly ─────────────────────────────────────────────────────────────

type ExtendedSection = ValidatedAssignmentPdfRequest["sections"][number] & {
  prerequisiteBox?: { items: string[] };
  spotlight?: { title: string; body: string };
  translationTable?: { caption: string; rows: Array<{ informal: string; formal: string }> };
  geometricReading?: { body: string };
};

function buildHtml(validated: ValidatedAssignmentPdfRequest, answerLines: number): string {
  const { title, subtitle, instructions, sections, formatting } = validated;
  const draft = validated as unknown as {
    commandTerms?: Array<{ term: string; definition: string }>;
    course?: string; syllabusTopics?: string; prerequisites?: string; materials?: string;
  };

  const instructionsHtml = instructions.map((line, i) => `<li>${escapeHtml(`${i + 1}. ${line}`)}</li>`).join("");

  const commandTermsHtml = Array.isArray(draft.commandTerms) && draft.commandTerms.length > 0
    ? `<table class="command-terms-table">
         <tr><th>Command Term</th><th>Meaning</th></tr>
         ${draft.commandTerms.map((ct) => `<tr><td><strong>${escapeHtml(ct.term)}</strong></td><td>${escapeHtml(ct.definition)}</td></tr>`).join("")}
       </table>` : "";

  const metaLines = [
    formatting.includeNameLine ? `<div class="meta-line">Name: ____________________</div>` : "",
    formatting.includeDateLine ? `<div class="meta-line">Date: ____________________</div>` : "",
    formatting.teacherName ? `<div class="meta-line">Teacher: ${escapeHtml(formatting.teacherName)}</div>` : "",
    draft.course ? `<div class="meta-line">Course: ${escapeHtml(draft.course)}</div>` : "",
    draft.syllabusTopics ? `<div class="meta-line">Topics: ${escapeHtml(draft.syllabusTopics)}</div>` : "",
  ].filter(Boolean).join("\n");

  const sectionsHtml = sections.map((section, sectionIndex) => {
    const sec = section as ExtendedSection;
    const prereqHtml = sec.prerequisiteBox
      ? `<div class="prerequisite-box"><strong>Before you start:</strong><ul>${sec.prerequisiteBox.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : "";
    const spotlightHtml = sec.spotlight
      ? `<div class="spotlight-box"><strong>${escapeHtml(sec.spotlight.title)}</strong><p style="margin-top:3px">${renderMath(escapeHtml(sec.spotlight.body))}</p></div>` : "";
    const questionBlocksHtml = sec.questions.map((q, qIdx) =>
      renderQuestion(q as QuestionWithExtras, qIdx, sectionIndex, formatting, answerLines)
    ).join("");
    const translationHtml = sec.translationTable
      ? `<table class="translation-table"><caption style="text-align:left;font-size:9pt;margin-bottom:3px;">${escapeHtml(sec.translationTable.caption)}</caption><tr><th>Informal</th><th>Formal</th></tr>${sec.translationTable.rows.map((row) => `<tr><td>${escapeHtml(row.informal)}</td><td>${escapeHtml(row.formal)}</td></tr>`).join("")}</table>` : "";
    const geometricHtml = sec.geometricReading
      ? `<div class="geometric-box"><strong>Geometric Reading:</strong><p style="margin-top:3px">${renderMath(escapeHtml(sec.geometricReading.body))}</p></div>` : "";
    return `<div class="assignment-section"><h3>${escapeHtml(section.heading)}</h3>${prereqHtml}${spotlightHtml}${questionBlocksHtml}${translationHtml}${geometricHtml}</div>`;
  }).join("");

  const answersHtml = formatting.includeAnswerKey
    ? `<div class="answers"><h3>Answer Key</h3>${sections.map((section, sIdx) => section.questions.map((q, qIdx) => { const label = formatQuestionLabel(sIdx, qIdx, formatting.numberingStyle); return `<div class="answer-row"><span class="q-label">${escapeHtml(label)}</span><span>${escapeHtml(q.answer ?? "")}</span></div>`; }).join("")).join("")}</div>` : "";

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>${buildCss(formatting)}</style></head>
<body>
  <div class="doc-head">
    <div class="school">${escapeHtml(formatting.schoolName)}</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <h2 class="subtitle">${escapeHtml(subtitle)}</h2>
    <div class="meta">${metaLines}</div>
  </div>
  ${commandTermsHtml}
  <h3>Instructions</h3><ul>${instructionsHtml}</ul>
  ${sectionsHtml}
  ${answersHtml}
</body></html>`;
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
