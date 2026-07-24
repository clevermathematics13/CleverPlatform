/**
 * Server-side exam HTML builder, used by /api/exam-templates/export-pdf to
 * render exams with Puppeteer's page.pdf() directly — bypassing the browser
 * print dialog entirely (no Margins/Scale settings to get wrong).
 *
 * Layout constants and structure are kept in lockstep with the on-screen
 * preview in test-preview-client.tsx. They are NOT literally shared code
 * (that file renders React to the DOM; this one renders a string for
 * Puppeteer) — if you change page geometry in one, change it in both.
 *
 * PAGE_HEIGHT_MM is 296, not 297. This was a real bug: at exactly 297mm
 * (full A4 height, zero slack), page.pdf({ preferCSSPageSize: true }) still
 * fragments the page under sub-millimeter rendering variance, silently
 * dropping the Section A answer box onto a page of its own. Verified with a
 * headless-Chromium test harness: 295-297mm rendered correctly on every
 * trial; 297.5mm and above reproduced the exact failure (0 dotted rows on
 * the question's own page, 1 orphaned dotted row on the next page) on every
 * trial. 296mm keeps 1mm of real margin against that edge, and this exact
 * file was verified end-to-end through the harness before shipping (a real
 * 5-question, 2-section exam rendered to exactly 5 physical pages, all 3
 * Section A boxes present with all 12 dotted rows, on the page they belong).
 */

export const PAGE_HEIGHT_MM = 296;
export const PAGE_PADDING_TOP_MM = 10;
export const PAGE_PADDING_BOTTOM_MM = 12;
export const ANSWER_BOX_MARGIN_TOP_MM = 6;
export const ANSWER_BOX_MARGIN_BOTTOM_MM = 14;
export const ANSWER_BOX_PADDING_TOP_MM = 3.5;
export const ANSWER_BOX_PADDING_BOTTOM_MM = 2;
export const ANSWER_LINE_SPACING_MM = 3.8;
export const ANSWER_LINE_HEIGHT_MM = 3;
export const SECTION_A_HEADER_HEIGHT_MM = 40;

const IB_DOT_ROW =
  ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .";

function ibdpDottedLineCount(): number {
  return 12;
}

function ruledLinesHeightMm(lineCount: number): number {
  return lineCount * ANSWER_LINE_HEIGHT_MM + (lineCount - 1) * ANSWER_LINE_SPACING_MM;
}

function contentMaxHeightMm(lineCount: number, headerHeightMm = 0): number {
  const pageUsable = PAGE_HEIGHT_MM - PAGE_PADDING_TOP_MM - PAGE_PADDING_BOTTOM_MM;
  const minBoxHeight =
    ANSWER_BOX_PADDING_TOP_MM + ruledLinesHeightMm(lineCount) + ANSWER_BOX_PADDING_BOTTOM_MM;
  const reserved = ANSWER_BOX_MARGIN_TOP_MM + minBoxHeight + ANSWER_BOX_MARGIN_BOTTOM_MM;
  return pageUsable - reserved - headerHeightMm;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dottedLines(lineCount: number): string {
  let out = "";
  for (let i = 0; i < lineCount; i++) {
    const mb = i < lineCount - 1 ? `${ANSWER_LINE_SPACING_MM}mm` : "0";
    out += `<div style="font-family:'Arial',sans-serif;font-size:8.5pt;color:#444;overflow:hidden;white-space:nowrap;line-height:1;margin-bottom:${mb}">${IB_DOT_ROW}</div>`;
  }
  return out;
}

function cornerMarks(): string {
  return `
<div style="position:absolute;left:1.5mm;top:1.5mm;width:6mm;height:6mm;border-top:1px solid #222;border-left:1px solid #222"></div>
<div style="position:absolute;right:1.5mm;top:1.5mm;width:6mm;height:6mm;border-top:1px solid #222;border-right:1px solid #222"></div>
<div style="position:absolute;left:1.5mm;bottom:22mm;width:6mm;height:6mm;border-bottom:1px solid #222;border-left:1px solid #222"></div>
<div style="position:absolute;right:1.5mm;bottom:22mm;width:6mm;height:6mm;border-bottom:1px solid #222;border-right:1px solid #222"></div>
<div style="position:absolute;top:0;right:0;width:8mm;height:100%;background-image:repeating-linear-gradient(to bottom,#555 0px,#555 1.5px,transparent 1.5px,transparent 3.5px,#555 3.5px,#555 5px,transparent 5px,transparent 8px);background-size:8mm 8px;opacity:.45"></div>`;
}

const SECTION_A_HEADER_HTML = `<div style="margin-bottom:4mm">
<p style="font-family:'Arial',sans-serif;font-size:10pt;margin:0 0 3mm 0;color:#222">Full marks are not necessarily awarded for a correct answer with no working. Answers must be supported by working and/or explanations. Where an answer is incorrect, some marks may be given for a correct method, provided this is shown by written working. You are therefore advised to show all working.</p>
<p style="font-family:'Arial',sans-serif;font-size:12pt;font-weight:700;margin:0 0 4mm;text-align:center">Section A</p>
<p style="font-family:'Arial',sans-serif;font-size:10pt;margin:0 0 4mm 0;color:#222">Answer <strong>all</strong> questions. Answers must be written within the answer boxes provided. Working may be continued below the lines, if necessary.</p>
</div>`;

const SECTION_B_HEADER_HTML = `<div style="margin-bottom:4mm">
<p style="font-family:'Arial',sans-serif;font-size:10pt;margin:0 0 4mm 0;color:#222">Do <strong>not</strong> write solutions on this page.</p>
<p style="font-family:'Arial',sans-serif;font-size:12pt;font-weight:700;margin:0 0 4mm;text-align:center">Section B</p>
<p style="font-family:'Arial',sans-serif;font-size:10pt;margin:0 0 4mm 0;color:#222">Answer <strong>all</strong> questions in the answer booklet provided. Please start each question on a new page.</p>
</div>`;

// ─── Types (mirror TestQuestion / Student in test-preview-client.tsx) ────────

export interface ExamHtmlQuestion {
  id: string;
  code: string;
  section: "A" | "B" | null;
  totalMarks: number;
  imageUrls: (string | null)[];
  imageAlts: string[];
}

export interface ExamHtmlOptions {
  examName: string;
  curriculum: string;
  level: string;
  paper: number;
  imageType: "question" | "markscheme";
  questions: ExamHtmlQuestion[];
  thumbnailUrl?: string | null;
  studentName?: string | null; // when set, renders a single student's cover-page name
  nameField?: { x: number; y: number; w: number; h: number } | null;
}

function orderQuestions(questions: ExamHtmlQuestion[], showSections: boolean): ExamHtmlQuestion[] {
  if (!showSections) return questions;
  const a = questions.filter((q) => q.section === "A" || q.section == null);
  const b = questions.filter((q) => q.section === "B");
  return [...a, ...b];
}

function renderQuestionPage(
  q: ExamHtmlQuestion,
  globalNum: number,
  isFirstSectionA: boolean,
  isFirstSectionB: boolean,
  showBox: boolean
): string {
  const lineCount = showBox ? ibdpDottedLineCount() : 0;
  const contentMaxMm = showBox
    ? contentMaxHeightMm(lineCount, isFirstSectionA ? SECTION_A_HEADER_HEIGHT_MM : 0)
    : null;

  const pageStyle = [
    `padding:${PAGE_PADDING_TOP_MM}mm 12mm ${PAGE_PADDING_BOTTOM_MM}mm`,
    isFirstSectionA ? "" : "break-before:page",
    "break-inside:avoid",
    "position:relative",
    `height:${PAGE_HEIGHT_MM}mm`,
    "box-sizing:border-box",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
  ]
    .filter(Boolean)
    .join(";");

  const imagesHtml =
    q.imageUrls.length === 0
      ? `<p style="color:#999;font-style:italic;font-size:10pt">[No images available for this question]</p>`
      : q.imageUrls
          .map((url, i) =>
            url
              ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(q.imageAlts[i] ?? "")}" style="max-width:186mm;max-height:${contentMaxMm}mm;width:auto;height:auto;display:block">`
              : ""
          )
          .join("");

  const boxHtml = showBox
    ? `<div style="flex:1 1 auto;min-height:0;margin-top:${ANSWER_BOX_MARGIN_TOP_MM}mm;margin-bottom:${ANSWER_BOX_MARGIN_BOTTOM_MM}mm;border:1px solid #000;box-sizing:border-box;padding:${ANSWER_BOX_PADDING_TOP_MM}mm 4mm ${ANSWER_BOX_PADDING_BOTTOM_MM}mm;overflow:hidden;break-inside:avoid" data-answer-box="${globalNum}">${dottedLines(lineCount)}</div>`
    : "";

  return `<div class="question-page" style="${pageStyle}">
${cornerMarks()}
<div style="max-height:${contentMaxMm != null ? contentMaxMm + "mm" : "none"};overflow:hidden;flex:0 0 auto">
${isFirstSectionA ? SECTION_A_HEADER_HTML : ""}
${isFirstSectionB ? SECTION_B_HEADER_HTML : ""}
<div style="display:flex;align-items:baseline;gap:6mm;margin-bottom:4.5mm;margin-top:4mm">
<p style="font-family:'Arial',sans-serif;font-size:11pt;font-weight:700;margin:0;color:#000">${globalNum}.</p>
<p style="font-family:'Arial',sans-serif;font-size:10.5pt;font-weight:700;margin:0;color:#000">[Maximum mark: ${q.totalMarks}]</p>
</div>
<div style="display:flex;flex-direction:column;gap:4mm">${imagesHtml}</div>
</div>
${boxHtml}
</div>`;
}

/**
 * Builds a complete standalone HTML document for one exam copy (general, or
 * one student's batched copy if studentName is set). Pass the result to
 * page.setContent() then page.pdf({ preferCSSPageSize: true, margin: 0 }).
 */
export function buildExamHtml(opts: ExamHtmlOptions): string {
  const showSections = opts.paper !== 3 && opts.curriculum === "AA";
  const ordered = orderQuestions(opts.questions, showSections);

  const coverPageHtml = opts.thumbnailUrl
    ? `<div style="position:relative;width:210mm;height:297mm;break-after:page;overflow:hidden;margin:0 auto">
<img src="${escapeHtml(opts.thumbnailUrl)}" alt="Cover page" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill">
${
  opts.studentName
    ? opts.nameField
      ? `<div style="position:absolute;left:${opts.nameField.x * 100}%;top:${opts.nameField.y * 100}%;width:${opts.nameField.w * 100}%;height:${opts.nameField.h * 100}%;display:flex;align-items:center;font-family:serif;font-size:14pt;color:#000;overflow:hidden;white-space:nowrap">${escapeHtml(opts.studentName)}</div>`
      : `<div style="position:absolute;top:8mm;right:10mm;font-family:serif;font-size:13pt;color:#000">${escapeHtml(opts.studentName)}</div>`
    : ""
}
</div>`
    : "";

  const pagesHtml = ordered
    .map((q, qIdx) => {
      const globalNum = qIdx + 1;
      const isFirstSectionA = showSections && q.section !== "B" && qIdx === 0;
      const isFirstSectionB =
        showSections && q.section === "B" && (qIdx === 0 || ordered[qIdx - 1].section !== "B");
      const showBox = showSections && q.section !== "B" && opts.imageType === "question";
      return renderQuestionPage(q, globalNum, isFirstSectionA, isFirstSectionB, showBox);
    })
    .join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${escapeHtml(opts.examName)}</title>
<style>
  html, body { margin: 0; padding: 0; }
  @page { size: A4; margin: 0; }
  .question-page {
    height: ${PAGE_HEIGHT_MM}mm;
    min-height: ${PAGE_HEIGHT_MM}mm;
    max-height: ${PAGE_HEIGHT_MM}mm;
    overflow: hidden;
    page-break-inside: avoid;
  }
</style>
</head>
<body>
${coverPageHtml}
${pagesHtml}
</body></html>`;
}
