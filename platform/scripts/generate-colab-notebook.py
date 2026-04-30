"""
Generates colab/ib_ocr_pipeline.ipynb
Run: python scripts/generate-colab-notebook.py
"""
import json, os, uuid

def mid():
    return uuid.uuid4().hex[:8]

def mdc(source: str):
    return {"cell_type": "markdown", "id": mid(), "metadata": {}, "source": source}

def cc(source: str):
    return {
        "cell_type": "code", "execution_count": None,
        "id": mid(), "metadata": {}, "outputs": [], "source": source,
    }

# ---------------------------------------------------------------------------
cells = []

# ── 0 · Title ───────────────────────────────────────────────────────────────
cells.append(mdc("""\
# IB Mathematics PDF → LaTeX OCR Pipeline

**Before running** — open the 🔑 **Secrets** panel in the Colab left sidebar and add:

| Secret name | Where to find it |
|---|---|
| `MATHPIX_APP_ID` | console.mathpix.com → Apps |
| `MATHPIX_APP_KEY` | console.mathpix.com → Apps |
| `SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

PDFs are read recursively from **My Drive › IB › DP › PPQs**.  
Results are written to your Supabase `ib_questions` + `question_parts` tables and reviewable in the **LaTeX Review** page of the platform.
"""))

# ── 1 · Install ──────────────────────────────────────────────────────────────
cells.append(cc("""\
# Install system dependencies and Python packages (run once per Colab session)
!apt-get install -q poppler-utils
!pip install -q pdf2image pillow supabase anthropic requests
"""))

# ── 2 · Mount Drive + load secrets ──────────────────────────────────────────
cells.append(cc("""\
from google.colab import drive, userdata

drive.mount('/content/drive')

MATHPIX_APP_ID          = userdata.get('MATHPIX_APP_ID')
MATHPIX_APP_KEY         = userdata.get('MATHPIX_APP_KEY')
SUPABASE_URL            = userdata.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = userdata.get('SUPABASE_SERVICE_ROLE_KEY')
ANTHROPIC_API_KEY       = userdata.get('ANTHROPIC_API_KEY')

print('Secrets loaded:')
print('  MathPix  :', bool(MATHPIX_APP_ID and MATHPIX_APP_KEY))
print('  Supabase :', bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY))
print('  Anthropic:', bool(ANTHROPIC_API_KEY))
"""))

# ── 3 · Find PDFs ────────────────────────────────────────────────────────────
cells.append(cc("""\
import os

PPQ_ROOT = '/content/drive/MyDrive/IB/DP/PPQs'

pdf_files = []
for root, dirs, files in os.walk(PPQ_ROOT):
    for f in files:
        if f.lower().endswith('.pdf'):
            pdf_files.append(os.path.join(root, f))

pdf_files.sort()
print('Found', len(pdf_files), 'PDFs:')
for p in pdf_files:
    print(' ', p.replace(PPQ_ROOT + '/', ''))
"""))

# ── 4 · parse_pdf_metadata ───────────────────────────────────────────────────
cells.append(cc("""\
import re

# ── IB session code format ─────────────────────────────────────────────────
# Filename format:  {SESSION}.{PAPER}.{CURRICULUM}.{TZ}[.{QUESTION}].pdf
#
# SESSION:  18M → May 2018 | 19N → Nov 2019 | SPM → Specimen | EXN → Example
# Question numbers are determined by Claude from the PDF content, not the filename.

CURRICULUM_MAP = {
    'AHL': ('HL', 'IB AA'),
    'ASL': ('SL', 'IB AA'),
    'AIH': ('HL', 'IB AI'),
    'AIS': ('SL', 'IB AI'),
}

def parse_session_code(token):
    token = token.upper()
    if token in ('SPM', 'EXN', 'SPECIMEN', 'EXAMPLE'):
        return token[:3]
    m = re.match(r'^(\\d{2,4})([MN])$', token)
    if m:
        return m.group(2) + m.group(1)[-2:]   # 18M → M18
    m = re.match(r'^([MN])(\\d{2,4})$', token)
    if m:
        return m.group(1) + m.group(2)[-2:]
    return None


def parse_pdf_metadata(pdf_path):
    \"\"\"
    Parse IB exam metadata from the filename.

    Standard IB PPQ format:
      {SESSION}.{PAPER}.{CURRICULUM}.{TZ}[.{QUESTION}].pdf
    e.g. 18M.2.AHL.TZ1.H_10.pdf | SPM.1.AHL.TZ0.H_4.pdf | EXN.2.AHL.TZ0.1.pdf

    Question numbers are NOT extracted here — Claude reads them from the PDF content.
    \"\"\"
    rel      = pdf_path.replace(PPQ_ROOT + '/', '')
    filename = os.path.splitext(os.path.basename(rel))[0]
    tokens   = filename.split('.')

    meta = {
        'source_pdf_path': rel,
        'level'          : None,
        'paper'          : None,
        'session'        : None,
        'timezone'       : None,
        'curriculum'     : 'IB AA',
        'is_markscheme'  : False,
    }

    # ── Structured IB format: SESSION.PAPER.CURRICULUM.TZ[.QUESTION] ──────
    if len(tokens) >= 4:
        session = parse_session_code(tokens[0])
        if session:
            meta['session'] = session

            try:
                meta['paper'] = int(tokens[1])
            except (ValueError, IndexError):
                pass

            curriculum_token = tokens[2].upper() if len(tokens) > 2 else ''
            if curriculum_token in CURRICULUM_MAP:
                meta['level'], meta['curriculum'] = CURRICULUM_MAP[curriculum_token]
            elif 'HL' in curriculum_token:
                meta['level'] = 'HL'
            elif 'SL' in curriculum_token:
                meta['level'] = 'SL'

            tz_token = tokens[3].upper() if len(tokens) > 3 else ''
            if re.match(r'^TZ\\d$', tz_token):
                meta['timezone'] = tz_token

    # ── Keyword fallback for non-standard filenames ────────────────────────
    text = rel.upper()

    if not meta['level']:
        if 'AHL' in text or ' HL' in text or '_HL' in text or 'HIGHER' in text:
            meta['level'] = 'HL'
        elif 'ASL' in text or ' SL' in text or '_SL' in text or 'STANDARD' in text:
            meta['level'] = 'SL'

    if not meta['paper']:
        for p in ['PAPER 3', 'PAPER3', 'PAPER 2', 'PAPER2', 'PAPER 1', 'PAPER1']:
            if p in text:
                meta['paper'] = int(p[-1])
                break

    if not meta['session']:
        m = re.search(r'([MN])(\\d{2,4})', text)
        if m:
            meta['session'] = m.group(1) + m.group(2)[-2:]

    if not meta['timezone']:
        for tz in ['TZ0', 'TZ1', 'TZ2']:
            if tz in text:
                meta['timezone'] = tz
                break

    if any(tok in text for tok in ['MARKSCHEME', 'MARK SCHEME', 'MARK_SCHEME', '_MS', '-MS']):
        meta['is_markscheme'] = True

    return meta


# ── Quick sanity check ────────────────────────────────────────────────────────
test_cases = [
    '18M.2.AHL.TZ1.H_10.pdf',
    'SPM.1.AHL.TZ0.H_4.pdf',
    'EXN.2.AHL.TZ0.1.pdf',
    '19N.1.ASL.TZ0.H_5.pdf',
]
print('Test cases:')
for t in test_cases:
    m = parse_pdf_metadata(PPQ_ROOT + '/' + t)
    print(f'  {t}')
    print(f"    session={m['session']}  paper={m['paper']}  level={m['level']}  TZ={m['timezone']}  curriculum={m['curriculum']}")

print()
print('Sample metadata (first 5 actual PDFs):')
for f in pdf_files[:5]:
    m = parse_pdf_metadata(f)
    print(f"  {m['source_pdf_path']}")
    print(f"    session={m['session']}  paper={m['paper']}  level={m['level']}  TZ={m['timezone']}  curriculum={m['curriculum']}")
"""))

# ── 5 · PDF → images ─────────────────────────────────────────────────────────
cells.append(cc("""\
from pdf2image import convert_from_path
import io

def pdf_to_images(pdf_path, dpi=200):
    \"\"\"Return list of PIL images, one per page.\"\"\"
    return convert_from_path(pdf_path, dpi=dpi)
"""))

# ── 6 · MathPix OCR ──────────────────────────────────────────────────────────
cells.append(cc("""\
import requests, base64

def image_to_base64(pil_image):
    buf = io.BytesIO()
    pil_image.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()

def post_process_mathpix_latex(raw):
    \"\"\"Apply IB-style post-processing to raw MathPix output.

    Replaces default enumerate environments with the custom IBPart environment
    so that list labels render with the correct IB hanging-indent style when
    compiled against the IB LaTeX preamble.
    \"\"\"
    raw = raw.replace(r'\\begin{enumerate}', r'\\begin{IBPart}')
    raw = raw.replace(r'\\end{enumerate}',   r'\\end{IBPart}')
    return raw

def mathpix_ocr_image(pil_image):
    \"\"\"OCR a PIL image with MathPix; returns a post-processed LaTeX string.\"\"\"
    headers = {
        'app_id'      : MATHPIX_APP_ID,
        'app_key'     : MATHPIX_APP_KEY,
        'Content-type': 'application/json',
    }
    data = {
        'src'    : 'data:image/png;base64,' + image_to_base64(pil_image),
        'formats': ['latex_styled'],
    }
    resp = requests.post('https://api.mathpix.com/v3/text', json=data, headers=headers)
    resp.raise_for_status()
    result = resp.json()
    raw = result.get('latex_styled', result.get('text', ''))
    return post_process_mathpix_latex(raw)
"""))

# ── 7 · Claude structuring ───────────────────────────────────────────────────
cells.append(cc("""\
import anthropic, json

client_anthropic = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

STRUCTURE_PROMPT = '''You are parsing an IB Mathematics exam paper page.
Given the MathPix LaTeX OCR output of a single page, extract every question part visible.

EXAM INFO:
  Session      : {session}
  Level        : {level}
  Paper        : {paper}
  Mark scheme  : {is_markscheme}

PAGE OCR:
{ocr_text}

Return a JSON array.  Each element represents one question part and must have exactly these keys:
  question_number  — integer (use 0 if the question number cannot be determined)
  part_label       — string such as a, b, c, i, ii, or an empty string for an unlabelled question
  marks            — integer, or null if the number of marks is not stated on this page
  content_latex    — string containing the full LaTeX for this part
  sort_order       — integer starting from 1

Rules:
  - If this page is a cover page, formula booklet page, or contains no question content, return [].
  - Do NOT include markdown fences or any text outside the JSON array.
'''

def claude_structure_page(ocr_text, meta, page_num):
    prompt = STRUCTURE_PROMPT.format(
        session      = meta.get('session', 'Unknown'),
        level        = meta.get('level', 'Unknown'),
        paper        = meta.get('paper', 'Unknown'),
        is_markscheme= meta.get('is_markscheme', False),
        ocr_text     = ocr_text,
    )

    message = client_anthropic.messages.create(
        model      = 'claude-sonnet-4-5',
        max_tokens = 4096,
        messages   = [{'role': 'user', 'content': prompt}],
    )

    text = message.content[0].text.strip()

    # Strip markdown code fences (handles ```json ... ``` style responses)
    if '```' in text:
        import re as _re
        text = _re.sub(r'```(?:json)?\\s*', '', text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        print('Warning: Claude JSON parse error on page', page_num)
        print('  Response preview:', text[:300])
        return []
"""))

# ── 8 · Supabase Storage upload ──────────────────────────────────────────────
cells.append(cc("""\
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def upload_page_image(pil_image, storage_path):
    \"\"\"Upload a PIL image to the question-images bucket; return the storage path.\"\"\"
    buf = io.BytesIO()
    pil_image.save(buf, format='PNG')
    buf.seek(0)
    try:
        supabase.storage.from_('question-images').upload(
            path         = storage_path,
            file         = buf.getvalue(),
            file_options = {'content-type': 'image/png', 'upsert': 'true'},
        )
        return storage_path
    except Exception as e:
        print('Warning: upload failed for', storage_path, '-', e)
        return None
"""))

# ── 9 · DB upsert ────────────────────────────────────────────────────────────
cells.append(cc("""\
def make_question_code(meta, question_number):
    level   = meta.get('level')   or 'XX'
    paper   = meta.get('paper')   or 'X'
    session = meta.get('session') or 'XX'
    tz      = meta.get('timezone') or ''
    tz_part = ('-' + tz) if tz else ''
    return level + '-P' + str(paper) + '-' + session + tz_part + '-Q' + str(question_number)


def upsert_question_and_parts(meta, question_number, parts, page_image_paths):
    code = make_question_code(meta, question_number)

    q_data = {
        'code'            : code,
        'session'         : meta.get('session'),
        'paper'           : meta.get('paper'),
        'level'           : meta.get('level'),
        'timezone'        : meta.get('timezone'),
        'curriculum'      : [meta.get('curriculum') or 'IB AA'],
        'source_pdf_path' : meta.get('source_pdf_path'),
        'page_image_paths': page_image_paths,
    }

    result = supabase.table('ib_questions').upsert(q_data, on_conflict='code').execute()
    if not result.data:
        print('Error: failed to upsert question', code)
        return None

    question_id = result.data[0]['id']

    # Delete existing parts so re-running is idempotent
    supabase.table('question_parts').delete().eq('question_id', question_id).execute()

    latex_field = 'markscheme_latex' if meta.get('is_markscheme') else 'content_latex'
    for i, part in enumerate(parts, 1):
        part_data = {
            'question_id': question_id,
            'part_label' : part.get('part_label', ''),
            'marks'      : part.get('marks'),
            'sort_order' : i,
            'subtopic_codes': [],
            'latex_verified': False,
        }
        part_data[latex_field] = part.get('content_latex', '')
        supabase.table('question_parts').insert(part_data).execute()

    print('  OK:', code, '—', len(parts), 'parts')
    return question_id
"""))

# ── 10 · process_pdf ─────────────────────────────────────────────────────────
cells.append(cc("""\
def process_pdf(pdf_path, dry_run=False):
    meta   = parse_pdf_metadata(pdf_path)
    rel    = meta.get('source_pdf_path')
    level  = meta.get('level')
    paper  = meta.get('paper')
    session= meta.get('session')
    is_ms  = meta.get('is_markscheme')

    print()
    print('Processing:', rel)
    print('  Level:', level, '| Paper:', paper, '| Session:', session, '| MS:', is_ms)

    # 1. Convert to images
    print('  Converting PDF to images...')
    images = pdf_to_images(pdf_path)
    print('  Pages:', len(images))

    # 2. OCR with MathPix
    page_ocr = []
    for i, img in enumerate(images):
        print('  OCR page', i + 1, 'of', len(images), '... ', end='', flush=True)
        ocr = mathpix_ocr_image(img)
        print('(' + str(len(ocr)) + ' chars)')
        page_ocr.append(ocr)

    # 3. Structure with Claude
    parts_by_qnum = {}   # question_number -> [part dicts]
    pages_by_qnum = {}   # question_number -> {page indices}

    for page_idx, ocr_text in enumerate(page_ocr):
        if not ocr_text.strip():
            continue
        print('  Claude structuring page', page_idx + 1, '...')
        structured = claude_structure_page(ocr_text, meta, page_idx + 1)
        for part in structured:
            qnum = part.get('question_number', 0)
            if qnum not in parts_by_qnum:
                parts_by_qnum[qnum] = []
                pages_by_qnum[qnum] = set()
            parts_by_qnum[qnum].append(part)
            pages_by_qnum[qnum].add(page_idx)

    if dry_run:
        print('  DRY RUN: would upsert question numbers:', sorted(parts_by_qnum.keys()))
        for qnum, qparts in sorted(parts_by_qnum.items()):
            print('    Q' + str(qnum) + ':', len(qparts), 'parts')
        return

    # 4. Upload page images
    pdf_slug = rel.replace('/', '_').replace(' ', '_').replace('.pdf', '')
    uploaded = {}
    for page_idx, img in enumerate(images):
        storage_path = 'pages/' + pdf_slug + '/page_' + str(page_idx + 1).zfill(3) + '.png'
        uploaded[page_idx] = upload_page_image(img, storage_path)

    # 5. Upsert into DB
    for qnum, q_parts in sorted(parts_by_qnum.items()):
        if qnum == 0:
            print('  Skipping', len(q_parts), 'parts (unknown question number)')
            continue
        page_idxs  = sorted(pages_by_qnum[qnum])
        page_paths = [uploaded[i] for i in page_idxs if uploaded.get(i)]
        upsert_question_and_parts(meta, qnum, q_parts, page_paths)
"""))

# ── 11 · Dry-run on first PDF ────────────────────────────────────────────────
cells.append(mdc("""\
## Step 1 — Dry run

Run the cell below on the **first PDF** to verify metadata is parsed correctly.  
No data is written to Supabase; it just prints what would be upserted.
"""))

cells.append(cc("""\
if pdf_files:
    process_pdf(pdf_files[0], dry_run=True)
else:
    print('No PDFs found — check PPQ_ROOT above.')
"""))

# ── 11.5 · Single-PDF live test ──────────────────────────────────────────────
cells.append(mdc("""\
## Step 1.5 — Single PDF live test

Change `TEST_PDF_INDEX` to pick any PDF from the list above, then run this cell.  
It processes **one PDF for real** (writes to Supabase) so you can spot-check before the full run.
"""))

cells.append(cc("""\
TEST_PDF_INDEX = 0   # change to any index shown by the 'Found N PDFs' cell

if pdf_files:
    test_path = pdf_files[TEST_PDF_INDEX]
    test_meta = parse_pdf_metadata(test_path)
    print('Testing with:', test_meta['source_pdf_path'])
    process_pdf(test_path, dry_run=False)

    # ── Show what was written to Supabase ────────────────────────────────
    prefix = (
        (test_meta.get('level') or 'XX') + '-P' +
        str(test_meta.get('paper') or 'X') + '-' +
        (test_meta.get('session') or 'XX')
    )
    rows = supabase.table('ib_questions').select('id, code').like('code', prefix + '%').execute()
    print()
    print(f'Questions in DB matching {prefix!r}:')
    for r in rows.data:
        parts = supabase.table('question_parts').select('part_label, marks').eq('question_id', r['id']).order('sort_order').execute()
        labels = [p['part_label'] or '—' for p in parts.data]
        print(f"  {r['code']}  ({len(parts.data)} parts: {', '.join(labels)})")
else:
    print('No PDFs found.')
"""))

# ── 12 · Full pipeline ───────────────────────────────────────────────────────
cells.append(mdc("""\
## Step 2 — Full pipeline

Once the dry run looks correct, run the cell below.  
`SKIP_ALREADY_PROCESSED = True` skips PDFs whose questions already exist in the DB (safe to re-run).
"""))

cells.append(cc("""\
SKIP_ALREADY_PROCESSED = True

for pdf_path in sorted(pdf_files):
    meta = parse_pdf_metadata(pdf_path)

    if SKIP_ALREADY_PROCESSED and meta.get('session') and meta.get('level') and meta.get('paper'):
        code_prefix = (meta.get('level') or '') + '-P' + str(meta.get('paper') or '') + '-' + (meta.get('session') or '')
        existing = supabase.table('ib_questions').select('id').like('code', code_prefix + '%').execute()
        if existing.data:
            print('Skipping (already in DB):', meta.get('source_pdf_path'))
            continue

    try:
        process_pdf(pdf_path)
    except Exception as e:
        print('Error processing:', pdf_path)
        print(' ', e)
        import traceback
        traceback.print_exc()

print()
print('Done!')
"""))

# ---------------------------------------------------------------------------
notebook = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "colab": {"provenance": []},
        "kernelspec": {"display_name": "Python 3", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "cells": cells,
}

out = os.path.join(os.path.dirname(__file__), '..', 'colab', 'ib_ocr_pipeline.ipynb')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w') as f:
    json.dump(notebook, f, indent=1, ensure_ascii=False)

print('Written to', os.path.abspath(out))
