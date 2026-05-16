/**
 * Batch reclassify questions using the Anthropic Claude API.
 *
 * Reads questions matching a filter from Supabase, sends their LaTeX to
 * Claude with the IB_CLASSIFY_SYSTEM prompt, then writes the returned
 * subtopic codes and primary subtopic code back to each part.
 *
 * Usage:
 *   node scripts/reclassify-questions.mjs [options]
 *
 * Filter options (at least one required):
 *   --primary <code>     Match questions where ANY part has this primary subtopic code
 *   --subtopic <code>    Match questions where ANY part has this subtopic code
 *   --code <pattern>     Match questions whose code contains this string (case-insensitive)
 *   --level <SL|HL>      Match by level
 *   --paper <P1|P2|P3>   Match by paper
 *
 * Other options:
 *   --limit <n>          Max number of questions to process (default: 20)
 *   --dry-run            Show what would be changed without writing to DB
 *   --skip-verified      Skip parts that have latex_verified = true
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const PRIMARY_FILTER = getArg('--primary');
const SUBTOPIC_FILTER = getArg('--subtopic');
const CODE_PATTERN = getArg('--code');
const LEVEL_FILTER = getArg('--level');
const PAPER_FILTER = getArg('--paper');
const LIMIT = parseInt(getArg('--limit') ?? '20', 10);
const DRY_RUN = args.includes('--dry-run');
const SKIP_VERIFIED = args.includes('--skip-verified');

if (!PRIMARY_FILTER && !SUBTOPIC_FILTER && !CODE_PATTERN && !LEVEL_FILTER && !PAPER_FILTER) {
  console.error(
    'Error: provide at least one filter: --primary <code>, --subtopic <code>,\n' +
    '  --code <pattern>, --level <SL|HL>, or --paper <P1|P2|P3>'
  );
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ── IB Classify System Prompt ─────────────────────────────────────────────────
// Inline copy of IB_CLASSIFY_SYSTEM from lib/latex-utils.ts.
// Keep in sync with the source file.
const IB_CLASSIFY_SYSTEM = `You are an expert IBDP Mathematics question analyst.
Given question and mark scheme LaTeX for an IB Mathematics past paper question, analyse the content and return a JSON object.

Count marks by looking for IB mark codes in the mark scheme:
- M1 or (M1): Method mark — counts as 1 mark
- A1 or (A1): Accuracy mark — counts as 1 mark
- R1: Reasoning mark — counts as 1 mark
- AG: Answer given — does NOT count as a mark
- ft, N0, N1, N2, N3: do not add to the total

Sum marks per part label, e.g. everything under "(a)" in the mark scheme counts toward part "a".

Identify the mathematical command term for each part from the question text (e.g. Find, Calculate, Show that, Prove that, Hence, Describe, Sketch, Write down, Determine, Solve, etc.).

From the available subtopics list provided, choose up to 3 subtopic codes that best match the mathematical content of each part.

Return ONLY a valid JSON object with NO markdown fences, NO explanation, in exactly this format:
{
  "parts": [
    { "label": "a", "marks": 4, "commandTerm": "Find", "primarySubtopicCode": "5.1", "subtopicCodes": ["2.1", "5.1"] },
    { "label": "b", "marks": 2, "commandTerm": "Hence", "primarySubtopicCode": "5.1", "subtopicCodes": ["5.1"] }
  ]
}

**primarySubtopicCode** must be one of the codes in \`subtopicCodes\`. If there is only one subtopic code, it is also the primary.
If sub-parts are nested (e.g. (b)(i), (b)(ii)), use combined labels "bi", "bii" etc.
If the question has no sub-parts, return a single entry with label "".`;

// ── Fetch available subtopics ─────────────────────────────────────────────────
const { data: subtopicsRows, error: stErr } = await supabase
  .from('subtopics')
  .select('code, descriptor')
  .order('code');

if (stErr || !subtopicsRows) {
  console.error('Failed to load subtopics:', stErr?.message);
  process.exit(1);
}
const subtopicList = subtopicsRows.map(s => `${s.code}: ${s.descriptor}`).join('\n');
console.log(`Loaded ${subtopicsRows.length} subtopics.`);

// ── Find matching questions ───────────────────────────────────────────────────
let questionIds = null;

// Filter by primary or subtopic code requires a parts join
if (PRIMARY_FILTER || SUBTOPIC_FILTER) {
  let partsQuery = supabase.from('question_parts').select('question_id');
  if (PRIMARY_FILTER) partsQuery = partsQuery.eq('primary_subtopic_code', PRIMARY_FILTER);
  if (SUBTOPIC_FILTER) partsQuery = partsQuery.contains('subtopic_codes', [SUBTOPIC_FILTER]);

  const { data: partRows, error: pErr } = await partsQuery;
  if (pErr) { console.error('Part filter failed:', pErr.message); process.exit(1); }
  questionIds = [...new Set((partRows ?? []).map(r => r.question_id))];
  console.log(`Parts filter matched ${questionIds.length} distinct questions.`);
}

// Now query ib_questions
let qQuery = supabase.from('ib_questions').select('id, code, level, paper').limit(LIMIT);
if (questionIds !== null) qQuery = qQuery.in('id', questionIds.slice(0, 500));
if (CODE_PATTERN) qQuery = qQuery.ilike('code', `%${CODE_PATTERN}%`);
if (LEVEL_FILTER) qQuery = qQuery.eq('level', LEVEL_FILTER.toUpperCase());
if (PAPER_FILTER) qQuery = qQuery.eq('paper', PAPER_FILTER.toUpperCase());

const { data: questions, error: qErr } = await qQuery.limit(LIMIT);
if (qErr || !questions) { console.error('Question query failed:', qErr?.message); process.exit(1); }

console.log(`Processing ${questions.length} question(s)${DRY_RUN ? ' [DRY RUN]' : ''}...\n`);

// ── Process each question ────────────────────────────────────────────────────
let updated = 0;
let skipped = 0;
let errors = 0;

for (const question of questions) {
  console.log(`\n── ${question.code} ──`);

  // Fetch all parts for this question
  const { data: parts, error: partsErr } = await supabase
    .from('question_parts')
    .select('id, part_label, content_latex, markscheme_latex, subtopic_codes, primary_subtopic_code, latex_verified')
    .eq('question_id', question.id)
    .order('part_label');

  if (partsErr || !parts?.length) {
    console.log('  No parts found, skipping.');
    skipped++;
    continue;
  }

  // Build LaTeX input
  const qLatex = parts.map(p => {
    const label = p.part_label ? `(${p.part_label})` : '';
    return `${label} ${p.content_latex ?? ''}`.trim();
  }).join('\n\n');

  const msLatex = parts.map(p => {
    const label = p.part_label ? `(${p.part_label})` : '';
    return `${label} ${p.markscheme_latex ?? ''}`.trim();
  }).join('\n\n');

  if (!qLatex.trim() && !msLatex.trim()) {
    console.log('  No LaTeX content, skipping.');
    skipped++;
    continue;
  }

  const knownLabels = parts.map(p => p.part_label ?? '').filter(Boolean).join(', ') || 'unknown';

  // Call Claude
  let claudeParts = [];
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: IB_CLASSIFY_SYSTEM,
      messages: [{
        role: 'user',
        content:
          `Question LaTeX:\n\`\`\`\n${qLatex}\n\`\`\`\n\n` +
          `Mark Scheme LaTeX:\n\`\`\`\n${msLatex}\n\`\`\`\n\n` +
          `Available subtopics:\n${subtopicList}\n\n` +
          `Known part labels: ${knownLabels}`,
      }],
    });

    const text = response.content?.[0]?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    claudeParts = JSON.parse(jsonMatch[0]).parts ?? [];
  } catch (err) {
    console.error('  Claude error:', err.message);
    errors++;
    continue;
  }

  console.log(`  Claude returned ${claudeParts.length} part(s): ${claudeParts.map(p => p.label || '(whole)').join(', ')}`);

  // Match Claude output back to DB parts
  for (const part of parts) {
    if (SKIP_VERIFIED && part.latex_verified) {
      console.log(`  part ${part.part_label ?? ''}: skipped (verified)`);
      continue;
    }

    // Find matching Claude part by label (normalize: strip spaces, lowercase)
    const normalizeLabel = (l) => (l ?? '').toLowerCase().replace(/\s+/g, '');
    const dbLabel = normalizeLabel(part.part_label);
    const claudePart = claudeParts.find(p => normalizeLabel(p.label) === dbLabel)
      ?? (parts.length === 1 ? claudeParts[0] : null);

    if (!claudePart) {
      console.log(`  part ${part.part_label ?? '(whole)'}: no matching Claude output, skipping`);
      continue;
    }

    const newCodes = Array.isArray(claudePart.subtopicCodes) ? claudePart.subtopicCodes : [];
    const newPrimary = claudePart.primarySubtopicCode ?? newCodes[0] ?? null;

    const oldCodes = JSON.stringify(part.subtopic_codes ?? []);
    const newCodesStr = JSON.stringify(newCodes);
    const changed = oldCodes !== newCodesStr || part.primary_subtopic_code !== newPrimary;

    console.log(
      `  part ${part.part_label ?? '(whole)'}: ${part.subtopic_codes?.join(',') ?? 'none'} → ${newCodes.join(',')} ` +
      `(primary: ${part.primary_subtopic_code ?? 'none'} → ${newPrimary ?? 'none'})` +
      (changed ? '' : ' [no change]')
    );

    if (!changed) continue;

    if (!DRY_RUN) {
      const { error: uErr } = await supabase
        .from('question_parts')
        .update({ subtopic_codes: newCodes, primary_subtopic_code: newPrimary })
        .eq('id', part.id);

      if (uErr) {
        console.error(`  ✗ DB update failed:`, uErr.message);
        errors++;
      } else {
        updated++;
      }
    } else {
      updated++;
    }
  }
}

console.log(`\n── Done ──`);
console.log(`Updated: ${updated} part(s), Skipped: ${skipped} question(s), Errors: ${errors}`);
if (DRY_RUN) console.log('(dry run — no changes written)');
