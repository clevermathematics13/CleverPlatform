# Subtopic Allocation Helper

This folder contains generated resources to ground subtopic classification against syllabus text.

## Generator script

Run:

```bash
cd platform
python scripts/syllabus_subtopic_allocator.py build
```

Outputs:

- `subtopic_reference.json`
- `claude_subtopic_allocation_context.md`

## Suggest subtopic codes for a question

```bash
cd platform
python scripts/syllabus_subtopic_allocator.py suggest --course aa --text "Sketch y=f(ax+b) and solve |f(x)|>2"
```

Or from a text file:

```bash
python scripts/syllabus_subtopic_allocator.py suggest --course ai --text-file /path/to/question.txt
```

## Notes

- Sources are parsed from:
  - `docs/syllabus/aa/AA_guide_for_2021_sections/02_syllabus_ocr.txt`
  - `docs/syllabus/ai/AI guide_for_2021_sections/02_syllabus_ocr.txt`
- This helper improves consistency and explainability, but classification still needs teacher review for edge cases.
