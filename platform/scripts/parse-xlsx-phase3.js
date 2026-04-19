// Phase 3: Build complete question_code → { google_doc_id, google_ms_id } mapping
// and generate SQL to populate the database
const fs = require('fs');

// --- Load shared strings ---
const ssXml = fs.readFileSync('/tmp/xlsx_extract/xl/sharedStrings.xml', 'utf8');
const strings = [];
const siRegex = /<si>([\s\S]*?)<\/si>/g;
let m;
while ((m = siRegex.exec(ssXml)) !== null) {
  let val = '';
  const tRegex = /<t[^>]*>([^<]*)<\/t>/g;
  let tm;
  while ((tm = tRegex.exec(m[1])) !== null) val += tm[1];
  strings.push(val);
}

// --- Load relations ---
const relsXml = fs.readFileSync('/tmp/xlsx_extract/xl/worksheets/_rels/sheet8.xml.rels', 'utf8');
const ridToUrl = {};
const relsRegex = /Id="(rId\d+)"[^>]*Target="([^"]*)"/g;
while ((m = relsRegex.exec(relsXml)) !== null) ridToUrl[m[1]] = m[2];

// --- Load hyperlinks ---
const sheetXml = fs.readFileSync('/tmp/xlsx_extract/xl/worksheets/sheet8.xml', 'utf8');
const cellToUrl = {};
const hlRegex = /<hyperlink[^>]*r:id="(rId\d+)"[^>]*ref="([^"]+)"[^>]*\/?>/g;
while ((m = hlRegex.exec(sheetXml)) !== null) {
  if (ridToUrl[m[1]]) cellToUrl[m[2]] = ridToUrl[m[1]];
}

// --- Column helpers ---
function colToNum(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + col.charCodeAt(i) - 64;
  }
  return n;
}
function numToCol(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

// --- Parse ALL cell data ---
const allCells = {};
const cellRegex = /<c\s+r="([A-Z]+)(\d+)"([^>]*)>(?:[\s\S]*?<v>([^<]*)<\/v>)?[\s\S]*?<\/c>/g;
while ((m = cellRegex.exec(sheetXml)) !== null) {
  const ref = m[1] + m[2];
  const attrs = m[3];
  const rawVal = m[4];
  let val = rawVal;
  if (attrs.includes('t="s"') && rawVal !== undefined) {
    val = strings[parseInt(rawVal)] || rawVal;
  }
  allCells[ref] = val || '';
}

// --- Find ALL hyperlinked cells with question-code-like values ---
// Question codes match pattern: YYX.N.AHL.TZ[012].H_NN[a-z]?
const qCodeRegex = /^\d{2}[A-Z]?\.\d\.AHL\.TZ\d\.H_\d+[a-z]?$/;
const altCodeRegex = /^(EX[MN]|SP[M])\.\d\.AHL\.TZ\d\.(H_)?\d+[a-z]?$/;

const extractDocId = (url) => {
  const match = url.match(/\/d\/([^\/]+)/);
  return match ? match[1] : null;
};

const qCodeCells = [];
for (const [ref, url] of Object.entries(cellToUrl)) {
  const val = allCells[ref] || '';
  if (qCodeRegex.test(val) || altCodeRegex.test(val) || val.match(/^\d{2}[A-Z]\.\d\.AHL/)) {
    qCodeCells.push({
      ref,
      code: val,
      docId: extractDocId(url),
      url
    });
  }
}

console.log(`Found ${qCodeCells.length} question-code hyperlinked cells`);

// --- Now find ms doc IDs ---
// The ms column should be in the SAME relative position but offset by some columns
// Let's check the column layout around a known question code cell (AFA5)
// AFA = 833, check columns 827-840 for row 5
const afaNum = colToNum('AFA'); // 833
console.log('\n--- Extended column layout around AFA for rows 5-7 ---');
for (let r = 5; r <= 7; r++) {
  console.log(`Row ${r}:`);
  for (let c = afaNum - 8; c <= afaNum + 8; c++) {
    const col = numToCol(c);
    const ref = col + r;
    const val = allCells[ref] || '';
    const url = cellToUrl[ref] || '';
    const docId = url ? extractDocId(url) : '';
    if (val || docId) {
      console.log(`  ${col}(${c}): "${val}" ${docId ? '→ ' + docId.substring(0, 20) + '...' : ''}`);
    }
  }
}

// --- Check ALL hyperlinked cells grouped by column to find ms column ---
const colStats = {};
for (const [ref, url] of Object.entries(cellToUrl)) {
  const col = ref.replace(/\d+/g, '');
  const colN = colToNum(col);
  if (!colStats[colN]) colStats[colN] = { col, count: 0, samples: [] };
  colStats[colN].count++;
  if (colStats[colN].samples.length < 2) {
    colStats[colN].samples.push({ ref, val: allCells[ref] || '', docId: extractDocId(url) || '' });
  }
}

// Show columns with many hyperlinks (likely question/ms doc columns)
console.log('\n--- Columns with 5+ hyperlinks ---');
Object.entries(colStats)
  .filter(([, s]) => s.count >= 5)
  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([colN, s]) => {
    console.log(`${s.col}(${colN}): ${s.count} links — sample: ${s.samples[0].val} → ${s.samples[0].docId?.substring(0,20)}...`);
  });

// --- Build the complete mapping: question_code → doc_id ---
// Group question code cells by column number
const codesByCol = {};
qCodeCells.forEach(c => {
  const colN = colToNum(c.ref.replace(/\d+/g, ''));
  if (!codesByCol[colN]) codesByCol[colN] = [];
  codesByCol[colN].push(c);
});

console.log('\n--- Question code distribution by column ---');
Object.entries(codesByCol)
  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([colN, codes]) => {
    console.log(`Col ${numToCol(parseInt(colN))}(${colN}): ${codes.length} codes — first: ${codes[0].code}`);
  });

// Deduplicate: same question code may appear in multiple columns (different papers using same question)
// Build unique mapping
const codeToDocId = {};
qCodeCells.forEach(c => {
  // Use the base code (without part suffix) as key
  const baseCode = c.code.replace(/[a-z]+$/, '');
  if (!codeToDocId[c.code]) {
    codeToDocId[c.code] = c.docId;
  }
});

console.log(`\nUnique question codes with doc IDs: ${Object.keys(codeToDocId).length}`);

// Write the mapping
fs.writeFileSync('/tmp/question_doc_mapping.json', JSON.stringify(codeToDocId, null, 2));
console.log('Wrote mapping to /tmp/question_doc_mapping.json');

// --- Generate SQL UPDATE for ib_questions table ---
const sql = [];
sql.push('-- Update ib_questions with Google Doc IDs extracted from XLSX');
sql.push('-- Each question code maps to a Google Doc/Slides presentation ID\n');

for (const [code, docId] of Object.entries(codeToDocId)) {
  // The ib_question_code in test_items or code in ib_questions
  sql.push(`-- ${code} → ${docId}`);
}

console.log(`\n--- First 20 mappings ---`);
Object.entries(codeToDocId).slice(0, 20).forEach(([code, docId]) => {
  console.log(`${code} → ${docId}`);
});
