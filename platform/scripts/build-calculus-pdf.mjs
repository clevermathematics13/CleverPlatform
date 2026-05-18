2/**
 * Builds a print-ready PDF for a calculus activity sheet.
 * Usage: node scripts/build-calculus-pdf.mjs <stageNumber>
 * Example: node scripts/build-calculus-pdf.mjs 1
 */
import puppeteer from "puppeteer";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "public", "pdfs");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const stageNum = parseInt(process.argv[2] || "1", 10);

// ── Stage definitions (mirrors lib/calculus-activity-sheets.ts) ──

const ACTIVITY_META = {
  1: {
    stageNumber: 1,
    functionFamily: "Polynomial Functions",
    theme: "The Intuitive Foundation",
    title: "Activity 1: The Shrinking Secant",
    estimatedMinutes: 120,
    totalMarks: 28,
  },
  2: {
    stageNumber: 2,
    functionFamily: "Rational Functions",
    theme: "The Anatomy of Discontinuity",
    title: "Activity 2: Hole or Wall?",
    estimatedMinutes: 120,
    totalMarks: 30,
  },
  3: {
    stageNumber: 3,
    functionFamily: "Exponential & Logarithmic Functions",
    theme: "Transcendental Boundaries",
    title: "Activity 3: The Hierarchy of Infinity",
    estimatedMinutes: 120,
    totalMarks: 29,
  },
  4: {
    stageNumber: 4,
    functionFamily: "Trigonometric Functions",
    theme: "Oscillation and Squeeze",
    title: "Activity 4: The Squeeze Sandbox",
    estimatedMinutes: 120,
    totalMarks: 30,
  },
  5: {
    stageNumber: 5,
    functionFamily: "Inverse & Reciprocal Trigonometric Functions",
    theme: "Restricted Domains",
    title: "Activity 5: Slicing the Wave",
    estimatedMinutes: 120,
    totalMarks: 27,
  },
};

const ACTIVITY_DRAFTS = {
  1: {
    title: "Activity 1: The Shrinking Secant",
    subtitle: "IBDP Mathematics AA HL \u2014 Polynomial Functions & The Intuitive Foundation of Limits",
    instructions: [
      "Complete all parts in the spaces provided. Show all working clearly.",
      "Use a calculator for numerical exploration but leave algebraic steps exact.",
      "Read each TOK reflection box and write a short response (2\u20133 sentences).",
      "The final bridge question connects to Activity 2\u2014keep your answer for reference.",
      "Marks are indicated in square brackets. This activity should take approximately 120 minutes.",
    ],
    sections: [
      {
        heading: "Section A: Numerical Exploration \u2014 The Secant That Shrinks [9 marks]",
        questions: [
          {
            prompt: "Consider f(x) = (1/2)x\u00b2 + 2. We wish to find the exact gradient of the curve at x = 2. (a) Write the slope of the secant line passing through (2, f(2)) and (2 + h, f(2 + h)) as a single algebraic expression in h. Simplify fully. [3 marks]",
            marks: 3,
            answer: "m_sec = [f(2+h) \u2212 f(2)] / h = [(1/2)(4+4h+h\u00b2)+2 \u2212 4] / h = [2+2h+h\u00b2/2+2 \u2212 4] / h = (2h + h\u00b2/2) / h = 2 + h/2",
          },
          {
            prompt: "Build a table for h = 1, 0.1, 0.01, 0.001, \u22120.001, \u22120.01, \u22120.1, \u22121, calculating the secant slope to 6 decimal places. What value does the slope appear to be approaching? [3 marks]",
            marks: 3,
            answer: "h=1 \u2192 2.5; h=0.1 \u2192 2.05; h=0.01 \u2192 2.005; h=0.001 \u2192 2.0005; h=\u22120.001 \u2192 1.9995; h=\u22120.01 \u2192 1.995; h=\u22120.1 \u2192 1.95; h=\u22121 \u2192 1.5. Slope \u2192 2.",
          },
          {
            prompt: "Explain why we must examine both h \u2192 0\u207a and h \u2192 0\u207b rather than only positive h. What geometric concept is lost if we only consider one side? [3 marks]",
            marks: 3,
            answer: "The limit must exist and be equal from both sides for the tangent to be well-defined. One-sided approach only gives a right-derivative or left-derivative; at a corner or cusp these differ, so the derivative does not exist there.",
          },
        ],
      },
      {
        heading: "Section B: Algebraic Formalisation \u2014 The Limit of the Difference Quotient [7 marks]",
        questions: [
          {
            prompt: "Evaluate lim(h\u21920) [f(2+h) \u2212 f(2)] / h algebraically using your simplified expression from Section A. Show every algebraic step. [3 marks]",
            marks: 3,
            answer: "lim(h\u21920) (2 + h/2) = 2 + 0/2 = 2. Hence f\u2032(2) = 2.",
          },
          {
            prompt: "Generalize: For f(x) = (1/2)x\u00b2 + 2, find the derivative function f\u2032(x) at any point x = a by evaluating lim(h\u21920) [f(a+h) \u2212 f(a)] / h. Show your working. [4 marks]",
            marks: 4,
            answer: "m_sec = [(1/2)(a\u00b2+2ah+h\u00b2)+2 \u2212 ((1/2)a\u00b2+2)] / h = [ah + h\u00b2/2] / h = a + h/2. lim(h\u21920) (a + h/2) = a. Hence f\u2032(x) = x.",
          },
        ],
      },
      {
        heading: "Section C: Proof \u2014 The Power Rule from First Principles [6 marks]",
        questions: [
          {
            prompt: "Let f(x) = x\u00b3. Using the difference quotient and the binomial expansion (x+h)\u00b3 = x\u00b3 + 3x\u00b2h + 3xh\u00b2 + h\u00b3, prove that f\u2032(x) = 3x\u00b2 directly from the limit definition. State each algebraic step clearly. [4 marks]",
            marks: 4,
            answer: "m_sec = [(x+h)\u00b3 \u2212 x\u00b3] / h = [3x\u00b2h + 3xh\u00b2 + h\u00b3] / h = 3x\u00b2 + 3xh + h\u00b2. lim(h\u21920) (3x\u00b2 + 3xh + h\u00b2) = 3x\u00b2.",
          },
          {
            prompt: "Justify: Explain why, after expanding (x+h)\u207f for any positive integer n, the limit as h \u2192 0 always yields nx\u207f\u207b\u00b9. You do not need to write the full binomial expansion\u2014explain the reasoning. [2 marks]",
            marks: 2,
            answer: "(x+h)\u207f expands to x\u207f + nx\u207f\u207b\u00b9h + [terms with h\u00b2 or higher]. Subtracting x\u207f leaves nx\u207f\u207b\u00b9h plus higher-order terms. Dividing by h gives nx\u207f\u207b\u00b9 + [terms with at least one factor of h]. As h\u21920, all terms with h vanish, leaving nx\u207f\u207b\u00b9.",
          },
        ],
      },
      {
        heading: "Section D: Continuity & the IVT \u2014 Root Existence [3 marks]",
        questions: [
          {
            prompt: "Let p(x) = 2x\u00b3 \u2212 7x\u00b2 + x + 10. (a) Evaluate p(\u22121) and p(0). (b) State the Intermediate Value Theorem. (c) Deduce that p(x) has at least one root in (\u22121, 0), justifying each condition of the IVT holds. [3 marks]",
            marks: 3,
            answer: "p(\u22121) = 0 and p(0) = 10. Since p is a polynomial (continuous on [\u22121, 0]), p(\u22121) = 0 \u2264 0 \u2264 10 = p(0), IVT guarantees a c \u2208 [\u22121, 0] with p(c) = 0. x = \u22121 is itself a root.",
          },
        ],
      },
      {
        heading: "TOK Reflection",
        questions: [
          {
            prompt: "The Concept of Infinity: Calculus relies on the infinitely small (h \u2192 0). Can the human mind truly grasp the 'infinitely small,' or is this just a useful linguistic trick we invented to make our formulas work? Write 2\u20133 sentences.",
            marks: 0,
            answer: "",
          },
        ],
      },
      {
        heading: "Bridge to Activity 2",
        questions: [
          {
            prompt: "In Section B you cancelled the factor h from numerator and denominator. In Activity 2 you will encounter functions where the problematic factor cannot be cancelled so simply. Write down one example of a rational function that would be undefined at x = 2 and predict whether the limit exists.",
            marks: 0,
            answer: "",
          },
        ],
      },
    ],
  },
};

// ── Formatting ──

const formatting = {
  schoolName: "CleverPlatform Mathematics",
  teacherName: "",
  includeNameLine: true,
  includeDateLine: true,
  includeMarksColumn: true,
  includeAnswerKey: false,
  fontSize: 11,
  lineSpacing: "normal",
  pageMarginsMm: 16,
  numberingStyle: "numeric",
};

// ── HTML generation ──

function esc(s) {
  const a = String.fromCharCode(38);
  return (s ?? "")
    .replaceAll("&", a + "amp;")
    .replaceAll("<", a + "lt;")
    .replaceAll(">", a + "gt;")
    .replaceAll('"', a + "quot;")
    .replaceAll("'", a + "#39;");
}

function formatLabel(si, qi, style) {
  if (style === "lettered") {
    return `(${String.fromCharCode("a".charCodeAt(0) + qi)})`;
  }
  return `${si + 1}.${qi + 1}`;
}

function buildHtml(draft, fmt) {
  const { title, subtitle, instructions, sections } = draft;

  const instructionsHtml = instructions
    .map((line, i) => `<li>${esc(`${i + 1}. ${line}`)}</li>`)
    .join("");

  const sectionsHtml = sections
    .map((section, si) => {
      const rows = section.questions
        .map((q, qi) => {
          const label = formatLabel(si, qi, fmt.numberingStyle);
          const marksHtml = fmt.includeMarksColumn
            ? `<span class="marks">[${q.marks ?? 0}]</span>`
            : "";
          return `<div class="q-row"><span class="q-label">${esc(label)}</span><span class="q-text">${esc(q.prompt)}</span>${marksHtml}</div>`;
        })
        .join("");
      return `<section><h3>${esc(section.heading)}</h3>${rows}</section>`;
    })
    .join("");

  const answersHtml = fmt.includeAnswerKey
    ? `<section class="answers"><h3>Answer Key</h3>${sections
        .map((section, si) =>
          section.questions
            .map((q, qi) => {
              const label = formatLabel(si, qi, fmt.numberingStyle);
              return `<div class="answer-row"><span class="q-label">${esc(label)}</span><span>${esc(q.answer ?? "")}</span></div>`;
            })
            .join("")
        )
        .join("")}</section>`
    : "";

  const lineHeight = fmt.lineSpacing === "compact" ? "1.3" : fmt.lineSpacing === "relaxed" ? "1.7" : "1.5";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: A4; margin: ${fmt.pageMarginsMm}mm; }
    * { margin: 0; padding: 0; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: ${fmt.fontSize}pt; line-height: ${lineHeight}; }
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
    section { margin-top: 12px; page-break-inside: avoid; }
    .q-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; margin: 6px 0; align-items: start; }
    .q-label { font-weight: 600; min-width: 30px; }
    .q-text { white-space: pre-wrap; word-wrap: break-word; }
    .marks { font-size: 9pt; color: #555; text-align: right; }
    .answers { border-top: 1px solid #cfcfcf; margin-top: 18px; padding-top: 10px; }
    .answer-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="doc-head">
    <div class="school">${esc(fmt.schoolName)}</div>
    <h1 class="title">${esc(title)}</h1>
    <h2 class="subtitle">${esc(subtitle)}</h2>
    <div class="meta">
      ${fmt.includeNameLine ? `<div class="meta-line">Name: ____________________</div>` : ""}
      ${fmt.includeDateLine ? `<div class="meta-line">Date: ____________________</div>` : ""}
      ${fmt.teacherName ? `<div class="meta-line">Teacher: ${esc(fmt.teacherName)}</div>` : ""}
    </div>
  </div>

  <h3>Instructions</h3>
  <ul>${instructionsHtml}</ul>
  ${sectionsHtml}
  ${answersHtml}
</body>
</html>`;
}

// ── Main ──

async function main() {
  const meta = ACTIVITY_META[stageNum];
  const draft = ACTIVITY_DRAFTS[stageNum];

  if (!meta || !draft) {
    console.error(`No activity data found for stage ${stageNum}. Available: 1-5`);
    process.exit(1);
  }

  const html = buildHtml(draft, formatting);
  const safeName = draft.title.replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_");
  const outPath = resolve(outDir, `${safeName}.pdf`);

  console.log(`Building Stage ${stageNum}: ${meta.title}`);
  console.log(`Function family: ${meta.functionFamily}`);
  console.log(`Estimated time: ${meta.estimatedMinutes} min | Total marks: ${meta.totalMarks}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    const pdf = await page.pdf({
      format: "A4",
      margin: {
        top: `${formatting.pageMarginsMm}mm`,
        right: `${formatting.pageMarginsMm}mm`,
        bottom: `${formatting.pageMarginsMm}mm`,
        left: `${formatting.pageMarginsMm}mm`,
      },
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });

    writeFileSync(outPath, pdf);
    console.log(`PDF written: ${outPath} (${(pdf.length / 1024).toFixed(1)} KB)`);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});