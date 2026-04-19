#!/usr/bin/env node
// Extract question_code → {google_doc_id, google_ms_id} from the archive sheet (sheet15)
// The archive sheet contains test blocks, each with:
//   Row N:   "exam question codes" / "exam question coreCodes" with question codes in columns B+
//   Row N+1: "Google Doc question ID" with doc IDs in columns B+
//   Row N+2: "Google Doc ms ID" with ms IDs in columns B+

const fs = require('fs');
const BASE = '/tmp/xlsx_extract';

// Load shared strings
const ssXml = fs.readFileSync(`${BASE}/xl/sharedStrings.xml`, 'utf8');
const strings = [...ssXml.matchAll(/<si>(.*?)<\/si>/gs)].map(m => {
  const parts = [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)];
  return parts.map(p => p[1]).join('');
});

// Parse all cells from archive sheet (sheet15)
const sheetXml = fs.readFileSync(`${BASE}/xl/worksheets/sheet15.xml`, 'utf8');

// Build cell map: { "A4": "value", "B4": "value", ... }
const cellMap = {};
const cellMatches = [...sheetXml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>(?:.*?<v>(.*?)<\/v>)?.*?<\/c>/gs)];
for (const [, col, row, attrs, val] of cellMatches) {
  if (val === undefined) continue;
  const isStr = attrs.includes('t="s"');
  const display = isStr ? strings[parseInt(val)] : val;
  cellMap[`${col}${row}`] = display;
}

// Also catch self-closing cells with values
const selfClosing = [...sheetXml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)\/>/gs)];
// These won't have values, skip

console.log(`Parsed ${Object.keys(cellMap).length} cells from archive sheet`);

// Find all test blocks by looking for rows with A="exam question codes"
const testBlocks = [];
for (const [key, val] of Object.entries(cellMap)) {
  if (key.startsWith('A') && (val === 'exam question codes')) {
    const row = parseInt(key.slice(1));
    testBlocks.push(row);
  }
}
testBlocks.sort((a, b) => a - b);
console.log(`Found ${testBlocks.length} test blocks`);

// Column name to index and back
function colToIndex(col) {
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64);
  }
  return idx;
}

function indexToCol(idx) {
  let col = '';
  while (idx > 0) {
    idx--;
    col = String.fromCharCode(65 + (idx % 26)) + col;
    idx = Math.floor(idx / 26);
  }
  return col;
}

// For each test block, extract question_code → {doc_id, ms_id}
const mapping = {}; // question_code → { doc_id, ms_id }
let totalFound = 0;

for (const codeRow of testBlocks) {
  const docRow = codeRow + 1; // "Google Doc question ID"
  const msRow = codeRow + 2;  // "Google Doc ms ID"

  // Verify
  const docLabel = cellMap[`A${docRow}`];
  const msLabel = cellMap[`A${msRow}`];

  if (docLabel !== 'Google Doc question ID') {
    // Try without the ms row check - some blocks might have different structure
    console.log(`  Row ${codeRow}: docLabel='${docLabel}' - skipping`);
    continue;
  }

  // Get all columns (B through whatever) for this block
  for (let ci = 2; ci <= 50; ci++) { // max 50 questions per test
    const colName = indexToCol(ci);
    const code = cellMap[`${colName}${codeRow}`];
    if (!code) continue;

    // Skip non-question-code values
    if (!/\d{2}[MN]\.\d\.\w+\.TZ\d/.test(code)) continue;

    const docId = cellMap[`${colName}${docRow}`];
    const msId = msLabel === 'Google Doc ms ID' ? cellMap[`${colName}${msRow}`] : undefined;

    if (docId || msId) {
      if (!mapping[code]) {
        mapping[code] = {};
      }
      if (docId) mapping[code].doc_id = docId;
      if (msId) mapping[code].ms_id = msId;
      totalFound++;
    }
  }
}

console.log(`\nExtracted ${Object.keys(mapping).length} unique question codes with doc/ms IDs`);
console.log(`Total entries found: ${totalFound}`);

// Show sample
const codes = Object.keys(mapping);
console.log('\nSample mappings:');
for (let i = 0; i < Math.min(10, codes.length); i++) {
  const c = codes[i];
  console.log(`  ${c}:`);
  console.log(`    doc: ${mapping[c].doc_id || 'N/A'}`);
  console.log(`    ms:  ${mapping[c].ms_id || 'N/A'}`);
}

// Check specifically for 22M.2.AHL.TZ2 questions (our P2 test)
console.log('\n--- 22M P2 TZ2 questions ---');
for (const c of codes) {
  if (c.startsWith('22M.2.AHL.TZ2')) {
    console.log(`  ${c}: doc=${mapping[c].doc_id || 'N/A'} ms=${mapping[c].ms_id || 'N/A'}`);
  }
}

// Stats
let withDoc = 0, withMs = 0, withBoth = 0;
for (const c of codes) {
  if (mapping[c].doc_id) withDoc++;
  if (mapping[c].ms_id) withMs++;
  if (mapping[c].doc_id && mapping[c].ms_id) withBoth++;
}
console.log(`\nStats: ${withDoc} with doc_id, ${withMs} with ms_id, ${withBoth} with both`);

// Write full mapping
fs.writeFileSync('/tmp/question_doc_ms_mapping.json', JSON.stringify(mapping, null, 2));
console.log('\nFull mapping written to /tmp/question_doc_ms_mapping.json');
