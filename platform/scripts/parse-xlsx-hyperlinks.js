// Parse XLSX to extract hyperlinks from HL list sheet
// Outputs: question_code → { question_doc_id, ms_doc_id }
const fs = require('fs');

// --- 1. Build rId → URL map from .rels ---
const relsXml = fs.readFileSync('/tmp/xlsx_extract/xl/worksheets/_rels/sheet8.xml.rels', 'utf8');
const ridToUrl = {};
const relsRegex = /Id="(rId\d+)"[^>]*Target="([^"]*)"/g;
let m;
while ((m = relsRegex.exec(relsXml)) !== null) {
  ridToUrl[m[1]] = m[2];
}
console.log(`Loaded ${Object.keys(ridToUrl).length} relationship entries`);

// --- 2. Build cell_ref → URL map from hyperlinks in sheet XML ---
const sheetXml = fs.readFileSync('/tmp/xlsx_extract/xl/worksheets/sheet8.xml', 'utf8');
const cellToUrl = {};
const hlRegex = /<hyperlink[^>]*r:id="(rId\d+)"[^>]*ref="([^"]+)"[^>]*\/?>/g;
while ((m = hlRegex.exec(sheetXml)) !== null) {
  const rid = m[1];
  const cellRef = m[2];
  if (ridToUrl[rid]) {
    cellToUrl[cellRef] = ridToUrl[rid];
  }
}
console.log(`Mapped ${Object.keys(cellToUrl).length} cells to URLs`);

// --- 3. Parse shared strings ---
const ssXml = fs.readFileSync('/tmp/xlsx_extract/xl/sharedStrings.xml', 'utf8');
const strings = [];
// Match <si> elements - each contains <t> tags
const siRegex = /<si>([\s\S]*?)<\/si>/g;
while ((m = siRegex.exec(ssXml)) !== null) {
  const inner = m[1];
  // Concatenate all <t> values within this <si>
  let val = '';
  const tRegex = /<t[^>]*>([^<]*)<\/t>/g;
  let tm;
  while ((tm = tRegex.exec(inner)) !== null) {
    val += tm[1];
  }
  strings.push(val);
}
console.log(`Loaded ${strings.length} shared strings`);

// --- 4. Parse cell values from sheet ---
// We want cells that are in hyperlinked positions
// Cell format: <c r="M5" s="123" t="s"><v>456</v></c>
const cellValues = {};
const cellRegex = /<c\s+r="([A-Z]+\d+)"[^>]*(?:t="([^"]*)")?[^>]*>(?:[\s\S]*?<v>([^<]*)<\/v>)?[\s\S]*?<\/c>/g;
let count = 0;
while ((m = cellRegex.exec(sheetXml)) !== null) {
  const ref = m[1];
  const type = m[2];
  const rawVal = m[3];
  if (cellToUrl[ref] && rawVal !== undefined) {
    let val = rawVal;
    if (type === 's') {
      val = strings[parseInt(rawVal)] || rawVal;
    }
    cellValues[ref] = val;
    count++;
  }
}
console.log(`Found ${count} cell values for hyperlinked cells`);

// --- 5. Extract Google Doc IDs and map ---
// Output format: cell, value (question code or text), doc_id
const extractDocId = (url) => {
  const match = url.match(/\/d\/([^\/]+)/);
  return match ? match[1] : null;
};

// Detect types: presentation vs document
const extractDocType = (url) => {
  if (url.includes('/presentation/')) return 'slides';
  if (url.includes('/document/')) return 'doc';
  return 'unknown';
};

// Group by column to understand structure
const results = [];
for (const [cell, url] of Object.entries(cellToUrl)) {
  const col = cell.replace(/\d+/g, '');
  const row = parseInt(cell.replace(/[A-Z]+/g, ''));
  const docId = extractDocId(url);
  const docType = extractDocType(url);
  const value = cellValues[cell] || '';
  results.push({ cell, col, row, value, docId, docType, url });
}

// Sort by row then column
results.sort((a, b) => a.row - b.row || a.col.localeCompare(b.col));

// Output first 30 to understand the structure
console.log('\n--- Sample hyperlinked cells (first 30) ---');
results.slice(0, 30).forEach(r => {
  console.log(`${r.cell.padEnd(10)} row=${r.row} value="${r.value}" type=${r.docType} docId=${r.docId}`);
});

// Count by row
const rowCounts = {};
results.forEach(r => { rowCounts[r.row] = (rowCounts[r.row] || 0) + 1; });
console.log('\n--- Hyperlinks per row ---');
Object.entries(rowCounts).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).forEach(([row, count]) => {
  console.log(`Row ${row}: ${count} hyperlinks`);
});

// Write full results to JSON for analysis
fs.writeFileSync('/tmp/xlsx_hyperlinks.json', JSON.stringify(results, null, 2));
console.log(`\nWrote ${results.length} entries to /tmp/xlsx_hyperlinks.json`);
