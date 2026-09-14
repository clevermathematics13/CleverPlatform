/**
 * Builds a vocabulary insert page and appends it to its study guide.
 *
 * Chromium prints the HTML (the same engine the IB-test PDF pipeline uses);
 * append.py then appends the result with pypdf, so the existing pages are
 * copied through untouched. Nothing re-typesets the guide itself -- neither
 * document has a source anyone still has, only the PDF.
 *
 * Usage (see README.md for the full setup):
 *   node build.mjs ka1   <source.pdf> <out-dir>
 *   node build.mjs form1 <source.pdf> <out-dir>
 *
 * Four things here are findings, not preferences, and will bite whoever
 * changes them back:
 *
 *  1. The display fonts are converted to TTF first (otf2ttf.py). Chromium
 *     writes a CFF/OTF web font into the PDF as Type3 glyph procedures, which
 *     do not embed and extract badly; the same font as TTF comes out as a
 *     properly embedded Type0.
 *  2. pypdf does the merge, not pdf-lib -- even though pdf-lib is already a
 *     dependency of this app. pdf-lib rewrote the LibreOffice-made Formative
 *     guide into a file with broken object streams and zero readable pages,
 *     and did it silently. append.py re-reads its own output and refuses to
 *     keep a merge that changed any original page.
 *  3. The mathematics on these pages is ordinary italic text, not KaTeX.
 *     KaTeX positions every atom in its own box, so pdf-parse lifts the
 *     symbols out of the sentence and dumps them at the foot of the page --
 *     and pdf-parse is exactly what POST /api/source-materials runs to fill
 *     extracted_text, which is what the assessment generator then reads.
 *  4. Likewise the not-equal sign is set in the body font, not the maths one:
 *     KaTeX's own fonts have no U+2260 glyph and build it out of an "=" with
 *     a slash drawn over it, so it extracts as "=" -- the wrong statement
 *     entirely on a page about restrictions.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const [guide, sourcePdf, outDir] = process.argv.slice(2);
if (!guide || !sourcePdf || !outDir) {
  console.error("usage: node build.mjs <ka1|form1> <source.pdf> <out-dir>");
  process.exit(2);
}

/** Where fetch-fonts.sh put the converted TTFs. */
process.env.SG_FONT_DIR = process.env.SG_FONT_DIR ?? resolve(here, "fonts");
/** A Python with pypdf + pdfplumber on it -- see README.md. */
const PYTHON = process.env.SG_PYTHON ?? "python3";

const CHROME =
  process.env.SG_CHROME ??
  ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(
    (p) => existsSync(p),
  );
if (!CHROME) {
  console.error("No Chromium found. Set SG_CHROME to the binary.");
  process.exit(2);
}

const { ka1Html, form1Html } = await import("./html.mjs");
const html = { ka1: ka1Html, form1: form1Html }[guide];
if (!html) {
  console.error(`Unknown guide ${JSON.stringify(guide)} -- expected ka1 or form1.`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const htmlPath = resolve(outDir, `${guide}-insert.html`);
const insertPdf = resolve(outDir, `${guide}-insert.pdf`);
const mergedPdf = resolve(outDir, `${guide}-merged.pdf`);

writeFileSync(htmlPath, html());
execFileSync(
  CHROME,
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    `--print-to-pdf=${insertPdf}`,
    `file://${htmlPath}`,
  ],
  { stdio: "pipe" },
);

execFileSync(PYTHON, [resolve(here, "append.py"), sourcePdf, insertPdf, mergedPdf], {
  stdio: "inherit",
});

console.log(`${guide}: ${mergedPdf}`);
