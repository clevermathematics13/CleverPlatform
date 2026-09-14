# Study-guide vocabulary inserts

One-off tooling that adds a vocabulary page to a Grade 9 study guide **without
re-typesetting the guide**. Both guides in `source_materials` exist only as
PDFs — nobody has a source document for either — so the only safe edit is an
appended page that matches the house style of the file it joins.

Built 14 Sep 2026 to add **numerator**, **denominator** and **subject (of an
equation)** to both guides. See `content.mjs` for what was added and
§21 of `docs/HANDOFF.md` for why.

## The two guides are different documents

| | Formative 1 Study Guide | KA1 Study Guide (the summative) |
|---|---|---|
| `source_materials.id` | `81663765-…` | `f3eb538e-…` |
| Producer | LibreOffice | Typst |
| Page size | US Letter, 612 × 792 pt | A4, 595.28 × 841.89 pt |
| Text face | Liberation Sans (system) | TeX Gyre Schola / Heros |
| Mathematics | plain text, hyphen-minus | typeset, real minus (U+2212) |
| Running head | none, centred footer only | head + foot rules, "Page n of 18" |

Every measurement baked into `html.mjs` — column edges, row fills, rule
weights, the 5.97 pt of cell padding — was read off the real PDF with
pdfplumber, not chosen. If a guide is ever re-issued, re-measure rather than
trusting these.

## Running it

```bash
# once: fonts (see fetch-fonts.sh for why URW rather than TeX Gyre)
./fetch-fonts.sh

# once: a Python with the PDF libraries on it
python3 -m venv .venv && ./.venv/bin/pip install pypdf pdfplumber fonttools cu2qu
export SG_PYTHON="$PWD/.venv/bin/python"

node build.mjs ka1   /path/to/KA1_Study_Guide.pdf                        out/
node build.mjs form1 /path/to/Grade_9_Extended_Formative_1_Study_Guide.pdf out/
```

`build.mjs` prints the HTML with Chromium and hands off to `append.py`, which
re-reads its own output and **refuses to keep a merge that changed any original
page**. Then re-derive the catalogue text the way the upload route does:

```bash
npm install pdf-parse        # same parser as POST /api/source-materials
node extract.mjs out/ka1-merged.pdf
```

and PATCH `source_materials` with the new `extracted_text`, `page_count` and
`byte_size`, and upsert the PDF over its existing `storage_path`.

Environment overrides: `SG_FONT_DIR`, `SG_PYTHON`, `SG_CHROME`.

## Four findings worth keeping

1. **Convert OTF to TTF first.** Chromium writes a CFF/OTF web font into a PDF
   as Type3 glyph procedures — not embedded, poorly extracted. The same
   outlines as TrueType come out as a proper embedded Type0. `otf2ttf.py`.
2. **Merge with pypdf, not pdf-lib**, even though pdf-lib is already a
   dependency of the app. It rewrote the LibreOffice-made Formative guide into
   a file with broken object streams and zero readable pages, silently.
3. **Do not set the mathematics with KaTeX.** It positions every atom in its
   own box, so `pdf-parse` lifts the symbols out of the sentences and dumps
   them at the foot of the page. `extracted_text` is what the assessment
   generator reads, so "In the numerator is ." costs more than a built-up
   fraction is worth. Ordinary italic text and solidus fractions extract whole.
4. **Set ≠ in the body font.** KaTeX's fonts carry no U+2260; it draws a slash
   over an "=", which extracts as "=" — the opposite of what a page about
   restrictions means to say.

## Verifying a rebuild

`append.py` compares extracted text per page, which catches a mangled merge.
For a stronger check, render both files and diff the pixels:

```python
import pypdfium2 as pdfium
from PIL import ImageChops
a, b = pdfium.PdfDocument("source.pdf"), pdfium.PdfDocument("out/ka1-merged.pdf")
for i in range(len(a)):
    x = a[i].render(scale=1).to_pil().convert("RGB")
    y = b[i].render(scale=1).to_pil().convert("RGB")
    assert ImageChops.difference(x, y).getbbox() is None, i
```

Both guides passed this at zero pixel difference across every original page.
