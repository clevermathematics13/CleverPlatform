#!/usr/bin/env node
/**
 * Parses the IB question bank CSV (wide pivot-table format)
 * and generates SQL INSERT statements for ib_questions + question_parts.
 */
const fs = require('fs');
const path = require('path');

// Simple CSV line parser handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Parse a question code into components
// Formats:
//   07M.1.AHL.TZ1.H_1        -> session=07M, paper=1, level=AHL, tz=TZ1, q=1, part=''
//   11M.1.AHL.TZ2.H_1a       -> ...part=a
//   22M.1.AHL.TZ1.H_10ai     -> ...q=10, part=ai
//   EXN.1.AHL.TZ0.1          -> session=EXN, paper=1, level=AHL, tz=TZ0, q=1
//   EXN.1.AHL.TZ0.8a         -> ...q=8, part=a
//   EXM.3.AHL.TZ0.1a         -> session=EXM...
//   SPM.1.AHL.TZ0.H_4        -> session=SPM...
//   SP.2.01                   -> session=SP, paper=2, level=AHL, tz=TZ0, q=1 (no AHL.TZ)
//   15M.1.SL.TZ1.S_8          -> level=SL
function parseCode(code) {
  // Try standard format: {session}.{paper}.{AHL|SL}.{TZ}.{H_|S_}{q}{part}
  let m = code.match(
    /^(\d{2}[MN]|EX[MN]|SP[MN]?)\.(\d+)\.(AHL|SL)\.(TZ\d+)\.[HS]_?(\d+)([a-zA-Z]*)$/
  );
  if (m) {
    return {
      session: m[1],
      paper: parseInt(m[2]),
      level: m[3],
      timezone: m[4],
      question: parseInt(m[5]),
      part: m[6] || '',
      // Base code = everything except the part suffix
      baseCode: code.replace(/([HS]_?\d+)[a-zA-Z]+$/, '$1'),
    };
  }

  // Try specimen format: SP.{paper}.{q}
  m = code.match(/^(SP)\.(\d+)\.(\d+)$/);
  if (m) {
    return {
      session: 'SP',
      paper: parseInt(m[2]),
      level: 'AHL',
      timezone: 'TZ0',
      question: parseInt(m[3]),
      part: '',
      baseCode: code,
    };
  }

  return null;
}

// ---- Main ----
const csvPath = path.join(
  __dirname,
  '..',
  'supabase',
  'PPQ storage (using Slides) - HL list.csv'
);
const csv = fs.readFileSync(csvPath, 'utf8');
const lines = csv.split('\n').filter((l) => l.trim());
const rows = lines.map(parseCSVLine);

// Skip 4 header rows
const dataRows = rows.slice(4);

// Regex to detect a question code cell
const codeRe =
  /^(\d{2}[MN]|EX[MN]|SP[MN]?)\.\d+\.(AHL|SL)\.TZ\d+\.[HS]_?\d+|^SP\.\d+\.\d+$/;

// Collect entries: { code, marks, subtopicCodes[], commandTerm }
const entries = [];

for (const row of dataRows) {
  for (let i = 0; i < row.length; i++) {
    const cell = row[i].trim();
    if (!cell || !codeRe.test(cell)) continue;

    // Found a question code
    const marks = i > 0 ? parseInt(row[i - 1].trim()) || null : null;

    // Next cell could be subtopic, command term, or boolean
    let subtopicCodes = [];
    let commandTerm = null;

    if (i + 1 < row.length) {
      const nextCell = row[i + 1].trim();
      if (nextCell && nextCell !== 'TRUE' && nextCell !== 'FALSE') {
        // Check if it looks like subtopic code(s) - starts with digit
        if (/^\d/.test(nextCell)) {
          // Could be "3.2" or "1.16, 3.18" or "2.13;2.10"
          subtopicCodes = nextCell
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean);

          // Check i+2 for command term (when subtopic is at i+1)
          if (i + 2 < row.length) {
            const cell2 = row[i + 2].trim();
            if (
              cell2 &&
              cell2 !== 'TRUE' &&
              cell2 !== 'FALSE' &&
              !/^\d/.test(cell2) &&
              !codeRe.test(cell2)
            ) {
              commandTerm = cell2;
            }
          }
        } else {
          // Text like "find", "write", "sketch", etc. could be command term
          commandTerm = nextCell;
        }
      }
    }

    entries.push({
      code: cell,
      marks,
      subtopicCodes,
      commandTerm,
    });
  }
}

console.log(`Found ${entries.length} question entries in CSV\n`);

// Group by base question code
const questionMap = new Map(); // baseCode -> { parsed, parts: [] }

for (const entry of entries) {
  const parsed = parseCode(entry.code);
  if (!parsed) {
    console.warn(`Could not parse code: ${entry.code}`);
    continue;
  }

  // Skip SL questions
  if (parsed.level === 'SL') continue;

  const baseCode = parsed.baseCode;
  if (!questionMap.has(baseCode)) {
    questionMap.set(baseCode, {
      parsed: { ...parsed, part: '' },
      parts: [],
    });
  }

  questionMap.get(baseCode).parts.push({
    partLabel: parsed.part,
    marks: entry.marks,
    subtopicCodes: entry.subtopicCodes,
    commandTerm: entry.commandTerm,
  });
}

console.log(`Unique base questions: ${questionMap.size}`);

// Count questions with subtopic data
let withSubtopic = 0;
let withMarks = 0;
for (const [, q] of questionMap) {
  for (const p of q.parts) {
    if (p.subtopicCodes.length > 0) withSubtopic++;
    if (p.marks) withMarks++;
  }
}
console.log(`Parts with subtopic codes: ${withSubtopic}`);
console.log(`Parts with marks: ${withMarks}\n`);

// Generate SQL — plain SQL with subqueries (no PL/pgSQL)
const sqlLines = [];
sqlLines.push('-- Auto-generated from CSV: IB Question Bank Import');
sqlLines.push('-- Run this in the Supabase SQL Editor\n');

const escSQL = (s) => s.replace(/'/g, "''");

for (const [baseCode, q] of questionMap) {
  const { parsed } = q;

  sqlLines.push(
    `INSERT INTO public.ib_questions (code, session, paper, level, timezone) VALUES ('${escSQL(baseCode)}', '${escSQL(parsed.session)}', ${parsed.paper}, '${parsed.level}', '${parsed.timezone}') ON CONFLICT (code) DO NOTHING;`
  );

  // Deduplicate parts by part_label (keep first occurrence)
  const seenParts = new Set();
  for (const part of q.parts) {
    const key = part.partLabel;
    if (seenParts.has(key)) continue;
    seenParts.add(key);

    const marksVal = part.marks || 1;
    const subtopicArr =
      part.subtopicCodes.length > 0
        ? `ARRAY[${part.subtopicCodes.map((s) => `'${escSQL(s)}'`).join(', ')}]`
        : "'{}'";
    const cmdTerm = part.commandTerm
      ? `'${escSQL(part.commandTerm)}'`
      : 'NULL';

    sqlLines.push(
      `INSERT INTO public.question_parts (question_id, part_label, marks, subtopic_codes, command_term, sort_order) SELECT id, '${escSQL(key)}', ${marksVal}, ${subtopicArr}, ${cmdTerm}, ${sortOrderFromLabel(key)} FROM public.ib_questions WHERE code = '${escSQL(baseCode)}' ON CONFLICT (question_id, part_label) DO NOTHING;`
    );
  }
}

// Helper for sort order from part label
function sortOrderFromLabel(label) {
  if (!label) return 0;
  // a=1, ai=2, aii=3, aiii=4, b=10, bi=11, c=20, ...
  const letter = label.charAt(0);
  const base = (letter.charCodeAt(0) - 96) * 10; // a=10, b=20, c=30
  const sub = label.substring(1);
  let subOrder = 0;
  if (sub === 'i') subOrder = 1;
  else if (sub === 'ii') subOrder = 2;
  else if (sub === 'iii') subOrder = 3;
  else if (sub === 'iv') subOrder = 4;
  else if (sub === 'v') subOrder = 5;
  return base + subOrder;
}

const sqlOutput = sqlLines.join('\n');

const outPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '004_import_questions.sql'
);
fs.writeFileSync(outPath, sqlOutput, 'utf8');
console.log(`SQL written to: ${outPath}`);
console.log(`Total lines: ${sqlLines.length}`);
