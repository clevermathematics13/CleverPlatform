#!/usr/bin/env node
/**
 * OCR all question images from Supabase Storage using Tesseract,
 * then save the extracted text back to question_parts.content_text / markscheme_text.
 *
 * Run: node scripts/ocr-images.js [--dry-run] [--limit N] [--question CODE]
 */

const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : Infinity; })();
const FILTER_Q = (() => { const i = args.indexOf('--question'); return i >= 0 ? args[i + 1] : null; })();
const MATH_MODE = !args.includes('--no-math'); // use math-friendly PSM by default

// ── Supabase ──────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
process.on('exit', () => fs.rmSync(tmpDir, { recursive: true, force: true }));

function ocrImage(imgBuffer) {
  const imgPath = path.join(tmpDir, 'img.png');
  const outBase = path.join(tmpDir, 'out');
  fs.writeFileSync(imgPath, imgBuffer);
  // PSM 6 = assume a single uniform block of text (good for question images)
  // --oem 3 = LSTM engine
  execSync(`tesseract "${imgPath}" "${outBase}" --oem 3 --psm 6 -l eng 2>/dev/null`);
  const txt = fs.readFileSync(outBase + '.txt', 'utf8').trim();
  if (fs.existsSync(outBase + '.txt')) fs.unlinkSync(outBase + '.txt');
  return txt;
}

async function downloadImage(storagePath) {
  const { data, error } = await supabase.storage
    .from('question-images')
    .download(storagePath);
  if (error) throw new Error(`Download failed for ${storagePath}: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return buf;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Math PSM: ${MATH_MODE} | Limit: ${LIMIT === Infinity ? 'none' : LIMIT}`);
  if (FILTER_Q) console.log(`Filtering to question: ${FILTER_Q}`);

  // 1. Get all question_images, optionally filtered
  let imgQuery = supabase
    .from('question_images')
    .select('id, question_id, part_id, image_type, storage_path, sort_order')
    .order('question_id')
    .order('image_type')
    .order('sort_order');

  if (FILTER_Q) {
    // Resolve question code → id first
    const { data: qRows } = await supabase
      .from('ib_questions')
      .select('id')
      .eq('code', FILTER_Q)
      .limit(1);
    if (!qRows?.length) { console.error('Question not found:', FILTER_Q); process.exit(1); }
    imgQuery = imgQuery.eq('question_id', qRows[0].id);
  }

  const { data: allImages, error: imgErr } = await imgQuery;
  if (imgErr) { console.error('Failed to load images:', imgErr.message); process.exit(1); }

  // 2. Load all question_parts for context
  const { data: allParts } = await supabase
    .from('question_parts')
    .select('id, question_id, part_label, sort_order, content_text, markscheme_text');

  // Index parts by question_id for lookup
  const partsByQ = new Map();
  (allParts || []).forEach(p => {
    if (!partsByQ.has(p.question_id)) partsByQ.set(p.question_id, []);
    partsByQ.get(p.question_id).push(p);
  });

  // 3. Group images by (question_id, image_type) and accumulate OCR text per part
  // Structure: { question_id → { image_type → { part_id|'__all__' → [sorted texts] } } }
  const imageGroups = new Map(); // key: `${question_id}|${image_type}|${part_id ?? '__all__'}`
  allImages.forEach(img => {
    const key = `${img.question_id}|${img.image_type}|${img.part_id ?? '__all__'}`;
    if (!imageGroups.has(key)) imageGroups.set(key, { img_type: img.image_type, question_id: img.question_id, part_id: img.part_id, images: [] });
    imageGroups.get(key).images.push(img);
  });

  // Sort images within each group by sort_order
  for (const group of imageGroups.values()) {
    group.images.sort((a, b) => a.sort_order - b.sort_order);
  }

  const groups = [...imageGroups.values()];
  const limited = groups.slice(0, LIMIT === Infinity ? groups.length : LIMIT);
  console.log(`\nTotal image groups to process: ${limited.length} (of ${groups.length} total)\n`);

  let processed = 0;
  let saved = 0;
  let errors = 0;

  for (const group of limited) {
    const { question_id, part_id, img_type, images } = group;

    // Get question code for display
    const { data: qRow } = await supabase.from('ib_questions').select('code').eq('id', question_id).single();
    const qCode = qRow?.code ?? question_id;

    // OCR each image in sort order, concatenate with newlines
    const texts = [];
    for (const img of images) {
      try {
        process.stdout.write(`  OCR ${qCode} [${img_type}] ${img.storage_path} ... `);
        const buf = await downloadImage(img.storage_path);
        const text = ocrImage(buf);
        texts.push(text);
        console.log(`${text.length} chars`);
      } catch (e) {
        console.log(`ERROR: ${e.message}`);
        errors++;
      }
      await sleep(50); // small delay to avoid hammering storage
    }

    if (texts.length === 0) continue;
    const combinedText = texts.join('\n\n---\n\n');

    // Find which part(s) to update
    // If part_id is set → update that specific part
    // If part_id is null → update all parts for this question that lack text
    const partsForQ = partsByQ.get(question_id) || [];

    const partsToUpdate = part_id
      ? partsForQ.filter(p => p.id === part_id)
      : partsForQ; // will apply to all parts (whole-question images)

    if (partsToUpdate.length === 0) {
      console.log(`  ⚠ No parts found for ${qCode}, skipping save`);
    } else {
      for (const part of partsToUpdate) {
        const field = img_type === 'markscheme' ? 'markscheme_text' : 'content_text';
        const existing = part[field];

        if (existing && existing.trim().length > 0) {
          console.log(`  ⏭ ${qCode} part ${part.part_label || '–'} ${field} already has text, skipping`);
          continue;
        }

        console.log(`  → ${DRY_RUN ? '[DRY RUN] would update' : 'Saving'} ${qCode} part '${part.part_label || '–'}' ${field} (${combinedText.length} chars)`);

        if (!DRY_RUN) {
          const { error: updateErr } = await supabase
            .from('question_parts')
            .update({ [field]: combinedText })
            .eq('id', part.id);
          if (updateErr) {
            console.log(`  ✗ Save failed: ${updateErr.message}`);
            errors++;
          } else {
            // Update local cache so we don't overwrite on next loop
            part[field] = combinedText;
            saved++;
          }
        }
      }
    }

    processed++;
    console.log();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Done. Groups processed: ${processed} | Parts saved: ${saved} | Errors: ${errors}`);
  if (DRY_RUN) console.log('(Dry run — no changes written)');
}

main().catch(e => { console.error(e); process.exit(1); });
