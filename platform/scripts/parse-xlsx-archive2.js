#!/usr/bin/env node
// Extract ALL question_code → {doc_id, ms_id} from archive sheet (sheet15)
// Fixed parser for single-line XML

const fs = require('fs');
const BASE = '/tmp/xlsx_extract';

// Load shared strings
const ssXml = fs.readFileSync(`${BASE}/xl/sharedStrings.xml`, 'utf8');
const strings = [...ssXml.matchAll(/<si>(.*?)<\/si>/gs)].map(m => {
  const parts = [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)];
  return parts.map(p => p[1]).join('');
});

// Parse archive sheet
const sheetXml = fs.readFileSync(`${BASE}/xl/worksheets/sheet15.xml`, 'utf8');

// Match cells individually using non-greedy matching on the content
// Pattern: <c r="COL_ROW" ...>...<v>VALUE</v>...</c> or <c r="COL_ROW" .../>
const cellMap = {};
const cellRegex = /<c r="([A-Z]+)(\d+)"([^>]*)(?:\/>|>(.*?)<\/c>)/gs;
let match;
while ((match = cellRegex.exec(sheetXml)) !== null) {
  const [, col, row, attrs, content] = match;
  if (!content) continue;
  const vMatch = content.match(/<v>(.*?)<\/v>/);
  if (!vMatch) continue;
  const val = vMatch[1];
  const isStr = attrs.includes('t="s"');
  const display = isStr ? strings[parseInt(val)] : val;
  if (display) cellMap[`${col}${row}`] = display;
}

console.log(`Parsed ${Object.keys(cellMap).length} cells from archive sheet`);

// Find all "exam question codes" rows
const codeRows = [];
for (const [key, val] of Object.entries(cellMap)) {
  if (key.match(/^A\d+$/) && val === 'exam question codes') {
    codeRows.push(parseInt(key.slice(1)));
  }
}
codeRows.sort((a, b) => a - b);
console.log(`Found ${codeRows.length} "exam question codes" rows`);

// Column name helpers
function colToIndex(col) {
  let idx = 0;
  for (let i = 0; i < col.length; i++) idx = idx * 26 + (col.charCodeAt(i) - 64);
  return idx;
}
function indexToCol(idx) {
  let col = '';
  while (idx > 0) { idx--; col = String.fromCharCode(65 + (idx % 26)) + col; idx = Math.floor(idx / 26); }
  return col;
}

// Extract mappings
const mapping = {}; // question_code → { doc_id, ms_id }

for (const cr of codeRows) {
  const docRow = cr + 1;
  const msRow = cr + 2;
  const docLabel = cellMap[`A${docRow}`];
  const msLabel = cellMap[`A${msRow}`];

  if (docLabel !== 'Google Doc question ID') {
    continue;
  }

  // Scan columns B through AZ (up to 52 columns)
  for (let ci = 2; ci <= 52; ci++) {
    const colName = indexToCol(ci);
    const code = cellMap[`${colName}${cr}`];
    if (!code) continue;
    if (!/\d{2}[MN]\.\d\.\w+\.TZ\d/.test(code)) continue;

    const docId = cellMap[`${colName}${docRow}`];
    const msId = msLabel === 'Google Doc ms ID' ? cellMap[`${colName}${msRow}`] : undefined;

    if (docId || msId) {
      // Normalize code: strip trailing part labels for base question lookup
      if (!mapping[code]) mapping[code] = {};
      if (docId) mapping[code].doc_id = docId;
      if (msId) mapping[code].ms_id = msId;
    }
  }
}

console.log(`Extracted ${Object.keys(mapping).length} unique question codes with doc/ms IDs`);

// Stats
let withDoc = 0, withMs = 0, withBoth = 0;
for (const c of Object.keys(mapping)) {
  if (mapping[c].doc_id) withDoc++;
  if (mapping[c].ms_id) withMs++;
  if (mapping[c].doc_id && mapping[c].ms_id) withBoth++;
}
console.log(`Stats: ${withDoc} with doc_id, ${withMs} with ms_id, ${withBoth} with both`);

// Show 22M.2.AHL.TZ2 questions (P2 test)
console.log('\n--- 22M P2 TZ2 questions ---');
for (const c of Object.keys(mapping).sort()) {
  if (c.startsWith('22M.2.AHL.TZ2')) {
    console.log(`  ${c}: doc=${mapping[c].doc_id || 'N/A'} ms=${mapping[c].ms_id || 'N/A'}`);
  }
}

// Now merge with HL list mapping (question doc IDs)
const hlMapping = JSON.parse(fs.readFileSync('/tmp/question_doc_mapping.json', 'utf8'));
console.log(`\nHL list has ${Object.keys(hlMapping).length} question → doc_id mappings`);

// Create combined mapping
const combined = {};
// Start with HL list
for (const [code, docId] of Object.entries(hlMapping)) {
  combined[code] = { doc_id: docId };
}
// Merge archive data (adds ms_ids, and may update doc_ids)
for (const [code, data] of Object.entries(mapping)) {
  if (!combined[code]) combined[code] = {};
  if (data.doc_id && !combined[code].doc_id) combined[code].doc_id = data.doc_id;
  if (data.ms_id) combined[code].ms_id = data.ms_id;
}

console.log(`Combined: ${Object.keys(combined).length} total question codes`);
let cDoc = 0, cMs = 0, cBoth = 0;
for (const data of Object.values(combined)) {
  if (data.doc_id) cDoc++;
  if (data.ms_id) cMs++;
  if (data.doc_id && data.ms_id) cBoth++;
}
console.log(`Combined stats: ${cDoc} with doc_id, ${cMs} with ms_id, ${cBoth} with both`);

// Write combined mapping
fs.writeFileSync('/tmp/combined_doc_mapping.json', JSON.stringify(combined, null, 2));
console.log('Combined mapping written to /tmp/combined_doc_mapping.json');

// Show 22M P2 TZ2 from combined
console.log('\n--- Combined 22M P2 TZ2 ---');
for (const c of Object.keys(combined).sort()) {
  if (c.startsWith('22M.2.AHL.TZ2')) {
    console.log(`  ${c}: doc=${combined[c].doc_id || 'N/A'} ms=${combined[c].ms_id || 'N/A'}`);
  }
}
