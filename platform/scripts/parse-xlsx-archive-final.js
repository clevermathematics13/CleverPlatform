#!/usr/bin/env node
// Extract ALL question_code → {doc_id, ms_id} from archive sheet (sheet15)
// Uses direct string matching instead of regex to handle single-line XML

const fs = require('fs');
const BASE = '/tmp/xlsx_extract';

// Load shared strings
const ssXml = fs.readFileSync(`${BASE}/xl/sharedStrings.xml`, 'utf8');
const strings = [...ssXml.matchAll(/<si>(.*?)<\/si>/gs)].map(m => {
  const parts = [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)];
  return parts.map(p => p[1]).join('');
});

const sheet = fs.readFileSync(`${BASE}/xl/worksheets/sheet15.xml`, 'utf8');

// Find string indices
const eqcIdx = strings.indexOf('exam question codes');
const docIdx = strings.indexOf('Google Doc question ID');
const msIdx = strings.indexOf('Google Doc ms ID');
console.log(`String indices: eqc=${eqcIdx}, doc=${docIdx}, ms=${msIdx}`);

// Find all rows containing 'exam question codes' in column A
const codeRowRe = new RegExp(`r="A(\\d+)"[^>]*t="s"[^/]*><v>${eqcIdx}</v>`, 'g');
const codeRows = [];
let m;
while ((m = codeRowRe.exec(sheet)) !== null) {
  codeRows.push(parseInt(m[1]));
}
codeRows.sort((a, b) => a - b);
console.log(`Found ${codeRows.length} "exam question codes" rows`);

// Get all cells in a given row
function getCellsInRow(rowNum) {
  const result = {};
  const re = new RegExp(`r="([A-Z]+)${rowNum}"([^>]*)>(?:<[^v][^<]*)*<v>([^<]*)</v>`, 'g');
  let cm;
  while ((cm = re.exec(sheet)) !== null) {
    const col = cm[1];
    const attrs = cm[2];
    const val = cm[3];
    const isStr = attrs.includes('t="s"');
    result[col] = isStr ? strings[parseInt(val)] : val;
  }
  return result;
}

// IB question code pattern
const codePattern = /\d{2}[MN]\.\d\.\w+\.TZ\d/;

// Extract mappings
const mapping = {};
let processed = 0;

for (const cr of codeRows) {
  const docRow = cr + 1;
  const msRow = cr + 2;

  const docCells = getCellsInRow(docRow);
  if (docCells.A !== 'Google Doc question ID') {
    continue;
  }

  const codeCells = getCellsInRow(cr);
  const msCells = getCellsInRow(msRow);
  const hasMsRow = msCells.A === 'Google Doc ms ID';

  processed++;

  for (const [col, code] of Object.entries(codeCells)) {
    if (col === 'A') continue;
    if (!codePattern.test(code)) continue;

    const docId = docCells[col];
    const msId = hasMsRow ? msCells[col] : undefined;

    if (docId || msId) {
      if (!mapping[code]) mapping[code] = {};
      if (docId) mapping[code].doc_id = docId;
      if (msId) mapping[code].ms_id = msId;
    }
  }
}

console.log(`Processed ${processed} test blocks`);
console.log(`Extracted ${Object.keys(mapping).length} unique question codes`);

let withDoc = 0, withMs = 0, withBoth = 0;
for (const data of Object.values(mapping)) {
  if (data.doc_id) withDoc++;
  if (data.ms_id) withMs++;
  if (data.doc_id && data.ms_id) withBoth++;
}
console.log(`Stats: ${withDoc} doc, ${withMs} ms, ${withBoth} both`);

// Show 22M P2 TZ2
console.log('\n--- 22M P2 TZ2 questions ---');
for (const c of Object.keys(mapping).sort()) {
  if (c.startsWith('22M.2.AHL.TZ2')) {
    console.log(`  ${c}: doc=${mapping[c].doc_id || 'N/A'} ms=${mapping[c].ms_id || 'N/A'}`);
  }
}

// Now merge with HL list mapping
const hlMapping = JSON.parse(fs.readFileSync('/tmp/question_doc_mapping.json', 'utf8'));
console.log(`\nHL list: ${Object.keys(hlMapping).length} question → doc_id mappings`);

const combined = {};
for (const [code, docId] of Object.entries(hlMapping)) {
  combined[code] = { doc_id: docId };
}
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
console.log(`Combined stats: ${cDoc} doc, ${cMs} ms, ${cBoth} both`);

fs.writeFileSync('/tmp/combined_doc_mapping.json', JSON.stringify(combined, null, 2));
console.log('Combined mapping written to /tmp/combined_doc_mapping.json');

// Final 22M P2 TZ2 from combined
console.log('\n--- Combined 22M P2 TZ2 ---');
for (const c of Object.keys(combined).sort()) {
  if (c.startsWith('22M.2.AHL.TZ2')) {
    console.log(`  ${c}: doc=${combined[c].doc_id || 'N/A'} ms=${combined[c].ms_id || 'N/A'}`);
  }
}
