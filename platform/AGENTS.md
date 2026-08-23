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

## Git — Build and Test Locally Before Pushing

**Every push to `main` deploys immediately to production, where real students' data lives. Do not push broken code.**

Before committing any change, run:
```bash
cd platform
npm run build
npm test
```

Both must succeed before you push. If the build fails locally, fix it locally — do not push to see if Vercel catches it.

Once the build and tests pass:
```bash
git add -A && git commit -m "<descriptive message>" && git push
```

### Why this matters
- There is no staging environment. `main` = production.
- A broken build means real students cannot access their work.
- Build time is ~90-110 seconds — catching errors locally is faster than waiting for Vercel to fail.

### Dev server
```bash
cd platform && npm run dev   # always --webpack, never --turbopack
```

Turbopack is disabled intentionally — box-drawing characters in comments crash its Rust code-frame highlighter. Use plain ASCII dashes (`----`) in all comment dividers, never Unicode box-drawing characters.
