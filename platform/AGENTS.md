<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## IB Mathematics LaTeX Conventions

These rules apply to **all LaTeX stored in `question_parts.content_latex` and `question_parts.markscheme_latex`**, all Claude prompts in this codebase, and any manually written question content. They are enforced by `postProcessMathpixLatex()` and the Claude normalisation pass in `/api/questions/ocr-latex`.

### Vector notation
- **ALWAYS** use `\boldsymbol{}` (bold italic) for vector variables — e.g. `\boldsymbol{a}`, `\boldsymbol{s}`.
- **NEVER** use `\mathbf{}` (bold upright), `\bm{}`, `\vec{}`, or `\overrightarrow{}` for named vector variables.
- This applies in **every context**: display equations, inline text, mark scheme working.

### Column / row vectors
- Use `\begin{pmatrix}...\end{pmatrix}` (round brackets).
- Do **not** use `bmatrix` (square) or `vmatrix` (vertical bars).

### Dot product
- Use `\boldsymbol{\cdot}` between two vector operands so the dot matches the weight of the bold letters.
- Do **not** use `\bullet` or `\times` for dot product.

### Greek letters
- Scalar parameters such as `\lambda`, `\mu`, `\theta` are **not** bolded — use plain math italic.

### Equations
- Display equations (matrices, multi-term results): `$$ ... $$` or `\[ ... \]`.
- Inline expressions: `$ ... $`.
- Never leave math expressions as plain text.

### Multi-part question labels
- Use `\begin{IBPart}...\end{IBPart}` (not `\begin{enumerate}`).

### No preamble
- Return body LaTeX only. No `\documentclass`, `\usepackage`, `\begin{document}`, etc.

### Common OCR errors to correct
- Missing minus signs on negative matrix entries (`-1` becoming `1`).
- `\lambda` / `\mu` confusion (look like each other in scan).
- `1` vs `l` vs `I` confusion.
- Extra spaces inside `\boldsymbol{ a }` → normalise to `\boldsymbol{a}`.
- `\mathbf{` that Mathpix emits → replace with `\boldsymbol{`.

## Unit Tests

Vitest runs automatically in watch mode via the **"Vitest watch (auto)"** VS Code task (`runOn: folderOpen`). It re-runs affected tests the moment any `.ts` file is saved — no manual trigger needed.

| Test file | Covers |
|---|---|
| `app/dashboard/questions/review/split-draft-into-parts.test.ts` | `splitDraftIntoParts()` — IBPart label parsing |

Manual commands when needed:
```bash
cd platform && npm test          # single run, exits
cd platform && npx vitest        # watch mode (same as the auto task)
```

### When to add a new test
- You fix a parsing bug → add a regression test that would have caught it.
- You extract a new **pure function** into its own module → add a `*.test.ts` beside it.
- Do **not** write unit tests for React components or Next.js API routes.

### Rules
- Test files live next to the module they cover (same directory).
- `npm test` must exit 0 on `main` at all times.
- All tests must pass before merging or shipping a feature.

## Git — Push After Every Change

**After completing any code change, always run:**
```bash
git add -A && git commit -m "<descriptive message>" && git push
```
This applies to every task, fix, or feature — no exceptions. Do not leave changes uncommitted.

## Sub-projects

This monorepo contains two sub-projects:

| Path | Type | Purpose |
|---|---|---|
| `platform/` | Next.js + Supabase | Teacher/student web platform |
| `platform/msa-grader/` | Google Apps Script (GAS) | OCR + AI grading backend |

### MSA Grader (`platform/msa-grader/`)

The MSA Grader is a GAS project that runs inside Google's infrastructure. It:
- OCRs student work PDFs via Mathpix
- Atomises markschemes into structured points
- Uses Claude to grade student responses against the markscheme
- Exposes `doGet`/`doPost` HTTP endpoints callable from CleverPlatform

**Deployment:**
```bash
cd platform/msa-grader
npm install          # installs @google/clasp
npm run push         # push source to GAS (requires clasp login)
npm run deploy       # create a new versioned GAS Web App deployment
```

**Configuration (set in Apps Script project properties):**
- `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` — Mathpix OCR credentials
- `MSA_PARENT_FOLDER_ID` — Google Drive folder for MSA output
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — Supabase credentials (for SupabaseSync.js)

**After deploying**, copy the Web App URL and set it in `platform/.env.local`:
```
MSA_GRADER_URL=https://script.google.com/macros/s/AKfy.../exec
MSA_GRADER_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

### Auto-grading flow (end-to-end)

1. Teacher clicks 🤖 next to a student name in the Gradebook.
2. A modal appears; teacher enters the student's Google Drive file ID and selects a test.
3. The platform POSTs to `/api/grader/grade`.
4. That route calls the GAS Web App (`MSA_GRADER_URL`) with the file ID.
5. GAS runs OCR → markscheme lookup → Claude grading → returns a marks array.
6. The route upserts marks into `student_marks` with `auto_graded = true`.
7. The page reloads; auto-graded marks appear in the gradebook.

Teachers can override auto-graded marks by typing into the cell normally.

