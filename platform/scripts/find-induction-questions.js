const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: parts, error: e1 } = await supabase
    .from('question_parts')
    .select('question_id, part_label, subtopic_codes')
    .contains('subtopic_codes', ['1.15 (ind)']);

  if (e1) { console.error('parts error:', e1.message); return; }

  const qids = [...new Set(parts.map(p => p.question_id))];
  const { data: qs } = await supabase
    .from('ib_questions')
    .select('id, code, session, paper, level')
    .in('id', qids);

  const qMap = new Map(qs.map(q => [q.id, q]));

  const { data: imgs } = await supabase
    .from('question_images')
    .select('question_id, image_type, storage_path, sort_order')
    .in('question_id', qids);

  const imgsByQ = new Map();
  (imgs || []).forEach(img => {
    if (!imgsByQ.has(img.question_id)) imgsByQ.set(img.question_id, []);
    imgsByQ.get(img.question_id).push(img);
  });

  console.log('=== Questions tagged: Proof by Induction (1.15 ind) ===\n');
  const seen = new Set();
  parts.forEach(part => {
    const q = qMap.get(part.question_id);
    if (!q) return;
    const partLabel = part.part_label ? (' part ' + part.part_label) : ' (whole question)';
    const qImgs = imgsByQ.get(part.question_id) || [];
    const imgStatus = qImgs.length > 0 ? (qImgs.length + ' image(s)') : 'NO IMAGES IN DB';
    console.log(q.code + partLabel + '   ' + imgStatus);
    if (qImgs.length > 0 && !seen.has(part.question_id)) {
      qImgs.forEach(i => console.log('   [' + i.image_type + '] ' + i.storage_path));
    }
    seen.add(part.question_id);
  });

  console.log('\nTotal unique questions:', qids.length);
  const withImgs = qids.filter(id => (imgsByQ.get(id) || []).length > 0);
  console.log('Questions with images in DB:', withImgs.length);
  console.log('Questions with NO images in DB:', qids.length - withImgs.length);
}

main().catch(console.error);
