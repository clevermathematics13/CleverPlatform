// Rasterises the student-tile emblem geometry into the three greyscale masks
// the shader (shade.py) turns into photographic steel: the disc, the raised
// emblem, and the engraved grooves cut into it. Geometry lives here as plain
// SVG on a 200x200 box; masks come out at SIZE px.
//
// Run from platform/ with playwright-core resolvable, e.g.
//   NODE_PATH=/path/to/node_modules node scripts/steel-emblems/render-masks.mjs
// then  python3 scripts/steel-emblems/shade.py
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const SIZE = 1600;
const OUT = path.resolve("scripts/steel-emblems/masks");
mkdirSync(OUT, { recursive: true });

// ---- Geometry ---------------------------------------------------------------
// Each emblem: `raised` (white fill = stands proud of the disc) and `grooves`
// (white = cut down into the raised metal). Chains are thin raised strokes.

const selfAssess = {
  raised: `
    <path d="M52 176 h96 a6 6 0 0 1 6 6 v4 H46 v-4 a6 6 0 0 1 6 -6 Z"/>
    <path d="M66 165 h68 a5 5 0 0 1 5 5 v6 H61 v-6 a5 5 0 0 1 5 -5 Z"/>
    <path d="M93 62 h14 v88 q6 4 6 12 v3 H87 v-3 q0 -8 6 -12 Z"/>
    <rect x="28" y="56" width="144" height="8" rx="4"/>
    <circle cx="100" cy="60" r="9"/>
    <path d="M100 30 l9 12 l-9 12 l-9 -12 Z"/>
    <g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round">
      <path d="M36 62 L20 112 M36 62 L52 112"/>
      <path d="M164 62 L148 112 M164 62 L180 112"/>
    </g>
    <path d="M14 112 h44 a3 3 0 0 1 3 3 q-3 22 -25 22 q-22 0 -25 -22 a3 3 0 0 1 3 -3 Z"/>
    <path d="M142 112 h44 a3 3 0 0 1 3 3 q-3 22 -25 22 q-22 0 -25 -22 a3 3 0 0 1 3 -3 Z"/>`,
  grooves: `
    <g fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M28 124 l6 6 l12 -12"/>
      <path d="M158 118 l12 12 M170 118 l-12 12"/>
    </g>
    <g fill="none" stroke="#fff" stroke-width="1.8">
      <path d="M94 104 h12 M94 110 h12"/>
    </g>`,
};

const feedback = {
  raised: `
    <path d="M46 56 h108 v92 H46 Z"/>
    <rect x="36" y="44" width="128" height="20" rx="10"/>
    <rect x="36" y="140" width="128" height="20" rx="10"/>
    <path d="M166 22 c14 12 12 44 -8 72 c-10 14 -22 26 -36 38 l-8 3 l3 -8 c8 -16 16 -32 28 -50 c10 -16 14 -36 21 -55 Z"/>`,
  grooves: `
    <circle cx="46" cy="54" r="5"/>
    <circle cx="154" cy="54" r="5"/>
    <circle cx="46" cy="150" r="5"/>
    <circle cx="154" cy="150" r="5"/>
    <g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round">
      <path d="M62 80 h60"/><path d="M62 96 h52"/><path d="M62 112 h40"/><path d="M62 128 h22"/>
    </g>
    <g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round">
      <path d="M160 40 l-16 8 M162 56 l-18 6 M158 72 l-18 4 M150 88 l-16 2"/>
      <path d="M163 26 c-8 26 -22 60 -46 104"/>
    </g>
    <path d="M114 132 l-8 3 l3 -8 Z"/>
    <circle cx="104" cy="139" r="3.2"/>`,
};

const disc = `<circle cx="100" cy="100" r="98"/>`;

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${SIZE}" height="${SIZE}" fill="#fff">${inner}</svg>`;

const page_html = (inner) =>
  `<!doctype html><html><body style="margin:0;background:#000;width:${SIZE}px;height:${SIZE}px">${svg(inner)}</body></html>`;

// ---- Render -----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });

const jobs = [
  ["disc", disc],
  ["self-assess.raised", selfAssess.raised],
  ["self-assess.grooves", selfAssess.grooves],
  ["feedback.raised", feedback.raised],
  ["feedback.grooves", feedback.grooves],
];
for (const [name, inner] of jobs) {
  await page.setContent(page_html(inner));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  console.log("wrote", name);
}
await browser.close();
