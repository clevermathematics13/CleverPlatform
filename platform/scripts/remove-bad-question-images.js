#!/usr/bin/env node
/**
 * Remove every question image whose bytes match a target example image.
 *
 * Usage:
 *   node scripts/remove-bad-question-images.js --target 07M.1.AHL.TZ1.H_10/markscheme/02.png --dry-run
 *   node scripts/remove-bad-question-images.js --target 'https://.../storage/v1/object/sign/question-images/...png?token=...' --dry-run
 *   node scripts/remove-bad-question-images.js --target vector_AB.png --write-blocklist
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const targetSpec = targetIndex >= 0 ? args[targetIndex + 1] : null;
const dryRun = args.includes('--dry-run');
const writeBlocklist = args.includes('--write-blocklist');

if (!targetSpec) {
  console.error('Usage: node scripts/remove-bad-question-images.js --target <storage_path> [--dry-run] [--write-blocklist]');
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const blocklistPath = path.join(__dirname, '../src/lib/question-image-blocklist.json');

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function downloadBuffer(storagePath) {
  const downloadPromise = supabase.storage.from('question-images').download(storagePath);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Download timed out for ${storagePath}`)), 15000);
  });

  const { data, error } = await Promise.race([downloadPromise, timeoutPromise]);
  if (error) throw new Error(`Download failed for ${storagePath}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

function extractStoragePathFromUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const markers = [
    '/storage/v1/object/sign/question-images/',
    '/storage/v1/object/public/question-images/',
    '/storage/v1/object/authenticated/question-images/',
  ];

  for (const marker of markers) {
    const index = parsed.pathname.indexOf(marker);
    if (index >= 0) {
      return decodeURIComponent(parsed.pathname.slice(index + marker.length));
    }
  }

  return null;
}

function resolveLocalTarget(rawTarget) {
  const candidates = [
    path.resolve(process.cwd(), rawTarget),
    path.resolve(__dirname, '..', rawTarget),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

async function loadTarget(rawTarget) {
  const localPath = resolveLocalTarget(rawTarget);
  if (localPath) {
    return {
      label: path.relative(process.cwd(), localPath),
      buffer: fs.readFileSync(localPath),
    };
  }

  const storagePath = extractStoragePathFromUrl(rawTarget) ?? rawTarget;
  const buffer = await downloadBuffer(storagePath);
  return {
    label: storagePath,
    buffer,
  };
}

function readBlocklist() {
  return JSON.parse(fs.readFileSync(blocklistPath, 'utf8'));
}

function writeHashToBlocklist(hash) {
  const blocklist = readBlocklist();
  const nextHashes = new Set([...(blocklist.sha256 ?? []), hash]);
  fs.writeFileSync(blocklistPath, JSON.stringify({ sha256: [...nextHashes].sort() }, null, 2) + '\n');
}

async function loadQuestionCodeMap(questionIds) {
  const questionCodeById = new Map();
  const uniqueIds = [...new Set(questionIds)];

  for (let i = 0; i < uniqueIds.length; i += 200) {
    const chunk = uniqueIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('ib_questions')
      .select('id, code')
      .in('id', chunk);

    if (error) {
      throw new Error(`Failed to load question codes: ${error.message}`);
    }

    for (const row of data ?? []) {
      questionCodeById.set(row.id, row.code);
    }
  }

  return questionCodeById;
}

async function loadAllQuestionImages() {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('question_images')
      .select('id, question_id, image_type, storage_path')
      .order('question_id')
      .order('image_type')
      .order('storage_path')
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load question_images: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

async function main() {
  const target = await loadTarget(targetSpec);
  const targetHash = sha256Hex(target.buffer);

  console.log(`Target source: ${target.label}`);
  console.log(`Target hash: ${targetHash}`);

  if (writeBlocklist) {
    writeHashToBlocklist(targetHash);
    console.log(`Added hash to ${path.relative(process.cwd(), blocklistPath)}`);
  }

  const images = await loadAllQuestionImages();

  const questionCodeById = await loadQuestionCodeMap(images.map((row) => row.question_id));
  const matches = [];

  for (let i = 0; i < images.length; i++) {
    const row = images[i];

    if ((i + 1) % 100 === 0) {
      console.log(`Checked ${i + 1}/${images.length} images...`);
    }

    let buffer;
    try {
      buffer = await downloadBuffer(row.storage_path);
    } catch (downloadError) {
      console.warn(downloadError.message);
      continue;
    }

    if (sha256Hex(buffer) === targetHash) {
      matches.push({
        id: row.id,
        questionId: row.question_id,
        code: questionCodeById.get(row.question_id) ?? 'unknown',
        imageType: row.image_type,
        storagePath: row.storage_path,
      });
    }
  }

  console.log(`Found ${matches.length} matching question_images rows.`);

  if (matches.length === 0) {
    return;
  }

  for (const match of matches.slice(0, 20)) {
    console.log(`${match.code} | ${match.imageType} | ${match.storagePath}`);
  }
  if (matches.length > 20) {
    console.log(`...and ${matches.length - 20} more`);
  }

  if (dryRun) {
    console.log('Dry run only. No storage objects or database rows were removed.');
    return;
  }

  const uniqueStoragePaths = [...new Set(matches.map((match) => match.storagePath))];
  let storageDeletes = 0;
  let dbDeletes = 0;

  for (const storagePath of uniqueStoragePaths) {
    const { error: storageError } = await supabase.storage
      .from('question-images')
      .remove([storagePath]);

    if (storageError) {
      console.warn(`Storage delete failed for ${storagePath}: ${storageError.message}`);
      continue;
    }

    storageDeletes++;
  }

  const ids = matches.map((match) => match.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error: deleteError } = await supabase
      .from('question_images')
      .delete()
      .in('id', chunk);

    if (deleteError) {
      console.warn(`Database delete failed for chunk starting at ${i}: ${deleteError.message}`);
      continue;
    }

    dbDeletes += chunk.length;
  }

  console.log(`Deleted ${storageDeletes}/${uniqueStoragePaths.length} storage objects.`);
  console.log(`Deleted ${dbDeletes}/${ids.length} question_images rows.`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});