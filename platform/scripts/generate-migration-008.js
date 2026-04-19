#!/usr/bin/env node
// Generate migration 008: Add Google Doc IDs to ib_questions and update P2 test items

const fs = require('fs');
const combined = JSON.parse(fs.readFileSync('/tmp/combined_doc_mapping.json', 'utf8'));

let sql = '-- 008: Add Google Doc IDs to ib_questions and update P2 test items\n\n';
sql += '-- ============================================\n';
sql += '-- 1. Add google_doc_id and google_ms_id columns to ib_questions\n';
sql += '-- ============================================\n';
sql += 'ALTER TABLE public.ib_questions ADD COLUMN IF NOT EXISTS google_doc_id TEXT;\n';
sql += 'ALTER TABLE public.ib_questions ADD COLUMN IF NOT EXISTS google_ms_id TEXT;\n\n';

sql += '-- ============================================\n';
sql += '-- 2. Populate google_doc_id/google_ms_id for all known questions\n';
sql += '-- ============================================\n';

// Group by base question code (strip part labels)
// ib_questions stores base codes like "22M.2.AHL.TZ2.H_6"
const baseCodes = {};
for (const [code, data] of Object.entries(combined)) {
  const baseMatch = code.match(/^(.+?_\d+)/);
  if (!baseMatch) continue;
  const base = baseMatch[1];
  if (!baseCodes[base]) baseCodes[base] = { doc_id: null, ms_id: null };
  if (data.doc_id) baseCodes[base].doc_id = data.doc_id;
  if (data.ms_id) baseCodes[base].ms_id = data.ms_id;
}

console.log('Base question codes:', Object.keys(baseCodes).length);

// Generate UPDATE statements
const entries = Object.entries(baseCodes).sort(([a], [b]) => a.localeCompare(b));
let updateCount = 0;

for (const [code, data] of entries) {
  // Escape single quotes in IDs (unlikely but safe)
  const safeCode = code.replace(/'/g, "''");
  if (data.doc_id && data.ms_id) {
    sql += `UPDATE public.ib_questions SET google_doc_id = '${data.doc_id}', google_ms_id = '${data.ms_id}' WHERE code = '${safeCode}';\n`;
  } else if (data.doc_id) {
    sql += `UPDATE public.ib_questions SET google_doc_id = '${data.doc_id}' WHERE code = '${safeCode}';\n`;
  }
  updateCount++;
}

sql += `\n-- Updated ${updateCount} question codes with Google Doc IDs\n`;

// P2 test_items updates
sql += '\n-- ============================================\n';
sql += '-- 3. Update P2 test items with Google Doc/MS IDs\n';
sql += '-- ============================================\n';

const p2Questions = [
  ['22M.2.AHL.TZ2.H_6',  '1Q6QdVYLL0iOo00cdu3-oGOASNXI3P-zjddHBgMHH7DU', '17VFlp49U15wcbOoSP7wNUdraz3TjElwYwyvavLErec8'],
  ['22M.2.AHL.TZ2.H_7',  '1GjApU2kNImuwo8Q8cQ2cR_J41XT3Fe7BZWqnZElqWVs', '1ogg4P9-_Q5-7GVgrtIbo355WjhYgoYs7Mjk0OOjO7Ho'],
  ['22M.2.AHL.TZ2.H_8',  '1dQDyTZPkwaKvT3qxvir8eaFbFhNIYZOZjkIrTfkLuX0', '1DZ1VMR3IdjD58Od9_q5GTQPgjOy5l2rHR125r8b3Aw4'],
  ['22M.2.AHL.TZ2.H_9',  '15DnfS23MjKkzG9bxXM0rgHOnB3jfpk_zGQI1m_78udg', '1vSZlJi0hmS3poRPnELKFMJeD0L8oSrPZX-kwbck5d-k'],
  ['22M.2.AHL.TZ2.H_10', '14KHubH7N-mNGOT-CwB2Z7IRq2dw3dq0E6q4rGSlMbYg', '1wEO17aobk34aABWhz1lpU5sYB8-1Ms7XGUZKcc_WNk8'],
  ['22M.2.AHL.TZ2.H_11', '1dDRzrUi22EahxCEtJwRH-V3jdT0MVPvuvi_au8mt7go', '1JX18BxFKi-at4rzgqJbGa-Fri8rJjpUM3RGS17EnTtw'],
  ['22M.2.AHL.TZ2.H_12', '1Or2f0cXW3pxhm8g913gI-hb_Gasl3pjNGoDMrB3X2fQ', '1O-dU6ei1r7DgYFDkbtM7ZGWvNB5UQzRPBQkvvJbw9tc'],
];

for (const [code, docId, msId] of p2Questions) {
  sql += `UPDATE public.test_items SET google_doc_id = '${docId}', google_ms_id = '${msId}' WHERE test_id = 'a0000000-0000-0000-0000-000000000002' AND ib_question_code = '${code}';\n`;
}

sql += '\n-- ============================================\n';
sql += '-- 4. Verify\n';
sql += '-- ============================================\n';
sql += "SELECT ib_question_code, part_label, google_doc_id IS NOT NULL AS has_doc, google_ms_id IS NOT NULL AS has_ms\n";
sql += "FROM public.test_items\n";
sql += "WHERE test_id = 'a0000000-0000-0000-0000-000000000002'\n";
sql += "ORDER BY sort_order;\n";

fs.writeFileSync('/tmp/migration_008.sql', sql);
console.log('Migration written to /tmp/migration_008.sql');
console.log('Lines:', sql.split('\n').length);
console.log(`${updateCount} ib_questions UPDATEs, ${p2Questions.length} test_items UPDATEs`);
