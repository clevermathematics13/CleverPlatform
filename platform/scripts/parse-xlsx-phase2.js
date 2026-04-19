// Phase 2: Map question codes to Google Doc IDs
// We need to understand the column layout of the HL list sheet
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

// --- Column letter to number and back ---
function colToNum(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + col.charCodeAt(i) - 64;
  }
  return n;
}
function numToCol(n) {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// --- Parse ALL cell data ---
const allCells = {};
const cellRegex = /<c\s+r="([A-Z]+)(\d+)"([^>]*)>(?:[\s\S]*?<v>([^<]*)<\/v>)?[\s\S]*?<\/c>/g;
while ((m = cellRegex.exec(sheetXml)) !== null) {
  const col = m[1];
  const row = parseInt(m[2]);
  const attrs = m[3];
  const rawVal = m[4];
  let val = rawVal;
  if (attrs.includes('t="s"') && rawVal !== undefined) {
    val = strings[parseInt(rawVal)] || rawVal;
  }
  const ref = col + row;
  allCells[ref] = val || '';
}
console.log(`Parsed ${Object.keys(allCells).length} cells total`);

// --- Find columns that contain known question codes ---
// Look for "22M.2.AHL.TZ2.H_6" in the cells
const targetCodes = ['22M.2.AHL.TZ2.H_6', '22M.2.AHL.TZ2.H_7', '22M.2.AHL.TZ2.H_8'];
for (const code of targetCodes) {
  for (const [ref, val] of Object.entries(allCells)) {
    if (val === code) {
      const col = ref.replace(/\d+/g, '');
      const row = ref.replace(/[A-Z]+/g, '');
      const colN = colToNum(col);
      console.log(`\nFound "${code}" at ${ref} (col#${colN})`);
      // Print surrounding cells in same column range, rows 1-20
      for (let r = 1; r <= 29; r++) {
        const c = col + r;
        const v = allCells[c] || '';
        const url = cellToUrl[c] || '';
        const docId = url ? (url.match(/\/d\/([^\/]+)/) || [])[1] || '' : '';
        if (v || docId) {
          console.log(`  ${c}: "${v}" ${docId ? '→ docId=' + docId : ''}`);
        }
      }
      // Also check adjacent columns
      console.log('  --- Adjacent columns at row ' + row + ' ---');
      for (let dc = -3; dc <= 3; dc++) {
        const adjCol = numToCol(colN + dc);
        const adjRef = adjCol + row;
        const v = allCells[adjRef] || '';
        const url = cellToUrl[adjRef] || '';
        const docId = url ? (url.match(/\/d\/([^\/]+)/) || [])[1] || '' : '';
        console.log(`  ${adjRef}: "${v}" ${docId ? '→ docId=' + docId : ''}`);
      }
      break; // Just find first occurrence
    }
  }
}
