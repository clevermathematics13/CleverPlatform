/**
 * One-shot script: apply a corrected graphSpec to a question's stem_latex.
 *
 * Usage:
 *   node scripts/patch-graph-spec.mjs [--dry-run]
 *
 * Hard-coded correction:
 *   Question: 25N.1.SL.TZ1.S_7  (id: 00046174-47cf-43d0-86fa-dad8a71d747b)
 *   Fix: Replace wrong parabola GRAPH_JSON with corrected linear h(x) = 0.5x-1
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Config ───────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── Corrected spec ───────────────────────────────────────────────────────────
const QUESTION_ID = '00046174-47cf-43d0-86fa-dad8a71d747b';

const CORRECTED_SPEC = {
  xRange: [-3.5, 3.5],
  yRange: [-3.5, 3.5],
  elements: [
    { type: 'line', expr: '0.5*x-1', dashed: false, xMin: -3, xMax: 3, color: '#000000', label: 'h' },
    { type: 'label', x: 3.2, y: 0.7, text: 'y = h(x)' },
    { type: 'point', x: 2, y: 0, label: '(2, 0)', open: false },
    { type: 'point', x: 0, y: -1, label: '(0, -1)', open: false },
  ],
};

// ── Encode (mirrors encodeGraphSpec in IbGraph.tsx) ──────────────────────────
function encodeGraphSpec(spec) {
  return `[[GRAPH_JSON:${Buffer.from(JSON.stringify(spec)).toString('base64')}]]`;
}

const GRAPH_MARKER_RE = /\[\[GRAPH_JSON:([A-Za-z0-9+/=]+)\]\]/g;

// ── Main ─────────────────────────────────────────────────────────────────────
const { data: row, error } = await supabase
  .from('ib_questions')
  .select('id, code, stem_latex')
  .eq('id', QUESTION_ID)
  .single();

if (error || !row) {
  console.error('Failed to fetch question:', error?.message ?? 'not found');
  process.exit(1);
}

console.log(`Question: ${row.code} (${row.id})`);
console.log(`Current stem_latex length: ${(row.stem_latex ?? '').length} chars`);

const marker = encodeGraphSpec(CORRECTED_SPEC);
const current = row.stem_latex ?? '';

GRAPH_MARKER_RE.lastIndex = 0;
const hasExisting = GRAPH_MARKER_RE.test(current);

const newStemLatex = hasExisting
  ? current.replace(GRAPH_MARKER_RE, marker)
  : `${current.trim()}\n\n${marker}`;

console.log(`\nAction: ${hasExisting ? 'REPLACE existing GRAPH_JSON marker' : 'APPEND new GRAPH_JSON marker'}`);
console.log(`New marker (first 120 chars): ${marker.slice(0, 120)}…`);

if (DRY_RUN) {
  console.log('\n[DRY RUN] No changes written.');
  process.exit(0);
}

const { error: updateError } = await supabase
  .from('ib_questions')
  .update({ stem_latex: newStemLatex })
  .eq('id', QUESTION_ID);

if (updateError) {
  console.error('Update failed:', updateError.message);
  process.exit(1);
}

console.log('\n✅ stem_latex updated successfully.');
