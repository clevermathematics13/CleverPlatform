/**
 * Extract LaTeX from images for a single question using Claude vision.
 *
 * Usage:
 *   node scripts/extract-one-question.mjs <question-code> [--dry-run]
 *
 * Example:
 *   node scripts/extract-one-question.mjs 07M.1.AHL.TZ1.H_1
 *   node scripts/extract-one-question.mjs 07M.1.AHL.TZ1.H_1 --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const questionCode = args.find(a => !a.startsWith('--'));
const DRY_RUN = args.includes('--dry-run');

if (!questionCode) {
  console.error('Usage: node scripts/extract-one-question.mjs <question-code> [--dry-run]');
  process.exit(1);
}

// ── Config ──────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MATHPIX_APP_ID = env.MATHPIX_APP_ID;
const MATHPIX_APP_KEY = env.MATHPIX_APP_KEY;
const USE_MATHPIX = !!(MATHPIX_APP_ID && MATHPIX_APP_KEY);

console.log(`OCR engine: ${USE_MATHPIX ? 'MathPix (math-optimised)' : 'Claude vision (fallback — add MATHPIX_APP_ID + MATHPIX_APP_KEY to .env.local for better results)'}`);

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`\nExtracting LaTeX for: ${questionCode}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

// 1. Find the question
const { data: question, error: qErr } = await supabase
  .from('ib_questions')
  .select('id, code')
  .eq('code', questionCode)
  .single();

if (qErr || !question) {
  console.error('Question not found:', questionCode);
  process.exit(1);
}
console.log('Found question:', question.id);

// 2. Get its parts
const { data: parts } = await supabase
  .from('question_parts')
  .select('id, part_label, sort_order, content_latex, markscheme_latex')
  .eq('question_id', question.id)
  .order('sort_order');

console.log(`Parts: ${parts?.length ?? 0}`);
if (!parts?.length) {
  console.error('No question parts found.');
  process.exit(1);
}

// 3. Get images grouped by type
const { data: images } = await supabase
  .from('question_images')
  .select('id, image_type, storage_path, sort_order, part_id')
  .eq('question_id', question.id)
  .order('sort_order');

const questionImages = (images ?? []).filter(i => i.image_type === 'question').sort((a, b) => a.sort_order - b.sort_order);
const msImages = (images ?? []).filter(i => i.image_type === 'markscheme').sort((a, b) => a.sort_order - b.sort_order);

console.log(`Question images: ${questionImages.length}, Markscheme images: ${msImages.length}\n`);

if (!questionImages.length && !msImages.length) {
  console.error('No images found for this question. Cannot extract LaTeX.');
  process.exit(1);
}

// 4. Download image helper (signed URL → base64)
async function downloadImageAsBase64(storagePath) {
  const { data, error } = await supabase.storage
    .from('question-images')
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) throw new Error(`Failed to get signed URL for ${storagePath}: ${error?.message}`);

  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`Failed to download ${storagePath}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

// Post-process raw MathPix output to match IB past-paper list style:
// replace default enumerate environments with the custom IBPart environment.
function postProcessMathpixLatex(raw) {
  return raw
    .replaceAll('\\begin{enumerate}', '\\begin{IBPart}')
    .replaceAll('\\end{enumerate}', '\\end{IBPart}');
}

// 5. LaTeX extraction — MathPix if keys present, else Claude vision
async function extractLatexFromImages(imageB64Array, isMarkscheme) {
  if (USE_MATHPIX) {
    // MathPix: OCR each image separately, concatenate results
    const parts = [];
    for (const b64 of imageB64Array) {
      const res = await fetch('https://api.mathpix.com/v3/text', {
        method: 'POST',
        headers: {
          'app_id': MATHPIX_APP_ID,
          'app_key': MATHPIX_APP_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          src: `data:image/png;base64,${b64}`,
          formats: ['latex_styled'],
          math_inline_delimiters: ['$', '$'],
          math_display_delimiters: ['$$', '$$'],
        }),
      });
      if (!res.ok) throw new Error(`MathPix error: ${res.status} ${await res.text()}`);
      const json = await res.json();
      if (json.error) throw new Error(`MathPix: ${json.error}`);
      parts.push(postProcessMathpixLatex(json.latex_styled ?? json.text ?? ''));
    }
    return parts.join('\n\n');
  }

  // Fallback: Claude vision
  const prompt = isMarkscheme
    ? `These are images of an IB Mathematics mark scheme. Extract the complete LaTeX for the solution/mark scheme shown. Return ONLY the LaTeX content, no explanation, no markdown fences. Use standard LaTeX math notation with $ or $$ delimiters.`
    : `These are images of an IB Mathematics exam question. Extract the complete LaTeX for the question shown. Return ONLY the LaTeX content, no explanation, no markdown fences. Use standard LaTeX math notation with $ or $$ delimiters.`;

  const imageContent = imageB64Array.map(b64 => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: b64 },
  }));

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [...imageContent, { type: 'text', text: prompt }],
    }],
  });

  return response.content[0].type === 'text' ? response.content[0].text.trim() : '';
}

// 6. Process question images
if (questionImages.length > 0) {
  console.log('Downloading question images...');
  const b64s = await Promise.all(questionImages.map(img => downloadImageAsBase64(img.storage_path)));
  console.log('Sending to Claude for LaTeX extraction...');
  const latex = await extractLatexFromImages(b64s, false);
  console.log('\n── Extracted question LaTeX ──────────────────────────');
  console.log(latex);
  console.log('──────────────────────────────────────────────────────\n');

  if (!DRY_RUN) {
    // Save to all parts (whole-question image covers all parts)
    for (const part of parts) {
      const { error } = await supabase
        .from('question_parts')
        .update({ content_latex: latex })
        .eq('id', part.id);
      if (error) console.error(`Failed to save content_latex for part ${part.id}:`, error.message);
      else console.log(`  ✓ Saved content_latex to part ${part.part_label || '(unlabelled)'}`);
    }
  } else {
    console.log('[DRY RUN] Would save the above to content_latex for all parts.');
  }
}

// 7. Process markscheme images
if (msImages.length > 0) {
  console.log('\nDownloading markscheme images...');
  const b64s = await Promise.all(msImages.map(img => downloadImageAsBase64(img.storage_path)));
  console.log('Sending to Claude for LaTeX extraction...');
  const latex = await extractLatexFromImages(b64s, true);
  console.log('\n── Extracted markscheme LaTeX ────────────────────────');
  console.log(latex);
  console.log('──────────────────────────────────────────────────────\n');

  if (!DRY_RUN) {
    for (const part of parts) {
      const { error } = await supabase
        .from('question_parts')
        .update({ markscheme_latex: latex })
        .eq('id', part.id);
      if (error) console.error(`Failed to save markscheme_latex for part ${part.id}:`, error.message);
      else console.log(`  ✓ Saved markscheme_latex to part ${part.part_label || '(unlabelled)'}`);
    }
  } else {
    console.log('[DRY RUN] Would save the above to markscheme_latex for all parts.');
  }
}

console.log('\nDone.');
