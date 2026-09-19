# Common Core State Standards for Mathematics

Reference copy of the official CCSS Math standards document, kept here so the
Grade 9 **Standard Level** strand/standards reporting feature has a primary
source to point to instead of relying on whoever wrote a given
`tests.standards_rubric` to have gotten the code and wording right.

## Where this is used

- `platform/lib/standards-rubric.ts` defines the `RubricStrandSchema` used to
  group a test's parts into strands, each naming the CCSS standards it
  assesses (`standards[]`, currently free text — not validated against this
  document).
- `platform/grading_policies/g9_standard_level_marking_principles.md` is the
  marking policy loaded for any test with a non-null `standards_rubric`.
- `platform/lib/fixtures/g9-standard-ka1-unit1.ts` is the seed/demo test
  ("Key Assessment 1 — Unit 1") whose four strands cite the codes indexed in
  `grade9-standard-level-codes.json` below.

## Files

- `Common_Core_State_Standards_for_Mathematics.pdf` — the full 93-page
  official document, unmodified.
- `Common_Core_State_Standards_for_Mathematics_sections/` — the same document
  split by the document's own table of contents (front matter, Standards for
  Mathematical Practice, each grade K–8, each High School conceptual
  category, glossary, works consulted). Each section has its original PDF
  pages (`NN_label.pdf`) and a plain-text extraction of its text layer
  (`NN_label.txt` — extracted directly from the PDF's embedded text, not
  OCR). `sections_manifest.json` / `.csv` list page ranges and files.
- `grade9-standard-level-codes.json` — verbatim standard text (with page
  numbers) for the specific codes already cited by the Grade 9 Standard Level
  fixture/seed test, so a strand's `standards[]` entries can be checked
  against real wording without opening the PDF.

## Source

- Publisher: Common Core State Standards Initiative (NGA Center / CCSSO).
- Official URL: https://corestandards.org/wp-content/uploads/2023/09/Math_Standards1.pdf
- Retrieved: this session's network egress policy blocks corestandards.org
  (and external domains generally); the PDF was supplied by the user and
  verified/extracted locally rather than fetched. If a newer edition is
  published, replace the PDF, re-run the split (see below), and refresh
  `grade9-standard-level-codes.json`.

## Regenerating the section split

The split/manifest/text files were generated with `pypdf` (installed in a
throwaway venv, since the system Python's `cryptography` package is broken
in this environment):

```bash
python3 -m venv /tmp/pdfenv && /tmp/pdfenv/bin/pip install pypdf
```

Then walk the table of contents on PDF page 2, slice `reader.pages[start-1:end]`
per section with `pypdf.PdfWriter`, and call `.extract_text()` per page for
the companion `.txt` file. Page ranges for each section are recorded in
`sections_manifest.json`.

## Not currently wired into validation

`standards[]` on a strand is free text — nothing in `standards-rubric.ts`
checks a code against this document, so a typo'd or invented standard code
will pass silently today. This folder makes that checkable by hand (or by a
future validator); it does not itself change any runtime behavior.
