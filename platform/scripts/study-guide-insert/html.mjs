/**
 * The two insert pages as HTML, each laid out in absolute points against the
 * geometry measured off the guide it is being appended to.
 *
 * Every number below came from pdfplumber reading the real document, not from
 * taste: column edges, row fills, rule weights, font sizes, the 5.97pt of cell
 * padding. The page is positioned absolutely rather than flowed so that a
 * measurement pass over the printed PDF can compare like with like.
 */

import { KA1_ROWS, FORM1_ROWS } from "./content.mjs";

const fontUrl = (file) => `file://${process.env.SG_FONT_DIR}/${file}`;

// ---- Key Assessment 1 (A4, TeX Gyre Schola / Heros stand-ins) ----

const KA1_COLS = [50.72, 134.95, 248.96, 416.38, 544.56];

function ka1Cells(row) {
  const cells = [
    `<b>${row.word}</b>${row.wordNote ? `<span class="note">${row.wordNote}</span>` : ""}`,
    row.own,
    row.precise,
    row.example,
  ];
  return cells.map((html) => `<td>${html}</td>`).join("");
}

export function ka1Html() {
  const rows = KA1_ROWS.map(
    (row, i) =>
      `<tr class="${i % 2 === 0 ? "shade" : "plain"}">${ka1Cells(row)}</tr>`,
  ).join("");

  return `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: Schola; src: url("${fontUrl("C059-Roman.ttf")}"); font-weight: 400 }
  @font-face { font-family: Schola; src: url("${fontUrl("C059-Bold.ttf")}"); font-weight: 700 }
  @font-face { font-family: Schola; src: url("${fontUrl("C059-Italic.ttf")}"); font-style: italic }
  @font-face { font-family: Heros; src: url("${fontUrl("NimbusSans-Regular.ttf")}"); font-weight: 400 }
  @font-face { font-family: Heros; src: url("${fontUrl("NimbusSans-Bold.ttf")}"); font-weight: 700 }

  @page { size: 595.28pt 841.89pt; margin: 0 }
  html, body { margin: 0; padding: 0 }
  body {
    width: 595.28pt; height: 841.89pt; position: relative;
    font-family: Schola, serif; font-size: 9pt; color: #000;
    -webkit-font-smoothing: antialiased;
  }
  .abs { position: absolute }

  /* ---- running head, as on every continuation page ---- */
  .head { font-family: Heros, sans-serif; font-size: 7pt; color: #5b6778; top: 35.1pt }
  .head-l { left: 56.69pt }
  .head-r { left: 56.69pt; width: 481.89pt; text-align: right }
  .rule-top { left: 56.69pt; top: 53.57pt; width: 481.89pt; border-top: 0.4pt solid #c8d2de }

  /* ---- the section ---- */
  h2 {
    margin: 0; position: absolute; left: 56.26pt; top: 69.6pt;
    font-family: Heros, sans-serif; font-size: 12pt; font-weight: 700;
    color: #1f2a44; letter-spacing: 0.1pt;
  }
  .intro {
    left: 56.69pt; top: 89.3pt; width: 481.89pt;
    font-size: 10pt; line-height: 12.67pt;
  }

  /* ---- the table, on Part A's own grid ---- */
  table {
    position: absolute; left: ${KA1_COLS[0]}pt; top: 130pt;
    width: ${KA1_COLS[4] - KA1_COLS[0]}pt;
    border-collapse: collapse; table-layout: fixed;
  }
  col.k1 { width: ${KA1_COLS[1] - KA1_COLS[0]}pt }
  col.k2 { width: ${KA1_COLS[2] - KA1_COLS[1]}pt }
  col.k3 { width: ${KA1_COLS[3] - KA1_COLS[2]}pt }
  col.k4 { width: ${KA1_COLS[4] - KA1_COLS[3]}pt }
  td, th {
    vertical-align: top; text-align: left;
    padding: 2.5pt 5.97pt 3.4pt 5.97pt;
    line-height: 11.61pt;
  }
  tr.shade { background: #f2f5f9 }
  tr.plain { background: #fff }
  tr.head-row { background: #e2e8f0 }
  .head-row th {
    font-family: Heros, sans-serif; font-weight: 700; font-size: 7pt;
    color: #1f2a44; letter-spacing: 0.35pt;
    padding-top: 4.1pt; padding-bottom: 4.2pt; line-height: 7pt;
  }
  .m { white-space: nowrap }
  .note { font-family: Heros, sans-serif; font-size: 6.2pt; color: #5b6778; display: block; line-height: 8pt }

  /* ---- the callout, in the shape Part A already uses ---- */
  .callout { left: 50.72pt; top: 316pt; width: 493.84pt }
  .callout h3 {
    margin: 0 0 3.2pt 0; font-family: Heros, sans-serif; font-size: 8pt;
    font-weight: 700; color: #1f2a44; letter-spacing: 0.35pt;
  }
  .callout p { margin: 0; font-size: 9pt; line-height: 11.61pt }

  /* ---- foot ---- */
  .rule-foot { left: 56.69pt; top: 795.52pt; width: 481.89pt; border-top: 0.4pt solid #c8d2de }
  .foot { font-family: Heros, sans-serif; font-size: 7pt; color: #5b6778; top: 801.2pt }
  .foot-l { left: 56.69pt }
  .foot-c { left: 56.69pt; width: 481.89pt; text-align: center }
  .foot-r { left: 56.69pt; width: 481.89pt; text-align: right }
  .nameline { left: 79.78pt; top: 808.36pt; width: 119.06pt; border-top: 0.5pt solid #c8d2de }

</style>

<div class="abs head head-l">Grade 9 Mathematics — Extended &nbsp;·&nbsp; Key Assessment 1 Study Guide</div>
<div class="abs head head-r">Part A — The Toolkit</div>
<div class="abs rule-top"></div>

<h2>A1 (continued) &nbsp;·&nbsp; Fraction words, and the subject</h2>
<div class="abs intro">
  Two words this guide uses throughout but never defines, and one that page 2 defines only
  for a formula. They belong with the table you have already read: the middle column is how
  you might say it to a friend; the <b>precise version</b> is how it must appear in your
  written mathematics.
</div>

<table>
  <colgroup><col class="k1"><col class="k2"><col class="k3"><col class="k4"></colgroup>
  <tr class="head-row">
    <th>WORD</th><th>IN YOUR OWN WORDS</th><th>PRECISE VERSION</th><th>EXAMPLE</th>
  </tr>
  ${rows}
</table>

<div class="abs callout">
  <h3>WHY THE DENOMINATOR DECIDES THE RESTRICTIONS</h3>
  <p>
    A restriction (page 2) is a value that makes a denominator zero, so read every fraction you
    write and ask which value of the variable would do that — naming it is worth a mark.
    Cancelling does not remove the restriction it came from:
    <span class="m">(<i>t</i> − 2)(<i>t</i> + 5)/(<i>t</i> − 2)</span> simplifies to
    <span class="m"><i>t</i> + 5</span>, and <span class="m"><i>t</i> ≠ 2</span> still holds, because the
    expression you started from was never defined there.
  </p>
</div>

<div class="abs rule-foot"></div>
<div class="abs foot foot-l">Name:</div>
<div class="abs foot foot-c">Vocabulary insert &nbsp;·&nbsp; Page 19</div>
<div class="abs foot foot-r">CleverPlatform</div>
<div class="abs nameline"></div>
`;
}

// ---- Formative 1 (US Letter, Liberation Sans, plain-text mathematics) ----

const F1_COLS = [34.6, 215.45, 396.5, 577.45];

export function form1Html() {
  const rows = FORM1_ROWS.map(
    (row) => `<tr>
      <td>${row.word}</td>
      <td>${row.meaning}</td>
      <td>${row.example}</td>
    </tr>`,
  ).join("");

  return `<!doctype html>
<meta charset="utf-8">
<style>
  @page { size: 612pt 792pt; margin: 0 }
  html, body { margin: 0; padding: 0 }
  body {
    width: 612pt; height: 792pt; position: relative;
    font-family: "Liberation Sans", Arial, sans-serif; font-size: 9pt; color: #000;
  }
  .abs { position: absolute }

  h2 {
    margin: 0; position: absolute; left: ${F1_COLS[0]}pt; top: 44.5pt;
    font-size: 14pt; font-weight: bold; color: #14213d;
  }
  .intro {
    left: ${F1_COLS[0]}pt; top: 70pt; width: ${F1_COLS[3] - F1_COLS[0]}pt;
    font-size: 9.5pt; line-height: 11.5pt;
  }

  table {
    position: absolute; left: ${F1_COLS[0]}pt; top: 112pt;
    width: ${F1_COLS[3] - F1_COLS[0]}pt;
    border-collapse: collapse; table-layout: fixed;
  }
  col.c1 { width: ${F1_COLS[1] - F1_COLS[0]}pt }
  col.c2 { width: ${F1_COLS[2] - F1_COLS[1]}pt }
  col.c3 { width: ${F1_COLS[3] - F1_COLS[2]}pt }
  th, td {
    border: 0.5pt solid #000; vertical-align: top;
    padding: 2.9pt 2.55pt 3pt 2.55pt; line-height: 10.35pt; font-size: 9pt;
  }
  th { background: #d9e2f3; font-weight: bold; text-align: left }

  h3 {
    margin: 0; position: absolute; left: ${F1_COLS[0]}pt; top: 254pt;
    font-size: 10.5pt; font-weight: bold; color: #1f4e79;
  }
  .worked {
    left: ${F1_COLS[0]}pt; top: 275pt; width: ${F1_COLS[3] - F1_COLS[0]}pt;
    background: #eef3f8; border: 0.5pt solid #000;
    box-sizing: border-box; padding: 5pt 6pt 6pt 6pt;
  }
  .worked .t { font-size: 9.5pt; font-weight: bold; color: #14213d; margin: 0 0 3.5pt 0 }
  .worked p { margin: 0 0 2.5pt 0; font-size: 9pt; line-height: 11pt }
  .worked p:last-child { margin-bottom: 0 }
  .worked b { font-weight: bold }

  .foot {
    left: 0; top: 745.6pt; width: 612pt; text-align: center;
    font-size: 8pt; color: #646464;
  }
</style>

<h2>1. Vocabulary (continued): fractions, and the subject of an equation</h2>
<div class="abs intro">
  These three words belong with the table on page 1. Sections 7 and 8 use them on nearly
  every question, so learn them the same way as the rest: be able to point at them inside an
  expression you have never seen before, not only recite the definition.
</div>

<table>
  <colgroup><col class="c1"><col class="c2"><col class="c3"></colgroup>
  <tr><th>Word</th><th>Precise meaning</th><th>Example</th></tr>
  ${rows}
</table>

<h3>Worked examples (continued)</h3>
<div class="abs worked">
  <p class="t">Worked example E - naming the parts, and naming the restriction</p>
  <p>In (5x + 10)/(x - 3): the <b>numerator</b> is 5x + 10, the <b>denominator</b> is x - 3.</p>
  <p>A denominator may never equal 0, so x - 3 ≠ 0, which gives x ≠ 3. Say so - the restriction
     is part of the answer, not an afterthought.</p>
  <p>Make b the <b>subject</b> of A = (1/2)bh. Multiply both sides by 2: 2A = bh. Divide both
     sides by h: b = 2A/h, with h ≠ 0. The subject is now b, because b stands alone on one
     side and every other quantity is on the other.</p>
</div>

<div class="abs foot">Grade 9 Mathematics - Extended • Formative 1 Study Guide</div>
`;
}
