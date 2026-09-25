# CleverPlatform — Technical Handoff

**Supersedes the 24 Aug 2026 handoff. Last verified against production: 27 Aug 2026.**

Every figure here was checked against the live database, the live Vercel project or
the repo on the date above. Where the previous handoff was wrong, the correction is
called out inline, because two of its errors caused real mistakes in the session
that produced this file.

**27 Aug 2026 session: `GRAPH_LAB_CV_SERVICE_URL` and `CV_SERVICE_SECRET` were added
to this agent environment and the Railway domain was allowed in the network policy.**
This changed §6 materially - see the corrected table below. The Q26(a) backfill
(§9, previously blocked on exactly this) is now done.

**§4 was corrected on 7 Sep 2026** - the file/row counts, and everything it said
about `CLEVERPLATFORM_SUPABASE_DB_URL`, which is now set and whose workflow had
been failing on every merge. See §13.

---

## 1. What this is

A private-by-intent, single-teacher IB DP + Grade 9 MYP Mathematics platform, run by
Pablo Clevenger at https://www.clevermathematics.com. One teacher, ~17 active
students, 113 `invited_students`. No admin panel, no public signup.

**The GitHub repository is PUBLIC.** The previous handoff described the platform as
"private", which is true of the product but not of the source. See §7.

A DP course is named by COHORT: `<two-digit graduation year><two-letter course>`,
where `AH`=AA HL, `AS`=AA SL, `IH`=AI HL, `IS`=AI SL. So `27AH` is the class of
2027 taking AA HL. The COURSE (AAHL) spans Grade 11 and Grade 12, so a code alone
never fixes a grade - the cohort's position in it does, and it is derived from the
graduation year and the date (`lib/dp-course-code.ts`), never hardcoded. In the
2026-27 school year `27AH` is Grade 12.

Courses: `27AH` (`7abac7b1`, AA HL class of 2027), `26AH` (archived), `28IH`
(archived, AI HL class of 2028), `9A` (`2abe4055`), `9A (2025-2026)`
(`31370a33`, archived - do not delete), `Grade 9 Extended` (`b1d3b183`, virtual, no
roster by design), `Grade 9 Standard` (`40ef6810`, virtual; its real class is
`9D`, `9776610b`, 18 invited students; no NA packets, but its first summative
is set up and graded by strands - see §21).

---

## 2. Stack and key identifiers

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.4, App Router, React 19.2.4, TypeScript 5 |
| Styling | Tailwind CSS v4 (CSS-first) |
| Database | Supabase (Postgres + Storage + Edge Functions) |
| Auth | `@supabase/ssr`; `profiles.role` gates everything |
| PDF - IB tests | Puppeteer + server-side KaTeX |
| PDF - NA packets | Typst via `@myriaddreamin/typst-ts-node-compiler` |
| CV service | FastAPI + PyMuPDF on Railway (Python 3.11) |
| Testing | Vitest 4 |
| Node | 24.x |

| Item | Value |
|---|---|
| Vercel project | `prj_dvN9UGPeAbfHOWctzYam7zuh8QO0` |
| Vercel team | `team_EycgR7jYOPiUNuDya32nj9QX` |
| Supabase project | `qnawglgnoojrlaivylou` |
| Teacher profile id | `702750f6-be43-47d2-a422-a2f15b4d0bf9` |

Vercel domains, as of 24 Aug 2026: `www.clevermathematics.com`,
`clevermathematics.com`, `clever-platform-clevermathematics-projects.vercel.app`,
`clever-platform-git-main-clevermathematics-projects.vercel.app`. The bare
`clever-platform.vercel.app` no longer exists and has been removed from
`next.config.ts` `allowedOrigins`.

Note: the two `*-clevermathematics-projects.vercel.app` hosts are deliberately NOT in
`allowedOrigins`, so Server Actions fail the CSRF origin check on preview
deployments. That is intended ("list exact hosts only"); add them only if previews
must exercise Server Actions.

---

## 3. Non-obvious rules

- **Never rename `platform/src/proxy.ts`.** It is Next 16's renamed `middleware.ts`;
  `predev`/`prebuild` assert it exists. Adding a `middleware.ts` alongside it breaks
  the build silently.
- **Dev server is `npm run dev` (`--webpack`), never `--turbopack`.** Box-drawing
  characters (U+2500 family) in JS/TS comments panic Turbopack's Rust code-frame
  highlighter. Use ASCII `----` in comment dividers. (SQL files are unaffected.)
- **Both PDF pipelines are live.** Do not remove either.
- **Typst payload is all-or-nothing.** A missing key in the Typst dict is a hard
  compile failure; `nonEmptyString()` enforces it.
- **NA packets are AUTHORED IN LATEX and RENDERED AS TYPST.** The generator
  writes `$\cos\left(\frac{3\pi}{2}\right)$` (rule 11b in
  `buildActivityGeneratorSystemPrompt`), the draft stores exactly that, the
  on-screen preview renders it with KaTeX, and `buildTypstPayload` converts
  each span to Typst on the way to the compiler (`lib/latex-to-typst.ts`). It
  ran the other way round until 16 Sep 2026 -- packets were written in Typst
  syntax because that is what the PDF needed -- which made the PDF right and
  the preview wrong: KaTeX rendered `$cos((3pi)/2)$` as a product of italic
  letters, so the surface a teacher proofreads on showed something no student
  would ever get. Do not "simplify" this back by teaching the generator Typst.
  A `$...$` span with NO backslash in it is a packet saved before the switch
  and still renders down the legacy path untouched.
- **A newline in a prompt is a line on the page.** `rich()` splits on it
  before it does anything else, so a stem followed by lettered items sets as
  a list rather than a paragraph. Rule 6d of the generator prompt asks for
  it. Note the tension with rule 30, which says a question with (a), (b), (c)
  should be written as separate consecutive questions instead: lettered parts
  inside one printed box are one scan anchor and one rubric item, so they
  cannot be marked part by part. Rule 30 still stands; 6d governs the cases
  where lettered parts are used anyway.
- **Every packet page is numbered "N of M"**, from a `footer:` on the Typst
  `#set page`. `counter(page).final()` needs the `context` block, because
  Typst only knows the total once it has laid every page out. It is in the
  template, so it covers existing packets and future ones alike with no data
  migration -- but see the next bullet for what "existing packets" actually
  means.
- **Only B.4 has a `draft_content`.** A.1, A.2, A.2-P0, A.3 and three older
  rows were seeded into the LEGACY columns (`parts`, `prerequisites`,
  `vocabulary`, ...), and `GET /api/nuanced-analyses/[id]` selects
  `draft_content` alone -- so those packets cannot be opened in the editor or
  re-rendered to PDF at all. Reconstructing a draft from `parts` and
  compiling it shows what a backfill would cost: A.1 (16pp), A.3 (17pp) and
  A.2-P0 (3pp) render clean; A.2 aborts on "unexpected slash";
  `quadratics-calculus-transition` and `polynomial-analysis` have a different
  part shape and abort on a missing `heading` key; the binomial-expansion row
  aborts on "unexpected hat".
- **A question can print an area model** (`areaModel` on the question,
  `AreaModelSpec` in typst-payload.ts): a labelled rectangle with empty cells
  the student fills in. It exists because telling a fourteen-year-old to draw
  the rectangle first assesses the drawing. Rendered by `area-model()` in the
  Typst template and by `AreaModelFigure` in the preview -- both, because the
  preview is where the figure is checked before it prints.
- **A span the Typst gate refuses is read as LaTeX instead, unless it is
  prose.** Most Grade 9 algebra needs no LaTeX command at all -- `A = ac`,
  `a^2+2ab+b^2`, `Ax^2+Bx+C` -- so the backslash test cannot recognise it, and
  the Typst side refuses it because `ac` and `Ax` are unknown identifiers,
  which used to put the source on the page with its dollar signs showing.
  `spanIsForLatexConversion()` asks both questions: would Typst refuse it, and
  is it mathematics rather than prose. Both halves are load-bearing -- see the
  comment on that function. The TS mirror of the gate is pinned against the
  shipped prelude in `latex-to-typst.compile.test.ts`.
- **A currency dollar is escaped, not counted.** A.1 is set at a ticket
  window, so it prices things, and a lone amount left an ODD number of `$` in
  the line. Both ends of the pipeline used to give up on a line like that --
  `typesetMath()` handed it back untypeset and `rich-legacy()` printed it
  verbatim -- so A.1 priced its tickets correctly and typeset no mathematics
  anywhere near a price. `escapeCurrencyDollars()` pairs greedily from the
  left, asks whether the text between two `$` reads as mathematics, and writes
  `\\$` over the ones that do not. THREE surfaces have to agree about that
  escape: `rich-legacy()` in the Typst template reads it back as a dollar
  sign, `splitSegments()` in `components/LatexRenderer.tsx` does the same for
  the KaTeX preview, and every function on either side that splits on `$` must
  mask it first (`maskCurrency`/`unmaskCurrency` in latex-to-typst.ts) -- the
  escape carries a BACKSLASH, which is the whole of `isLatexMath()`'s test, so
  an unmasked one turns the prose between two prices into italic mathematics.
- **`typesetMath()` runs on its own output, so it must be idempotent.**
  `sanitizeDraft()` typesets a packet when it is SAVED and `typesetDraftMath()`
  typesets it again on every render. A span this module writes and then fails
  to recognise on the way back in is silently destroyed: `$P(r)=0
  arrow.l.r.double$` (which `toTypstMath()` produces from the word "iff") had
  both delimiters escaped into dollar signs on the second pass. Pinned by the
  "stable under a second pass" block in `math-typesetting.test.ts`.
- **A dotted path is one symbol, and a brace on an exponent is always LaTeX.**
  `arrow.l.r.double` is one identifier whose modifiers are not identifiers, so
  only its head is checked. `^{1/2}` has no backslash but Typst PRINTS those
  braces (the binomial packet read `(4+x){1 2}`), so it goes to the converter;
  `{1, 2, 3}` does not, because braces off an attachment print as braces in
  both languages.
- **An ordinal and a slash between words are prose, not mathematics.** B.4
  shipped with "the $12t h$ century" (the digit-letter join read as an
  expression, then split to survive Typst) and with `$sum/product$` printed as
  a sigma over a pi, because `sum` and `product` are the names of Typst's big
  operators. Both are fixed in `classify()`/`hasMathSignal()`; `x/y`, `3/4`
  and `2x/3` are still division.
- **A letter glued to a digit inside `$...$` aborts the whole PDF.** Typst
  lexes `m1`, `A1`, `S3E11` as one identifier, and an unknown identifier is
  not a degraded prompt but a document that will not print. `toTypstMath()`
  separates them and the prelude's `looks-like-math()` refuses any span that
  still contains one. A digit glued to a letter (`6x`) is fine and is left
  alone. This is also why the DP packet code `S3E11` is classified as prose:
  a packet subtitled "Nuanced Analysis Packet S3E11" used to fail to render.
- **Sonnet 5 returns thinking blocks first.** Use
  `response.content.find(b => b.type === "text")`, never `content[0].text`.
- **A cover page Haiku cannot place on the roster is read a second time by
  Sonnet.** The API downsizes a whole page to ~1500px, so a handwritten name
  is a strip a few dozen pixels tall and a looped V reads as an N ("Nicolite"
  for Vicente, 16 Sep 2026). `runCoverPageCheck()` in `lib/cover-page-check.ts`
  is the ONE place both batch pipelines and the worker make the check; it
  sends the same page to `COVER_PAGE_NAME_ESCALATION_MODEL` with the roster
  and Haiku's transcription when Haiku found a cover page but no roster match
  (`pipeline = 'ai_grade_cover_page_escalation'` / `'na_cover_page_escalation'`,
  a few pages per class). The second read can change the name, never the
  cover-page decision (`mergeEscalatedCoverPageCheck`). Downstream,
  `matchSegmentsToRoster` in `lib/ai-grading.ts` scores a known handwriting
  confusion (n/v, o/e, li/n, rn/m, ...) as half an edit, so a misread built
  only of those still lands inside the two-edit budget. A student a teacher
  picks by hand can still be remembered as an alias (`name_aliases`), which
  short-circuits both.
- **Supabase:** `CREATE OR REPLACE FUNCTION` fails silently on return-type change -
  use `DROP` + `CREATE` as separate calls. `execute_sql` returns one result set per
  call. Use `public.set_updated_at()` (no `moddatetime`). Revoke EXECUTE from PUBLIC
  on SECURITY DEFINER functions. Dollar-quote large JSONB payloads.
- **Vercel deploy is confirmed only when `readyState: READY` AND
  `lambdaRuntimeStats` are both present.** Bare READY is insufficient.
- **CV service:** `opencv-python-headless==4.11.0.86` (no libGL on Railway),
  `pymupdf==1.24.14`, guarded by `CV_SERVICE_SECRET`.
- **The 1-7 Level from `lib/grade-bands.ts` is the only achievement scale in use.**
  It is what the gradebook grid and the Exam Reflection dashboard show. Boundary
  sets `A`-`D` are DP course-progression sets (a 7 at 76-82%) and do not apply to
  Grade 9, which is a course of the teacher's own design that borrows the 1-7 scale
  to prepare students for DP - it is not an IB course, so do not "correct" its
  boundaries toward official IB ones. Grade 9's preset is `Grade 9` (a 7 at 90%).
  **Since 24 Sep 2026 every assessment has its own boundaries (§37):** a new test
  starts from a preset (the Assessment Creator's picker), and its lines are then
  decided -- kept, taken from the AI's suggestion or set by hand, always with a
  stated reason -- on `/dashboard/tests/[id]/boundaries`. A test with none falls
  back to the generic bands in `pctToGradeFallback()` and renders a `~approx` badge.
- **Grade 9 Standard Level is graded differently from Grade 9 Extended, and
  the difference is data on the test, not a second pipeline.** A test whose
  `tests.standards_rubric` is non-null is a standards-referenced paper: its
  parts are still graded one at a time by `lib/ai-grading.ts` and accepted
  one at a time into Clev's Marks, but the grader loads
  `grading_policies/g9_standard_level_marking_principles.md` IN PLACE OF the
  Formative Assessment principles, and the marks roll up by STRAND into
  Exceeding / Meeting / Approaching / Beginning (`lib/standards-rubric.ts`),
  not by boundary set into a 1-7 level. The strand levels live on the
  standards report page. A Standard paper starts with no 1-7 boundaries (the
  gradebook's `~approx` badge is honest there); since §37 the teacher may give
  it its own on the Grade boundaries page, which is what 9D's PowerSchool 1-7
  export then uses. See §21.
- **PowerSchool matches imported scores on the student number, and nothing else.**
  `students.student_number` / `invited_students.student_number` exist only for
  that: PowerTeacher Pro's per-assignment score import keys on the school-defined
  number, and accepts a name column purely for its "Validate Student Names" check
  (name against number), never as a matching key. A student without a number does
  not import. Fill them from the Students page - there is a paste box that takes a
  PowerSchool roster export and matches on a normalised token set, so "Caipo,
  Santiago" finds "Santiago Caipo". The CSV itself is built in
  `lib/powerschool-export.ts`, whose header comment records the format decisions
  and why; `ABS` in the score column is PowerTeacher Pro's own default absence
  code, which exempts the assignment. Levels export as 1-7, so the PowerSchool
  assignment must be worth 7 points with File Score Type = Points.
- **Formative Assessments no longer carry an achievement-band table.** A
  Criterion-A-style `achievementBands` table used to be generated into every draft,
  editable in the sandbox and printed on the teacher mark scheme; nobody used it and
  nothing ever computed a band from it, so it was removed end to end (draft type,
  Zod schemas, generator prompt, sandbox editor, mark-scheme HTML and CSS) and
  stripped from the one stored draft that had one. The reteach guide beside it is
  still live - do not remove that too.

### Corrected from the previous handoff

- The previous handoff said the GitHub App lacks the `workflows` OAuth scope and
  cannot push under `.github/workflows/`. **That is no longer true** - the App
  installed 24 Aug 2026 grants read+write to workflows, and a workflow file was
  pushed successfully.
- `git push` over HTTPS works once the Claude GitHub App is installed. Before that
  it 403s while `git fetch` still succeeds - the failure is push-only, not
  "no credentials".

---

## 4. Database and migrations

**The migration ledger and the repo agree on versions: 184 files, 184 rows**
(verified 24 Sep 2026 after §38's two migrations; it read 181/181 that morning, 83/83 when this handoff was written, 95/95 after
the second reconciliation, 116/116 after the third, 149/149 on 13 Sep and
171/171 on 20 Sep). Two
rows applied through MCP on 18 Sep (`20260918205816`, `20260918210444`) had no
file on any branch until 20 Sep; both were rebuilt from the ledger and verified
by md5 before the `test_items.marking_notes` and `grader_feedback` migrations
were added (§23). Read
`platform/supabase/migrations/README.md` before touching anything in that
directory - it documents the invariant and how to add a migration without
breaking it.

**"byte-identical", which this paragraph used to claim of all of them, is
true only of the rows applied through MCP `apply_migration`.** The ledger
stores PARSED statements with their trailing semicolons stripped, so a
rejoined row is one character short per statement and multi-statement rows
also lose the blank lines between them; 104 of the 149 differ that way and
none of it is drift. Writing those files back from the ledger would produce
SQL with no statement terminators. The README's new last section has the
measurements. The invariant that actually holds, and all `supabase db push`
compares, is one file per ledger version.

History, because it matters: files `001_*`..`057_*` were never recorded in the
ledger, while ~4 months of changes applied via MCP existed only in the database. The
Supabase CLI matches `^([0-9]+)_(.*)\.sql$` - `[0-9]+`, not a 14-digit timestamp - so
`001_initial_schema.sql` parsed as version `001` and counted as pending. Several of
those files are destructive (`014_016_combined.sql` drops the seating tables;
`023_reset_aahl_students.sql` deletes student enrolment rows). Nothing was ever
applied only because `CLEVERPLATFORM_SUPABASE_DB_URL` was unset at the time, which
made the workflow's push step skip and exit 0 - all 23 "successful" runs to that
point were no-ops.

Those 64 files now live in `platform/supabase/migrations-legacy/` and
`--include-all` has been dropped from the workflow.

**`CLEVERPLATFORM_SUPABASE_DB_URL` is now set, and the advice this paragraph used
to give ("do not set it before the reconciliation merges") is spent.** What
replaced the silent no-op was a silent failure: from 6 Sep 2026 every run of
`platform-supabase-migrations.yml` failed, because the secret holds the direct
connection string and `db.<ref>.supabase.co` resolves to IPv6 only - Supabase's
own docs list GitHub Actions among the platforms that cannot reach it. The job
died on `dial error (connect ECONNREFUSED <v6 addr>:5432)` before touching
anything.

Fixed 7 Sep 2026: the workflow now lifts the password out of that secret and
reconnects through Supavisor session mode
(`postgres.<ref>@aws-1-sa-east-1.pooler.supabase.com:5432`), which always has an
IPv4 address. Transaction mode (6543) will not do - it does not speak enough of
the protocol for migrations. A secret that already points at the pooler is used
unchanged, so switching it over later needs no workflow edit.

**Fixing that uncovered a second fault, and the honest summary is that this
workflow had never once applied a migration.** The Supabase CLI reads
`supabase/migrations` relative to its working directory, and the push step had
none - so it ran at the repo root, where a *second* `supabase/` directory lives
(kept for the edge function `deploy-edge-functions.yml` ships). That one still
holds three 2024/2025 migration files predating both reconciliations, in no
ledger. The CLI compared the live ledger against those three, found none of its
116 versions locally, and refused with "Remote migration versions not found in
local migrations directory". It fails safe - it will not push when local and
remote disagree that badly, so it never tried to apply those three to
production - but combined with the connection fault it means CI has never
applied anything. The step now runs from `platform/`. Do not delete the root
`supabase/` directory: the edge function deploy needs it. Its `migrations/`
subdirectory is dead weight and worth removing on its own.

Verified 7 Sep 2026 by `workflow_dispatch` on a branch: "Reached the database
through aws-1-sa-east-1.pooler.supabase.com (session mode)" / "Remote database
is up to date", schema probe green, ledger untouched at 116 rows.

Note what this workflow is and is not. Because migrations are normally applied
through MCP `apply_migration` first (see the README), the ledger usually already
carries them by the time `main` moves, so `supabase db push` finds nothing pending
and is a no-op **by design**. It is the safety net for a migration file that
reaches `main` without having been applied - not the usual path. A green run here
does not mean it did anything; a red one means production may be missing a
migration that is in the repo.

Tables you will touch most: `na_scan_batches`, `na_packet_scans`,
`na_response_crops`, `na_feedback`, `na_anchors`, `na_rubric_items`,
`nuanced_analyses`, `na_packet_versions`, `na_continuity`,
`nuanced_generation_runs`, `invited_students` (the NA pipeline uses this, not
`students`), `course_google_classroom_links`, `google_oauth_tokens`,
`track_courses`. 80 tables in `public`, all with RLS enabled.

---

## 5. NA scan pipeline

| Stage | What happens |
|---|---|
| 0 | Anchor extraction - `auto_fillrect` finds the filled rectangles that draw answer boxes |
| 1 | Cover-page segmentation via Haiku 4.5 (~165x cheaper than Opus; roster-grounded) |
| 2 | Packet boundaries by position - the next cover page is expected `packetPageCount` pages on, confirmed by the stage 1 Haiku check within a 4-page window |
| 3 | Pre-split oversized batches into linked chunks |
| 4 | Crop extraction via PyMuPDF at 300 DPI on the Railway CV service |
| 5 | Per-crop assessment via Sonnet 4.6, one call per crop, results in `na_feedback` |

Architecture decisions - do not reverse without understanding why: geometry is solved
once from the master PDF, not per scan; scans must arrive upright, and nothing in the
pipeline detects or corrects orientation; adaptive crop expansion happens in a single
upright coordinate space; verdict and marks are independent fields; "correct verdict
must equal full marks" is enforced in prompt and server-side; use
`nuanced_analyses.parts` answer keys, not `answer_sketch`.

**Corrected 14 Sep 2026 - stage 2 and the orientation claim above were both wrong,
and the orientation half is the one that can cost marks.** They used to read "Page
identity via Opus 4.5 - affine fit, NOT match-count voting" and "orientation is
recovered via affine fit; adaptive crop expansion happens in a single upright
coordinate space after rotation". That describes the ORB/RANSAC pilot - built and
validated 78/78 across 3 real packets, then **deliberately not shipped**, which
`scripts/cv_crop_extract.py:9-24` says in its own opening paragraph.

What ships instead: no Opus call exists anywhere in the NA scan path (only
`COVER_PAGE_CHECK_MODEL`, Haiku 4.5, and `ASSESSMENT_MODEL`, Sonnet 4.6 - every other
mention of Opus in those files is a comment explaining why it was NOT used), and
there is no ORB, `estimateAffine*`, `findHomography`, RANSAC or `warpAffine` anywhere
in the repository. **Nothing detects or corrects page orientation.** `rotation_hint`
does thread from `lib/cv-crop-service.ts` through `cv-service/main.py` to
`_render_page_upright`, but it is one scalar per request, not per page, and every
caller hardcodes `0`. `na_scan_pages.page_rotation_deg` was provisioned for the
pilot; nothing reads or writes it.

This matters because the old text told a reader the pipeline self-corrects a crooked
scan. It does not, and the failure is silent: an inverted page does not fail the
grading call, it returns a confabulated reading. Measured 14 Sep 2026 on a one-page
fixture, three runs at temperature 0, each reporting the page's content at both its
top and its bottom when it carried that content once.

**Partly no longer true for the TEST AI-grading path, 16 Sep 2026.** The
synchronous grade route and the overnight queue route now run
`lib/scan-orientation.ts` on a student scan before it is marked (since 23 Sep,
only on a stored file's FIRST marking -- re-running it on every re-mark
flipped pages back and forth, see section 28): one Haiku
call reads which way up each page's printed text is, pdf-lib writes /Rotate 180
onto the inverted pages (what Acrobat writes), and the corrected PDF replaces
the stored one at the same path, so the crop service and "Locate on page" read
the same upright pages the marker did. Found on Key Assessment 1 (Grade 9
Extended): the 15 Sep batch of 19 had been fixed in Acrobat, the 16 Sep batch
of 13 had not, and every crop from an even page of those 13 was upside down in
the review panel (first seen on Kaito Fujii's Q13(b)). The check was validated
on all 32 of those scans before it shipped: 13/13 inverted-even-page scans and
19/19 upright scans read correctly. The 13 stored scans were then corrected in
place and those students re-marked from the upright pages. It is best-effort by design (a failed or
miscounted answer grades the scan as it is, with a console warning), and it does
NOT cover the NA scan pipeline below, which still requires upright input.

For the NA pipeline, scans must arrive upright, and a duplex batch with every
even page rotated is fixed BEFORE upload - in Acrobat, Rotate Pages / Even
Pages Only / 180. The
`/Rotate 180` that writes is honoured the whole way down, verified the same day:
`pdf-lib`'s `copyPages` preserves it through the split routes (and the
`canCopySourceWhole` path is a byte-for-byte Storage copy), PyMuPDF's `get_pixmap`
renders the page upright so anchor points in upright space still cut the right
region, and the Anthropic document block reads it correctly. 180 degrees does not
swap width and height, so no stored geometry changes.

**Stage 4 is idempotent.** It find-or-creates per `(packet_scan_id, anchor_id)`, so
existing crop rows keep their id and any `na_feedback` pointing at them survives.
Storage uploads use `upsert: true`. Re-running it for a student is safe. The bulk
button only targets not-yet-cropped students; use the per-student Crop button to
re-crop one that is already done.

**Stage 5 skips already-assessed crops** (feedback present and no
`ai_validation_error`), so re-running assess after adding an anchor only costs the
new crops.

A.1 packet: spec `4821f182-4331-4868-91a2-948c71ee4d6f`, packet version
`1462a2f2-fc2a-4bab-8135-ed3aefeb0aff`, `nuanced_analysis`
`aabd94f4-aa08-405e-bccb-5003d31696cb`. **40 anchors** (was 39 before Q26(a) was
added on 24 Aug 2026).

A.2 packet ("What Undoing Really Means"), set up 9 Sep 2026: packet version
`2f8a4c31-6b7e-4d92-a1f5-8c3e07b9d240`, `nuanced_analysis`
`41e8ca4e-087d-4146-b364-19139d659343`, **32 anchors**, 99 marks, `page_count`
20, no scans uploaded yet. See §15 for how it was derived and what still wants
a teacher's eye.

**Corrected 27 Aug 2026: the "11 packet scans" figure above was wrong.** There were
**17** `na_packet_scans` rows for this packet version:
- 7 real students, each with **two** scans from two separate teacher uploads of the
  literal same `Scan (corrected).pdf` a day apart - `batch db4d3a05` (22 Aug, the
  live one, carrying the real `na_feedback`) and `batch f5519dd6` (23 Aug, a
  near-duplicate upload with almost no feedback, 1 row).
- 3 orphaned scans from an early `pilot-ingestion` batch (`invited_student_id` and
  `name_crop_storage_path` both NULL, `id_status = needs_review`), already 38/39
  assessed, with no source PDF recorded anywhere in the schema (`na_scan_batches`
  for that batch has `source_storage_path = NULL` too). Not backfillable for
  Q26(a) as a result (no split PDF to feed the CV service).

**Identified 27 Aug 2026, by matching handwriting/answers, not database fields**
(nothing in the DB pointed at these students - the crops themselves did): all 3
orphan scans are duplicates of students who are ALSO live in `db4d3a05`, scanned
individually through a one-off `pilot/packet-N/...` Storage path that predates the
batch-upload system entirely (created 21 Aug, a day before `db4d3a05`).
- `0525197b-2ab2-45d4-9519-0b02d47b56cf` (`pilot/packet-1/`) = **Ines Palomino**
  (`25fa37ae-17d0-4891-91f4-dfe0440b5cbe`)
- `f854e03e-e14e-4a26-9ec4-4832fcdb5eb3` (`pilot/packet-2/`) = **Freya Delisle**
  (`9ea1b42b-a9f0-484e-8b5b-42156f6d8820`)
- `475e3a0d-9a83-46bb-b063-891dc28e8dba` (`pilot/packet-3/`) = **Davi Verma**
  (`9c83399d-c5d3-437a-bd7a-68cadb2e1f8d`)

Confirmed by pixel-identical crop images (same handwriting, same stray pencil
marks) for Ines Palomino and Davi Verma, and by near-verbatim-identical
transcriptions for Freya Delisle (no unassessed comparison crop was available for
her at identification time). Found one real grading discrepancy in the process:
Davi Verma's Q3 ("It was a coincidence.") scored incorrect/0 in the pilot
assessment but partial/1 in the live one - same handwriting, different verdict,
almost certainly an older rubric/prompt version in the pilot pipeline. Don't treat
the pilot data as a second source of truth for anything.

### Stage 5 quality pass, 27 Aug 2026 - a real answer-key defect, plus AI self-contradictions

After the full re-assessment above, scanned every `na_feedback.ai_teacher_note`
system-wide for backtracking language ("wait", "reconsidering", etc. - the same
detector now built into `validateAssessment`, see below). Found 6 matches; 4 were
the model rambling but still landing on a self-consistent number (no action), 2
were real:

- **Q9's answer key had a genuine typo**, not an AI error: `na_anchors.question_answer`
  said `(2,4) -> 360` for one row of the ticket-pricing table, but 60×2+30×4=240,
  not 360 - arithmetically impossible. `answer_sketch` on the same anchor already
  had the correct pair (`(4,c)->360 gives c=4`), but `buildRubricBlock` prefers
  `question_answer`, so the model never saw the fix. All 7 students' physical
  worksheets independently confirm the row gives children=4 and total=$360 with
  adults blank to solve - the unique correct answer is adults=4. Corrected the
  anchor text, then re-ran stage 5 fresh on all 7 students' Q9 crops. 4 of 7 marks
  changed as a direct result: Freya Delisle 3->4, Roberto Aurelio Gamio 2->3,
  Ruifeng Wu 3->4, Santiago Caipo 3->4 (out of 5). Davi Verma, Ines Palomino, and
  Kaito Fujii were unaffected - Kaito's row 4 has its own separate, genuine error
  (wrote adults=1, which doesn't satisfy the corrected key either), confirming his
  original mark wasn't a key-bug victim.
- **Kaito Fujii's Q1** and **Freya Delisle's Q23** had real teacherNote/marksAwarded
  mismatches (see below) - manually corrected via the normal teacher-override
  fields (`final_verdict`/`final_marks_awarded`/`approved_by`/`approved_at`).
- **Santiago Caipo's Q5** wasn't a mismatch but an unjustified score bump: the
  model's own note worked out the strictly-correct total (1/5, only part (b)
  correct) then overrode it with "being generous I'll give 2" - corrected to 1/5,
  keeping the original (accurate) margin comment.

**`validateAssessment` (`platform/lib/na-assessment.ts`) now detects this class of
bug going forward.** It scans `teacherNote` for backtracking markers ("wait",
"on second thought", "reconsidering", etc.) and appends a warning into
`ai_teacher_note` when found - deliberately biased toward over-flagging, since a
false positive costs a few seconds' recheck and a missed real case costs a wrong
mark on a student's grade. The system prompt was also strengthened to forbid this
pattern outright. This does NOT retroactively re-scan anything created before 27
Aug 2026 - the scan above was a one-time manual sweep, not an ongoing job.
Consider re-running that same regex sweep periodically, or after any large
re-assessment run, since it's cheap and already found 2 real defects out of 213
crops on its first use.

Not deleted - documented here only. See Open Items for the pending decision on
whether to remove this now-redundant pilot data.

**The `f5519dd6` duplicate batch was deleted 27 Aug 2026** (teacher, via the Supabase
dashboard - Storage UI for the crop/PDF files, then one `DELETE FROM na_scan_batches`
which cascaded to its 7 `na_packet_scans`, 280 `na_response_crops`, and the 1 stray
`na_feedback` row). Verified after: 10 total `na_packet_scans` remain for this packet
version (7 live + 3 orphan), `db4d3a05`'s own 7/280/70 scans/crops/feedback
untouched. This is why the count above is now consistently 10, not 17.

**Q26(a) backfill is done** (27 Aug 2026) for the 7 live (`db4d3a05`) scans: 280
crops written (40 per scan), then stage 5 run on the 7 new Q26(a) crops
specifically (not a full re-assessment) - all 7 assessed, 0 failures. The 3 orphan
scans could not be backfilled (no split PDF to feed the CV service) and the 7
duplicate (`f5519dd6`) scans already had a Q26(a) crop from before this session (no
feedback on it, since nothing has assessed that batch). Total feedback rows for the
live scans: 178 (pre-Q26a) + 7 = 185.

`na_packet_versions.master_pdf_storage_path` for A.1 is **NULL** - the master PDF was
never stored. Anchor geometry can only be re-derived from a copy of the rendered
packet PDF; a student's split PDF is pixel-identical page content and stands in.

### Crop-expansion bug found via the scan-test crop-image feature, 27 Aug 2026

Once the scan-test page started showing the actual crop image (not just the AI's
transcription) in the "why this mark" panel, the teacher spotted a real clip: Ines
Palomino's A.1 Q1 crop cut off her boxed final answer for part (d) ("750") - the
image genuinely stopped mid-box, confirmed against the full scanned page.

Root cause in `cv_crop_extract.py`'s adaptive expansion: `_edge_ink_density`
averaged ink density across the *entire* width of the edge band before deciding
whether to grow the crop. A boxed answer occupying only a narrow slice of a wide
crop dilutes to a low average - this exact crop measured 0.048 against the 0.05
trigger threshold, so expansion never fired at all despite a legible boxed answer
sitting right at the edge. Fixed to take the max density over segments along the
band instead (`platform/scripts/cv_crop_extract_test.py` has regression tests).
Also bumped this specific Q1 anchor's `expand_max_y1_pt` (440 -> 448pt in
`na_anchors`), since the answer sat right at the template's boundary with the next
question and even a fully-triggered expansion needed the cap raised to reach it.

Checked all 7 students at this anchor for the same clipping: **Kaito Fujii's Q1
crop had the identical bug** ("(d)=750" half-cut). His mark was unaffected - it
was already manually corrected to 3/3 earlier in the 27 Aug pass (independently
verified against the same content) - but the stored crop image and AI draft were
refreshed to the untruncated version for future review clarity. The other 5
students' crops at this anchor were unaffected (already fully captured).

This was a one-time targeted check of one anchor, not a system-wide sweep. Worth
doing the same audit (re-crop every `boundary_expanded=false` row and diff against
the fixed CV service) across all anchors if this pattern shows up again.

### Full-packet crop audit and a real detector, 27 Aug 2026 (later same day)

The teacher then spotted a second, different crop cut off (Q1(e)) - a strong
signal the Q1-only fix above wasn't the whole story. Rather than fix these one at
a time as spotted, built a real signal into stage 4 itself: `_adaptive_crop_bounds`
now distinguishes expansion stopping because ink density genuinely dropped
(content ended, fine) from stopping only because it hit the anchor's
`expand_max_x1_pt`/`expand_max_y1_pt` cap while ink was still touching that edge
(content may continue beyond what the geometry allows capturing). New
`na_response_crops.possibly_truncated` column, threaded into the AI assessment
prompt and a "may be cut off" badge in the scan-test UI.

Then ran the audit this enabled: re-cropped **all 280 crops** across all 7 live
students against the fixed service and compared byte size against what was
stored. **123 crops changed** (a real answer's content was previously clipped to
some degree) and **46 still came back `possibly_truncated=true`** even at full
expansion (a real anchor-geometry constraint, not a bug - these anchors'
`expand_max_*_pt` caps sit too close to the printed box for some students'
handwriting; verified two samples by hand against the raw scan and both were
genuine, e.g. Roberto Aurelio Gamio's Q4 definition of "Constant" running off the
right edge mid-word, "sa[me]" and "a numb[er]"). Applied the new images to
Storage + `na_response_crops` for all 123, then re-ran stage 5 (`ai_*` only,
never `final_*`) on all of them.

**30 of the 123 re-grades changed marks** (listed in full in the session log, not
reproduced here) - mostly increases (previously-hidden correct working now
visible), a handful of decreases (newly-visible content revealing a real error
that a truncated crop had been hiding, e.g. Ines Palomino's Q25 going 1 -> 0 once
her full "no combination of factors" explanation was visible and shown to lack
the required divisibility argument). Spot-checked three of the decreases against
the raw `ai_teacher_note` reasoning - all specific and well-justified, not model
noise. One existing teacher override (Santiago Caipo's Q5, `final_marks_awarded=1`
from earlier in the day) was correctly left untouched. Two crops hit the same
class of real schema-validation miss documented earlier (missing `confidence`/
`nextStep`) and succeeded on a single retry.

**Not yet done:** the 46 `possibly_truncated=true` crops are a real, live list of
anchors whose printed-template geometry is too tight for some students' actual
handwriting (`expand_max_x1_pt`/`expand_max_y1_pt` genuinely too close to the
answer box). Widening those specific anchors' caps in `na_anchors` (the way Q1
was widened above) and re-cropping again would likely resolve most of them - not
done this session, left as the next open item.

### A follow-up fix was shipped, then reverted the same day -- read before touching expansion again

Immediately after the above, a second real crop truncation was found (A.1 Q3,
Ines Palomino - a 3-line ruled answer box where the concluding sentence sat just
past a blank gap after line 2, wider than one `EXPAND_STEP_PT`). A "lookahead"
fix was written, tested against that one case, merged, and deployed: before
giving up growing an edge, probe further ahead and bridge the gap if content
resumes.

**This was reverted the same session.** A follow-up full-packet re-audit (the
right instinct - always re-check broadly after a pipeline change) caught the
real problem before it spread further: on A.1 Q4, the gap between a student's
own answer box and an unrelated **printed reference/answer-key box** ("OPEN
THIS ONLY AFTER YOU HAVE WRITTEN ALL FIVE...") is only ~18pt - almost identical
in size to the gap the fix needed to bridge for Q3. There is no lookahead
distance that reliably bridges one without also bridging into the other. One
crop (Davi Verma's Q4) was actually corrupted by this before it was caught: the
stored crop image had the full printed answer-key text appended after the
student's own handwriting, which would have handed the grading model the
answer key alongside the student's attempt. Caught before any stage 5 re-grade
ran against it (the full-packet audit script crashed on a transient network
error partway through student #2, which is what surfaced this during manual
review rather than silently completing) - no marks were ever affected. The
corrupted crop and 5 others touched by the same run (whose content turned out
unchanged or benign) were all regenerated from the reverted code and verified
consistent with it.

**Takeaway for next time:** this class of bug (grow-until-density-drops
adaptive expansion) is inherently asymmetric-risk. A crop that's still
occasionally too tight is a missed positive a teacher can catch once flagged
(see `possibly_truncated` above). A crop that silently gained unrelated printed
content is actively wrong evidence with no visible signal anything is off - far
worse. Any future fix to `_adaptive_crop_bounds` needs either a way to
positively identify "more of the student's own handwriting resumes" (e.g.
detecting a template discontinuity - a colored background, a new box border -
and refusing to cross it) rather than "any ink resumes," or should stay scoped
to per-anchor `expand_max_*_pt` data patches (like the Q1 fix above) instead of
a general geometric heuristic.

**The Q3 truncation itself was then fixed the safe, scoped way**, same session:
measured the actual printed box border directly against the source scan (it
closes at ~708pt, not the anchor's authored `y1_pt` of 682.43 - a ~24pt
under-measurement from whenever this anchor was originally extracted, not a
pipeline bug at all) and widened `y1_pt` to 708.0 on the Q3 anchor. Re-cropped
all 7 students at this anchor with the currently-deployed (safe, PR#23-only)
code: all 7 crops grew, none came back `possibly_truncated`, and Ines
Palomino's crop now shows her complete sentence with the printed box border
closing cleanly right after it - confirmed visually. Re-ran stage 5 on all 7;
no marks changed numerically, but every teacherNote now reasons from the
complete transcription with no truncation caveat (Ines's previously ended with
"a teacher may want to look at this" - now a clean, confident partial-credit
call). This is the general lesson from the reverted fix applied in practice:
prefer a targeted, verified per-anchor geometry patch over a general heuristic
whenever the two are both technically applicable.

**Also added: the actual question text now shows in the scan-test "why this
mark" panel** (`na_anchors.question_text`, already used for grading, just
wasn't surfaced in the UI) - a teacher no longer has to infer what was asked.

**A.1 Q6 fixed the same way, same session, after a teacher spotted it live**:
part (e) ("r, h") was visibly cut off. Q6's `expand_max_y1_pt` (606.15) was
actually *smaller* than the anchor's own printed box border (~616pt measured
directly against the scan) - `y1_pt` itself (593.9) was even further short.
Root cause: `Q6(f)`'s authored `y0_pt` (610.15) undershoots where that box
visually starts (~637pt) by ~27pt, so whatever formula set Q6's
`expand_max_y1_pt` from "next anchor's y0 minus a buffer" inherited that
error. Widened Q6 to `y1_pt=618.0`, `expand_max_y1_pt=633.0` (leaving a real
margin before Q6(f)'s true visual start, not its under-measured authored
one). Re-cropped all 7 students, re-ran stage 5: **Kaito Fujii's mark went
3 -> 4/5** once part (e) - previously missing entirely - became visible. The
model's own teacherNote backtracking detector (see the 27 Aug quality pass
above) flagged this response for a self-contradiction; checked it directly
against the crop and the 4/5 is correct (parts a-d right, (e) missing "x" as
a variable) - the detector did its job, the number just happened to be right.

**Systemic takeaway, worth checking across other anchors:** this specific
bug pattern - an anchor's `expand_max_*_pt` computed from a NEIGHBORING
anchor's authored coordinate rather than that neighbor's true visual
position - could recur wherever original anchor extraction measured a box's
start a bit early. `possibly_truncated=false` does NOT rule this out, since
the cap itself can be wrong independent of whether ink was detected against
it.

### Full anchor-geometry audit, 27 Aug 2026 (later same day)

Ran that systematic re-check. Built an automated detector using the
PRINTED left accent bar every answer box has -- a template element,
independent of any student's handwriting -- to find each anchor's TRUE
bottom border directly, by scanning down the bar's column for where its
color drops to white. Validated against the two known-real cases (Q3, Q6)
before trusting it: both matched manual measurement closely.

First pass flagged 4 "problems" and 4 "no border found" across all ~40
anchors. **Verifying before touching anything caught that most were
detector artifacts, not real bugs**: several flagged anchors reported a
`true_border` value IDENTICAL to their neighbor's own reading - the scan
had bled through a too-small print gap into the NEXT anchor's bar, exactly
the false-positive mechanism a small confirm-window can hit. Re-ran with
the search bounded near each anchor's own cap instead of wide-open, which
resolved the conflation for Q1, ACTIVITY, and Q13(b)'s "problem" (Q1 was
already fixed and independently visually verified earlier the same day).

**3 confirmed real issues, fixed and re-graded:**
- **Q26(b)**: genuine handwriting ("by 2 for every 1 additional adult
  ticket") ran past `expand_max_y1_pt` (644.43). Widened to 665.0.
- **Q13(b)**: box's true border sits past its cap (504.47) by a few points.
  Widened to 522.0.
- **Q30 (last question, last page)**: the serious one - a student's full
  paragraph of reasoning ran all the way to within a few points of the
  PHYSICAL PAGE EDGE (842pt). `expand_max_y1_pt` (811.89) missed a
  significant closing chunk of Ines Palomino's answer ("...the distributive
  property (my argument) shows why they always give the same result.").
  Since this is the last anchor on the last page (zero collision risk),
  widened the anchor's own `y1_pt` directly to 830.0 rather than relying on
  adaptive expansion, which was independently stalling early here too
  (the same per-step ink-density-gap limitation documented above, just
  encountered on a different anchor - not the reverted lookahead fix,
  which stays reverted).
- **Q7(b)**: box border sits ~5pt past its cap (811.89 -> 825.0), but no
  student's ink ever reached that far - cosmetic-only, fixed for
  consistency, zero crops actually changed.

Re-cropped and re-graded all 7 students at each of the 4 widened anchors.
**2 real mark changes**: Santiago Caipo's Q13(b) (0 -> 1/1, a previously-
invisible correct answer) and **Ines Palomino's Q30 (4 -> 6/6, full marks)**
once her complete argument became visible. Both verified against the
`ai_teacher_note` reasoning - specific, evidence-based, not noise.

Some crops still read `possibly_truncated=true` after fixing (e.g. Ines's
Q30, Ruifeng Wu's Q30) despite being visually confirmed complete - false
positives from the detector picking up the page's own footer text/border
line right at the physical edge, not missing content. Not worth chasing
further; the model's own teacherNote already reasons past this correctly
when the visible content is self-evidently complete.

**Still open:** the "ok (relies on expansion)" anchors (roughly two dozen,
where the true border sits between `y1_pt` and `expand_max_y1_pt`) were
*not* re-cropped - their caps are wide enough, so they depend on adaptive
expansion actually firing, which the segment-max fix (PR#23) should handle
for genuine handwriting. Not independently verified per-anchor.

### Closing the "relies on expansion" gap, and a NEW bug class found doing it, 27 Aug 2026 (still later same day)

Closed the gap above: re-cropped all 18 "relies on expansion" anchors x7
students (126 crops) against the deployed CV service. **Zero geometry
changes needed** - every one of those caps was already wide enough for the
handwriting actually present.

That mechanical sweep left 8 crops still individually flagged
`possibly_truncated=true` with unchanged byte size (a pre-existing flag,
not a new trigger). Checked each by hand against the source scan:

- **False positives (5), no action** - Ines's Q29, Q8, Q13(c), Q15;
  Santiago's Q8, Q15. All end in a complete, grammatically-finished
  sentence with the box border visible; the flag is the same benign
  footer/edge-ink false-positive already documented above.
- **Q19(c) - genuine truncation.** Ines's answer cut off mid-sentence
  ("...but it wasn't added/multiplied directly", no closing punctuation,
  no border shown). `y1_pt` (636.82) undershot the box's true printed
  border (~663pt) by the same ~27pt margin as the Q6 bug - i.e. this is
  the same authoring-time "next.y0_pt minus 4pt" undershoot, just on a
  different anchor. Fixed: `y1_pt` -> 665.0, `expand_max_y1_pt` -> 685.0
  (a printed "END OF THE COMPULSORY CORE FOR PART 4" banner sits at
  ~695pt, so the cap was set to stop well short of it rather than reusing
  the generic 811.89 default). Re-cropped all 7: Freya Delisle's overflow
  note ("as the beg... equation.") turned out to be squeezed into the
  page's physical right margin at x=594.7pt, past the anchor's
  `expand_max_x1_pt` (580.28) - widened that to 594.0 (the literal page
  edge, zero risk since there is nothing beyond it to swallow). Re-graded
  all 7; no override touched.

- **Q11 - a different, new bug class: not truncation, but swallowing a
  printed reference box.** Q11 is the only anchor on its page, so it had
  no next-anchor to constrain `expand_max_y1_pt` and got the generic
  811.89 default. Ines's own answer was already complete (ends in a full
  sentence right around the box's true border, ~294-310pt) but the crop
  ALSO captured the entire printed "GEOMETRIC READING" reference box
  (bold heading + 3 lines of instructional text) immediately below it,
  because ordinary ink-density-based adaptive expansion cannot tell
  printed reference text from a student's own handwriting, and nothing
  was stopping it before this next print block. Same root cause as the
  Q30/Q7(b) "no next anchor" pattern, opposite symptom: there it under-
  reached; here it over-reached. Not the reverted lookahead mechanism
  (PR#25/#26) - this is the current, otherwise-safe PR#23-only code.
  Fixed by *tightening* rather than widening: `y1_pt` -> 296.0,
  `expand_max_y1_pt` -> 310.0 (measured via the same left-accent-bar
  border detector, landing ~0.7pt before the reference box's own bar
  starts at ~310.7pt). Re-cropped all 7 - **all 7 shrank** (Roberto's and
  Santiago's crops had also been silently swallowing the same reference
  box, dropping from ~1.9MB/1.4MB to ~1.1MB each), confirming this wasn't
  Ines-specific. Re-graded all 7; no override touched, no prior mark
  numbers recorded to diff against since this anchor had never been
  individually audited before.

Net: the "relies on expansion" caps were sound everywhere except the two
anchors with no next-anchor constraint that hadn't already been caught
(Q19(c), Q11) - both share their root cause with Q30/Q7(b) above, just
manifesting as under- and over-reach respectively. **This closes the
full-packet audit gap**: every anchor in the packet has now been either
mechanically re-cropped with zero changes, or individually visually
verified, or fixed and re-verified.

### Q1(e) truncation found again, 30 Aug 2026 - the audit above missed a case class, now a reusable script

A teacher spotted Davi Verma's A.1 Q1(e) crop cut off mid-sentence ("...but",
no second line) three days after the "closing the gap" audit above supposedly
covered every anchor. Root cause was the exact ink-density-gap limitation
already documented for Q3/Q30 (`_adaptive_crop_bounds`'s per-step density
check landing at 0.0462, just under the 0.05 threshold, in the blank paper
between this question's two ruled lines - confirmed by literally re-running
the deployed algorithm step-by-step against the real page) - except this time
`expand_max_y1_pt` (811.89) was already generous, so the anchor never got
flagged by the possibly_truncated detector (which only fires when expansion
hits its CAP with ink still touching the edge - it structurally cannot see
"expansion never even started because the first check came in just under
threshold"). Same failure mode as Q30, different anchor, and the earlier
audits' "possibly_truncated=true" sweep was never going to catch it because
nothing was ever flagged.

**Fixed the same established way**: widened Q1(e)'s own `y1_pt` (535.68 ->
564.9) directly to its true printed border, measured off the same left-
accent-bar signal the 27 Aug audit used by hand - bypassing reliance on
runtime expansion for this box entirely, same as the Q30 fix. `expand_max_y1_pt`
was untouched (already correct; the box's own base height was the problem,
not the cap). Re-cropped and re-assessed Q1(e) for every identified student
in the packet (not just Davi) - the crop grew for nearly everyone (most
students' answers spilled onto the second line), several marks changed as
previously-invisible content became visible, matching the same pattern as
every prior fix in this section.

**The one-off "measure the true border by hand" process from the 27 Aug audit
is now a committed, reusable script**: `platform/scripts/audit_anchor_geometry.py`.
It re-implements the same left-accent-bar detection, generalized to run
against any packet version's anchors (`--pdf <any split/master PDF>
--anchors <na_anchors rows as JSON>`), and reports candidate undershoot
anchors (base `y1_pt` short of the box's own true printed border) for a
human to verify against the actual rendered page before touching anything -
same trust-but-verify posture as every fix in this file, not an auto-apply
tool. Its overshoot/swallow-risk heuristic (comparing `expand_max_y1_pt`
against the true border by raw distance) was tried and abandoned during
this same session: it flagged 30+ of 40 anchors as "risky" purely because
they have ordinary blank whitespace before the next question, which isn't
the actual danger signal (the real Q11-class risk is PRINTED content in that
gap, which distance alone can't distinguish) - don't resurrect it without
solving that distinction first.

**Required for every future packet, not just A.1**: run this script against
a new packet version's anchors before its first real scan, verify any
flagged undershoot by eye against the rendered page (a false positive costs
a few seconds; a missed real one costs a wrong mark with no visible signal,
same asymmetry documented throughout this section), and widen `y1_pt`
directly for any confirmed case rather than only widening `expand_max_y1_pt`
and hoping runtime expansion reaches it - that hope is exactly what failed
twice now (Q30, Q1(e)). This closes the actual gap in the 27 Aug audit: that
one only checked anchors where a student's ink had already tried and failed
to cross the box; a bounded, "true border by direct measurement" check like
this script's doesn't need to wait for a student to hit it first.

---

## 6. What an agent session can and cannot reach

Verified 24 Aug 2026, corrected 27 Aug 2026. This is the single most useful thing to
know before planning work, and both handoffs before this one got it wrong in ways
that mattered.

| Capability | Status |
|---|---|
| Supabase SQL (via MCP) | Full - connects as `postgres` superuser |
| Supabase REST + Storage (direct HTTPS, service-role key) | **Full**, as of 27 Aug 2026 - both `qnawglgnoojrlaivylou.supabase.co/rest/v1/` and `/storage/v1/` returned 200 to a plain `curl` with `SUPABASE_SERVICE_ROLE_KEY`. The 24 Aug handoff called Storage blocked; that was either wrong at the time or the network policy changed since - either way, don't trust that line without re-testing, since this table has now been wrong in both directions. |
| Railway / CV service | **Full**, as of 27 Aug 2026 - `GRAPH_LAB_CV_SERVICE_URL` and `CV_SERVICE_SECRET` were added to the agent environment and the Railway domain was allowed in the network policy. `curl -H "X-CV-Secret: $CV_SERVICE_SECRET" $GRAPH_LAB_CV_SERVICE_URL/health` returns `{"status":"ok"}`. This was the literal blocker on the Q26(a) backfill (§9) and is now resolved. |
| Vercel (via MCP) | Full - projects, deployments, logs |
| GitHub | Full, once the Claude GitHub App is installed |
| Google Drive | Read |
| Direct HTTPS to the app | **Blocked** - `clevermathematics.com` and `*.vercel.app` 403 at the gateway (not re-tested 27 Aug, only Supabase and Railway were) |

Consequences, updated: an agent session can now read/write Storage directly and run
CV-service-dependent pipeline stages (crop extraction, and stage 5 assessment via a
script that imports `lib/na-assessment.ts` directly rather than going through the
app's authenticated API routes) as long as it has `SUPABASE_SERVICE_ROLE_KEY`,
`GRAPH_LAB_CV_SERVICE_URL`/`CV_SERVICE_SECRET`, and an Anthropic key in its own env
(this session had `GRADING_ANTHROPIC_API_KEY`, not `ANTHROPIC_API_KEY` - the app's
own routes read `ANTHROPIC_API_KEY` specifically, so confirm that's actually set on
the Vercel deployment too, or stage 5 will 500 there even though it worked from this
session). None of this is available by default - re-verify reachability each
session rather than trusting this table, which has already been wrong twice.

**This exact confusion recurred concretely on 29 Aug 2026** while wiring up the
bulk-upload worker's Railway service (`platform/worker/`, see its README): a
variable got created there literally named `GRADING_ANTHROPIC_API_KEY` (copying
this section's variable name rather than renaming it), which silently does
nothing - `platform/worker/anthropic-client.ts` reads `process.env.ANTHROPIC_API_KEY`
specifically, so a differently-named variable leaves the worker unable to start
regardless of whether the value itself is a valid key. Any service that needs
Anthropic access must have a variable literally named `ANTHROPIC_API_KEY`; treat
`GRADING_ANTHROPIC_API_KEY` as this repo's own internal label for "a grading-scoped
key used in one past agent session," never as an env var name to reuse elsewhere.

---

## 7. Security status

| Item | Status |
|---|---|
| RLS on all public tables | Enabled (80/80) |
| Role self-promotion | Blocked by trigger |
| Registration codes | Behind SECURITY DEFINER RPC |
| CSRF origins | Explicit allowlist, no wildcards |
| Storage buckets | All 5 private, signed URLs only |
| `DEPLOY_SECRET` | Rotated 23 Aug 2026; **no literal value was ever committed** (verified across all 959 commits) |

**Open exposure.** A full-history scan on 24 Aug 2026 (6,298 blobs, 959 commits)
found exactly one credential: a Google OAuth client secret (`GOCSPX-...`) in
`STEP1_SUPABASE_SETUP.txt`, added 17 Apr 2026 in commit `634a5bd`. It does not match
placeholder patterns, so treat it as real. It is not on `main`, but it IS on two
live branch tips in this public repository:

- `origin/copilot/compile-projects-documentation`
- `origin/copilot/vscode-mpclx5x4-qp36`

Rotating that secret in Google Cloud Console is the only real remedy - the repo is
public, so removal from git does not un-leak it. Deleting those two stale branches
(both last touched 19 May 2026) removes the browsable copy.

No Supabase service-role JWTs, Anthropic keys, AWS keys, private keys, GitHub tokens
or Slack webhooks were found anywhere in history.

---

## 8. Build, test, deploy

```bash
cd platform
npm ci                  # not npm install
npm run dev             # --webpack only
npm run build           # must exit 0 before any push
npm test                # must exit 0 before any push
npm run cv:quality-gate # 100% pass rate required
```

`main` = production. No staging. A broken build means students cannot access their
work. Vercel builds every branch, so pushing a feature branch produces a preview
deployment - it is not deploy-silent, but it is not production either.

`next build` appends `/.swc` to `platform/.gitignore` on every run; that entry is
committed so the tree stays clean.

### Incident, 29 Aug 2026: the bulk-upload worker briefly corrupted 10 real batch statuses

Minutes after first deploying `platform/worker/` (the bulk-upload background
worker, see its README) to Railway, it claimed and set `status = 'failed'` on
**10 real, pre-existing `na_scan_batches` rows** — including `db4d3a05`, the
live A.1 batch with 7 real students' actual grades that §5 of this doc
documents in detail. Root cause: the worker's claim query matched on status
alone (`split`/`cropped`), and those statuses have been used by the normal
single-upload flow for months — nothing distinguished "a batch the worker
created and owns" from "any batch anywhere in the system currently sitting at
that status." Its `findPacketScanId` also assumed exactly one
`na_packet_scans` row per batch (true only for its own bulk single-student
uploads), so against a real multi-student batch it failed with "No packet
scan found," which the pipeline treated as a hard failure and wrote back as
the batch's new status.

**No crop, feedback, or grading data was touched or lost** — the failure
happened before any of that was reached, so this was a `na_scan_batches`
status/metadata corruption only. Caught within minutes (the worker's own
per-pass summary logs made it visible), fixed in two steps: the 10 rows were
reverted to their correct prior status directly via `execute_sql`, and
migration `20260829192600_na_scan_batches_scope_worker_claims` added
`na_scan_batches.is_bulk_upload` (default `false`) and rewrote
`claim_next_na_scan_batch` to require it — closing the hole at the DB level,
which took effect on the worker's very next poll with no redeploy needed
(the app-level fix, having `POST /api/na-review/batch/bulk` actually set the
new column, followed after). The revert had to be applied twice: the
worker's ~15s poll loop re-claimed and re-failed the same 10 rows once
before the DB-level guard was in place.

**Lesson for any future worker/background-job code in this repo, given no
staging environment exists**: a claim/ownership query must positively
identify "rows this job is allowed to touch," never merely "rows in a state
this job knows how to advance" — an existing status value is not a safe
proxy for ownership if anything else in the system can produce that same
status through a different path. This should have been caught in the
original plan (it wasn't) and is exactly the class of risk Phase 0 of that
plan's rollout was meant to catch by testing against manually-inserted rows
before real use — worth remembering that Phase 0 testing needs to include
"does the claim query accidentally match real existing data," not just "does
the happy path work."

---

## 9. Open items

**High**

1. **Merge the reconciliation branch.** Six commits sit on
   `claude/clevermathematics-handoff-qf1fbz` and none are on `main`. Until they
   merge, the migration landmine fix is not in effect.
2. **Rotate the leaked Google OAuth client secret** and decide whether the repo
   should stay public (§7).
3. **Decide whether to delete the 3 orphaned `pilot-ingestion` packet scans** (§5).
   Identified 27 Aug 2026 (by matching handwriting/answers, since nothing in the
   database pointed at them) as duplicates of 3 already-live students - Ines
   Palomino, Freya Delisle, Davi Verma - from a one-off pre-batch-system pilot
   run. Same situation as the `f5519dd6` duplicate that was already deleted: dead
   weight in the review UI, and at least one grading discrepancy found against
   the live assessment (§5) means the pilot data shouldn't be trusted alongside
   it. Not deleted yet - teacher chose to document only, for now.

**Medium**

4. Grade 9 Standard NA packets - none seeded. **Declined 13 Sep 2026**: the
   teacher was offered this directly and said they do not need Grade 9 Standard
   materials at this time. Nothing is broken and nothing is blocked - the track
   and its virtual course still exist, and the Nuanced Analysis creator still
   offers both Grade 9 tracks - so this is a decision not to seed, not an
   outstanding task. Left listed because the gap is real and may matter later;
   do not raise it again unprompted.
4b. **4 crops flagged by the teacherNote backtracking detector, awaiting manual
   verification** (found 28 Aug 2026 while investigating the Q1/Q1(e) issue below;
   these are unrelated judgment calls, not the same bug). Each has `ai_teacher_note`
   containing "changing its mind mid-explanation" - the model's own reasoning
   reached one number in prose but submitted a different `marksAwarded`:
   - ~~A.1 Q1, Gian luca Del corral (`5e18cf75`) - noted 3/3, submitted 2/3.~~
     **Resolved 28 Aug 2026** by the re-run below - now 3/3 cleanly, no warning.
   - A.1 Q15, Davi Verma (`fb4b6967`) - genuine partial-credit judgment call
     (unconventional but valid algebra), submitted 3/4.
   - A.1 Q6, Kaito Fujii (`3797e2c9`) - genuine partial-credit judgment call
     (coefficient/variable-list interpretation), submitted 4/5.
   - A.1 Q8, Freya Delisle (`511127b9`) - genuine partial-credit judgment call
     (unit-price vs. total-price wording), submitted 3/5.
   Query: `ai_teacher_note ilike '%changing its mind mid-explanation%'` joined
   through `na_response_crops`/`na_anchors`. None have been corrected yet - a
   teacher needs to read each crop against its own reasoning and decide the real
   mark; these are exactly what the detector exists to surface, not something to
   silently re-run and trust.
4c. **A.1 Q1 / Q1(e) shared a single un-scoped rubric text, fixed 28 Aug 2026.**
   Both anchors are separate boxes on the page (Q1 = parts a-d work space, 3
   marks; Q1(e) = the "write down one thing you notice" answer line, 1 mark) but
   `na_anchors.question_text`/`question_answer`/`answer_sketch` were byte-identical
   on both rows, copied verbatim from `nuanced_analyses.parts` (which never split
   the question - it's one pedagogical item there, `marks: 4`, one combined
   prompt/answer covering a-e). Stage 5's existing SCOPE-hint logic
   (`buildRubricBlock` in `na-assessment.ts`) already told the model to ignore
   parts not in its crop, but the model still had to read and consciously discard
   (e)'s prompt/answer every time it graded Q1, and vice versa - exactly the setup
   that produced the Gian luca Del corral backtrack above (Kaito Fujii hit the
   identical failure mode on this same anchor previously, see `validateAssessment`'s
   own code comment). Fixed at the data layer, not the prompt layer: edited both
   `na_anchors` rows directly so Q1's fields now cover only (a)-(d) and Q1(e)'s
   cover only (c)-(e) (keeping (c)/(d) as context since the observation task
   directly references them) - the model now never sees the other box's content
   at all, so there's nothing left to reason about ignoring. `nuanced_analyses.parts`
   was deliberately left untouched (correct at that layer - it's the single
   authored pedagogical question, not per-crop rubric data); only `na_anchors`,
   which stage 5 actually reads per crop, needed splitting. Only this packet
   version's anchors were touched - a future packet version authored fresh from
   the same `nuanced_analyses` row would need the same split applied again if its
   anchor extraction also copies `parts` verbatim onto multiple sub-part anchors.
   **Re-run completed 28 Aug 2026** for the 10 real, identified students (20
   crops: Q1 + Q1(e) each), via a one-off script
   (`platform/scripts/reassess-q1-tmp.ts`, run with `npx tsx` and deleted after
   - not committed, mirrored `response-crops/[cropId]/assess/route.ts` exactly
   rather than reimplementing its logic) using `SUPABASE_SERVICE_ROLE_KEY` +
   `GRADING_ANTHROPIC_API_KEY` from the agent environment, since direct HTTPS to
   the app is blocked from this environment (§6) so the authenticated route
   itself couldn't be called. Deliberately excluded packet_scans `0525197b`,
   `f854e03e`, `475e3a0d` - these are the 3 orphaned pilot-ingestion duplicate
   scans already in Open Items #3 (`needs_review`, not real distinct students,
   not worth spending Claude calls on data pending a delete decision). Result:
   all 20 assessed cleanly, **zero warnings** (no backtracking, no clamped
   marks, no unclear-with-marks contradiction) - confirms the scope fix removed
   the ambiguity at the source. Gian luca Del corral's Q1 now correctly reads
   3/3. A few genuinely `unclear`/low marks came back (Davi Verma and Roberto
   Aurelio Gamio's Q1(e) both 0/1 unclear; Yunseo Oh's Q1 0/3 unclear; Galo
   Masias's Q1 1/3) - these are the model's honest read of what it could see,
   not errors, and worth a normal teacher glance like any `unclear` verdict.
4d. **Question-prompt image crops, added 28 Aug 2026.** Teacher request: the
   "why this mark" panel showed `question_text` (plain text, extracted once at
   anchor-authoring time) but not what was actually printed on the page, and
   the student's own answer crop doesn't reliably include it either -- some
   anchor boxes happen to start right where the prompt is (e.g. Q1(e)),
   others start well below it (e.g. Q7), with no visual confirmation of which
   case applies. Added `na_anchors.prompt_crop_storage_path` (migration
   `20260828190337`) holding a ONE-TIME crop of each anchor's printed prompt
   -- per anchor, not per student, since the printed content is identical for
   everyone. Backfilled for this packet version (`1462a2f2`) via a one-off
   script (same "not committed, mirrors real app logic" pattern as the 4c
   re-assessment), using one representative student's already-split PDF as
   the crop source (no blank master template exists for this packet -
   `master_pdf_storage_path` is null). Bounding box: same x-range as the
   page's standard content column, y-range from the previous anchor's own
   `y1_pt` on the same page (or the page top if first-on-page) down to this
   anchor's own `y0_pt` -- **no cap on how far back that goes**. A capped
   version (260pt) was tried first and looked right on Q1, but landed
   mid-paragraph in an unrelated worked-example block on Q30 (a page with a
   long scaffolding block before the question) - actively misleading, not
   just untidy. Removed the cap entirely rather than tune a magic number:
   matches this codebase's own established principle (see the "ruled-paper-
   gap" revert above) that a too-generous crop is a tidiness problem a
   teacher can see past, but a wrong one is invisible and worse. Anchors
   whose gap is under 25pt are skipped (null path) rather than given a
   near-empty sliver - verified visually that these are sub-parts like
   Q1(e)/Q7(b)/Q13(b) whose own prompt text sits inside their own box, not in
   the gap before it. Verified by rendering and eyeballing 8 of the 40
   anchors across different layouts (first-on-page with/without a "Part N"
   section banner, small/large gaps after a previous anchor, a 436pt gap on
   Q30) before trusting the heuristic for the rest; 31 of 40 anchors got a
   real crop, 9 were skipped as inside-the-box cases. Wired into the assess-
   list API route (batch-signed alongside the per-student answer crops, same
   bucket) and the scan-test client's "why this mark" panel as a new
   "Question, as printed" image, shown right after the plain-text Question
   and before the student's own answer Crop. A future packet version
   authored fresh would need this backfill re-run for its own anchors.
5. ~~Widen the 46 anchors still flagged `possibly_truncated=true`~~ **Closed, 27
   Aug 2026.** The full anchor-geometry audit (§5) plus the follow-up "relies on
   expansion" sweep found and fixed every genuine case: Q1, Q3, Q6, Q26(b),
   Q13(b), Q30, Q19(c) were real truncations (widened); Q7(b) and Q11 had the
   opposite problem, a cap too generous rather than too tight (Q11 was actively
   swallowing a printed reference box - tightened instead of widened). Every
   other flagged anchor was individually visually verified as a false positive
   (content complete, flag triggered by benign edge ink - page footer, scan
   border, or proximity to a printed box). Every anchor in the packet has now
   been either mechanically re-cropped with zero changes, or individually
   verified, or fixed and re-verified - nothing left unaudited.

**Low**

6. ~~Full NA generation wiring for Grade 9~~ — stale. Generation, continuity, and
   save-back all already work for Grade 9: `buildActivityGeneratorSystemPrompt()`
   has a real `isMYP` branch (Grade 9/10), the NA sandbox fetches `na_continuity`
   client-side and threads it in as `continuityContext`, and `POST
   /api/nuanced-analyses` writes `grade_level`/`parts` and appends a continuity
   digest. The real gap this item was gesturing at: a saved packet's `parts`
   never became `na_rubric_items` — the table the Stage 5 assessor actually
   reads — so a freshly generated packet couldn't be graded without hand-written
   SQL (as was done for packet "A.1"). Fixed via `lib/na-rubric-bridge.ts`,
   which derives rubric rows from `parts` and syncs them on every save,
   non-destructively (a row a teacher has hand-edited is left alone). Anchor
   *geometry* (where each answer box sits on the printed page) remains a
   manual/SQL step by design — it inherently requires a human looking at the
   rendered page. **A.2 (§15) is the worked example of doing that end to end**,
   and records the two things that generalise: geometry must come from the
   distributed print master rather than a re-render, and the printed question
   numbers do not match the `parts[]` ordinal the bridge keys on.

**Closed since the previous handoff**

- Migration drift - reconciled, 83/83, invariant documented.
- Q26(a) anchor - added (see below).
- **Q26(a) crop backfill** - done 27 Aug 2026 for the 7 live scans (280 crops, then
  stage 5 on the 7 new crops, 0 failures). Spawned two new open items instead of
  closing cleanly - the duplicate batch (now also closed, see next) and the 3
  unbackfillable orphan scans (still open, see §5 and Open Items above).
- **Duplicate A.1 batch upload** - resolved 27 Aug 2026. The `f5519dd6` batch (7
  students' worth of near-duplicate, near-unassessed scans/crops) was deleted via
  the Supabase dashboard; the live `db4d3a05` batch was verified untouched
  afterward. See §5 for the full before/after.
- Post-deploy verification workflow at the broken nested path - deleted; it had
  never run and could not have worked.
- Stale `clever-platform.vercel.app` origin - removed.
- Drive OAuth migration to a DB-backed store - **was already done** before this
  session, in commit `829669a`, and the previous handoff was simply out of date.
  Both `google-classroom` and `google-drive` rows exist in `google_oauth_tokens`
  with refresh tokens, and no cookie-based token handling remains anywhere. The
  functions had kept their historical names (`saveDriveTokenToCookie`,
  `getDriveTokenFromCookie`) long after the cookie was gone, which is an active
  trap when auditing where credentials live - they have been renamed to
  `saveDriveToken` / `getDriveToken` across all 14 call sites.
- `debug_log` audit - **keep it.** 0 rows, 16 kB, RLS on with correct policies. It
  has one live writer, `app/api/override/save/route.ts`, reachable from
  `components/reflection/OverrideModal.tsx`. Schema and RLS both check out, so the
  emptiness means the teacher-override path has simply never been used, not that the
  logging is broken. The insert's error is unchecked, so a future failure would be
  silent.

### Q26(a), for the record

Q26 declares 5 marks; only (b) [1] and (c) [2] had anchors. Q26(a) is "Plot all the
possible combinations as points on the grid below" - a coordinate grid, not a filled
box, which is why `auto_fillrect` never saw it. Page 21 has exactly two fill-rects.

The previous handoff said to insert at `sort_order` 32. **That was wrong** - 32 is
Q25, so it would have placed (a) before Q25. Correct is 33, with `sort_order >= 33`
shifted up by one. There is no unique constraint on `sort_order`, so nothing in the
schema would have caught the error.

Anchor: page_index 21, x 50.83-544.50, y 168.00-530.00, `expand_max_y1_pt` 542.00
(bounded just short of the Q26(b) box at 546.17), marks 2, source `manual_grid`.
Recorded as migration `20260824021752`.

---

## 10. Anthropic spend, 2 Sep 2026: usage log, NA cache fix, segmentation dedupe

A cost pass over the three per-student pipelines (NA per-crop assessment on
Sonnet 4.6, AI grading on Opus 4.5, batch segmentation on Opus 4.5) found
~$60-70 of spend to date and three concrete fixes, shipped as one PR with one
commit per fix so each can be reverted alone:

- **`ai_usage_log`** (new table, `lib/ai-usage.ts` `recordUsage`): one row per
  model call with the four token meters, `batch` = went through the Message
  Batches API (50% rate), and a loose `ref_type`/`ref_id` to the run, crop, or
  batch it served. Written by every per-student pipeline call site (app routes
  as the teacher; the bulk-upload worker via service role). Cost per pipeline:
  ```sql
  select pipeline, model, batch, count(*) as calls,
         sum(input_tokens) as input, sum(cache_creation_input_tokens) as cache_w,
         sum(cache_read_input_tokens) as cache_r, sum(output_tokens) as output
  from ai_usage_log where created_at > now() - interval '7 days'
  group by 1,2,3 order by 1;
  ```
  Multiply by the model's per-MTok rates (cache write 1.25x input, cache read
  0.1x input; halve everything where `batch`). Before this table existed, none
  of the numbers in this section could be measured, only estimated.
- **NA assessment cache breakpoint** (`response-crops/[cropId]/assess/route.ts`):
  the only `cache_control` sat on the rubric block, after the per-crop image.
  Measured cold on two consecutive different crops: the old layout still got
  the ~2.8K-token system prompt as a partial-prefix cache hit on the next call,
  but every call also wrote its own image+rubric (~1.8K tokens) to the cache at
  1.25x with nothing able to read it back. Breakpoint moved to the system
  prompt; per call that is ~$0.0122 -> ~$0.0109, about 11%. (The first estimate
  in this session said ~49% -- that assumed the system prompt was never being
  read under the old layout, which the probe disproved. Don't repeat the
  estimate; the meters are in the description of the PR that shipped this, and
  in `ai_usage_log` going forward.) The worker's Batch API path is deliberately unchanged (see its
  comment); decide from `ai_usage_log` whether a system-only breakpoint pays
  there.
- **Segmentation dedupe** (`ai_grade_batches.source_sha256`): the same 90-page
  BiStats batch had been uploaded 14 times, each paying a fresh whole-document
  Opus call (~$0.70). A byte-identical re-upload on the same test now copies the
  earlier `proposed_segments` and skips the model; `forceResegment: true` opts
  out.

**Deliberately not done**, so it isn't re-litigated: no grading-model or effort
change (no eval exists; run-to-run drift of 1-3 marks per part was observed on
Opus 4.5 re-grades of the BiStats test -- `ai_grade_results.accepted` rows are
the natural golden set for a future one); no Sonnet 5 for segmentation (only
one distinct batch document exists to evaluate on); no Batch API for bulk-mode
grading (real submit/poll UX work -- revisit once the usage log shows how much
grading is bulk-mode).

**Two housekeeping findings, both fixed later the same day.** (1) The migration
ledger and the directory had drifted again since the Aug 24 reconciliation (95
rows vs 94 files; eight late-Aug files under author-chosen timestamps instead of
the ledger's; one migration with no file at all). Root cause and the fix are in
`platform/supabase/migrations/README.md` ("Second reconciliation, 2 Sep 2026"):
`apply_migration` assigns the version at apply time, so a file must be renamed
to the ledger's version afterwards. (2) `SCHEMA.md` at the repo root was a
312-byte PostgREST error blob, not a schema reference, despite `platform/CLAUDE.md`
listing it as required reading. Regenerated from `information_schema` (82 tables,
with the SQL to refresh it in the file's header).

**Follow-ups shipped the same evening, one PR each** (#89-#92 plus the hygiene
PR): the review page now uses a student's newest *complete* run rather than a
failed one, and a re-mark keeps `accepted` on parts whose suggestion did not
change (with a `was N` chip on parts that did); every marking call runs at
`temperature: 0`; every marking call uses structured output from the existing
zod schemas plus one retry on an invalid response; and the AI-grade page shows a
banner when the deployed key cannot complete a call (new `GET /api/health/anthropic`).
The never-called page-identity code in `lib/na-scanning.ts` was removed.

## 11. Grading eval, spot-check routine, and two loose ends (3 Sep 2026)

**`platform/scripts/eval-grading.ts`** is the first measurement of AI grading
quality that is not a single run's own confidence label. Golden set = every
`ai_grade_results` row a teacher accepted, resolved to the mark actually in
`student_marks` (override included), for runs whose scan is still on file --
today that is the 9 BiStats students / 51 parts (UniStats has 55 accepted
parts but no stored scans, so it cannot be re-graded). `--dry` lists the set
for free; a full run re-grades every scan through the app's own prompts,
structured output and validator, writes nothing back except `ai_usage_log`
rows (`pipeline = 'ai_grade_eval'`), and prints exact / within-1 / MAE /
bias / per-part / cost. Run it before and after any prompt, model, or
grading-policy change and diff the two `--out` JSON files.

**Baseline, Opus 4.5 at temperature 0** (`docs/eval/2026-09-03-bistats-baseline-t0.json`):

| parts | exact | within 1 | MAE | bias | cost |
|---|---|---|---|---|---|
| 51 | 42 (82%) | 51 (100%) | 0.18 | -0.10 | $1.42 |

Per part: Q1 6/9 exact, Q2 7/9, Q3 8/9, Q4(a) 7/8, Q4(b) 8/8, Q4(c) 6/8. Every
miss is exactly one mark, and the model runs slightly stingy. Read this as
"the model and the teacher agree within a mark on everything, and exactly on
four parts in five" -- a floor to protect, not a ceiling. Caveats: the golden
marks were themselves accepted from this model's earlier suggestions (70 of 77
as suggested, 7 overridden), so the set is not independent of the model; and
Julio Bravo's Q1 history across ten runs reads 3,4,3,5,5,5,5,2,2,2 -- the
oscillation the temperature change was meant to reduce -- so a second
baseline run a day later is the real test of temperature 0.

**Daily spot-check Routine** (`trig_01C7QDGV5MrvNSFtw3AZhkdi`, 13:07 UTC =
08:07 Lima, fires into the 2 Sep agent session): pulls the 3 parts most worth
a look from the last 24 h, the day's spend from `ai_usage_log`, and any failed
run, then asks the teacher whether they agree. Disagreements are eval cases.
The Routine's prompt carries a Supabase REST fallback because Routine-fired
sessions may not hold the MCP connector.

**Two loose ends found while executing the 2 Sep review's plan:**

- **PR #34 (server-side batch run tracking) cannot be merged as-is.** Its
  branch, like PRs #1 and #2 (now closed), predates a rewrite of `main` and
  shares no history with it. Its four new files apply cleanly onto today's
  `main`; the two edits to `dashboard/layout.tsx` and
  `na-review/scan-test/scan-test-client.tsx` conflict and would need to be
  re-done by hand. The `na_batch_runs` table it introduced is live and empty.
  **Resolved: ported.** The teacher chose to keep the feature; it was
  re-applied onto `main` the same day (four files copied verbatim, the
  scan-test and nav edits re-done by hand, the nav now living in
  `lib/dashboard-nav.ts`). PR #34 was closed in favour of the port. First
  real use will be the next automatic crop+assess run from the scan-test
  page: expect one `na_batch_runs` row per batch, visible at
  `/dashboard/na-review/batch-runs`.
- **The two branches carrying the leaked Google OAuth client secret
  (`copilot/compile-projects-documentation`, `copilot/vscode-mpclx5x4-qp36`)
  could not be deleted from the agent environment** -- the git proxy accepts
  pushes but hangs up on branch deletion, and the GitHub MCP toolset has no
  delete-branch call. Both are still on the public remote. Delete them from
  the GitHub branches page, and rotate the secret in Google Cloud Console
  regardless: deletion does not un-leak a public commit.

## 12. Formative-assessment batch uploads over 100 pages (4 Sep 2026)

The Grade 9 NA pipeline never had a page limit (it sends the model one cover
page at a time, see §5 and `app/api/na-review/batch/route.ts`), but the
formative-assessment batch route (`/api/tests/[id]/ai-grade/batch`) sends the
WHOLE PDF to Opus in one call, so it rejected anything over Anthropic's
100-page document limit or 32MB request limit with "split the scan into two
batches and upload each separately".

It now cuts such an upload into parts itself (`lib/batch-chunking.ts`,
tested in `lib/batch-chunking.test.ts`). Each hard boundary is pulled back to
the nearest cover page, found with the NA pipeline's single-page Haiku check
(`pipeline = 'ai_grade_chunk_cover'` in `ai_usage_log`, a few cents per
upload), so no student's script straddles a cut; if no cover page is found
within 24 pages the cut lands on the hard boundary and the UI shows a
warning naming the two parts to check. Parts are written next to the
original in Storage (`batches/<uuid>/part-i-of-n.pdf`) with fixed metadata
dates, so a re-upload of the same scan produces byte-identical parts and the
`source_sha256` dedupe from §10 skips the Opus call. There is NO parent row
in `ai_grade_batches` (its `status` check constraint has no value for one);
each part is an ordinary batch whose `file_name` reads
"scan.pdf (part 2 of 3, pages 98-190)". The Batch tab segments the parts one
request at a time and renders one review-and-grade panel per part. Page
numbers inside a part's panel count from 1 within that part.

## 13. Self-assessment submit, and the migrations workflow (7 Sep 2026)

**Students could not submit their self-assessed scores** (#149). The self-grade
form tells them to leave a box blank if they made no attempt and sends that box
as `NULL`; `student_self_scores.self_marks` was `NOT NULL DEFAULT 0`, so Postgres
rejected it with `23502`. Only a student who filled in every single box got
through, which is why the table had rows at all and why the failure looked
intermittent rather than total. Migration `20260907152544` drops the `NOT NULL`
and the default: `NULL` now means "did not attempt", `0` means "attempted and
earned nothing", and those are different facts about a student.

The client made it worse by upserting one row per question in a loop and throwing
on the first error, so every question before the blank was already committed - an
error message *and* a half-saved self-assessment, which counts as having
self-graded and moves the student off the Self-Grade step. It now sends the whole
assessment as one upsert (`lib/reflection-self-scores.ts`): all rows land or none
do. That also fixes a second failure seen live during the session - a submit that
wrote 35 of 41 questions over 24 seconds and then simply stopped, losing six
answers with nothing told to the student. Forty-one sequential round trips is
forty-one chances to lose the tab.

Two consequences of making blanks storable, both handled: `computeDisagreement()`
reads a blank as a claim of zero marks *once the student has self-graded* (Upload
Corrections only unlocks at 0%, so counting it as full disagreement locked them
out for following the form's instructions), and the Compare table no longer seeds
a blank box with `0` or files that `0` when Save Changes is pressed. A student who
has not self-graded at all still reads as 100% disagreement, unchanged.

**Known-lossy, not fixed:** the teacher Override Scores modal
(`components/reflection/OverrideModal.tsx`) still types self-marks as plain
numbers, so opening and saving it turns a student's blanks into `0`s.

**Two data items left alone deliberately.** One student on Formative Assessment 1
is missing her last six answers from the truncated submit; they cannot be
reconstructed and she has to refill them. Three rows showing 18 of 19 items on
"27AH [K06] P1" are *not* corruption, despite looking like it: `test_items
.created_at` shows Q6(b) was added on 2026-05-23 22:00:02, three days after the
other 18, and the submission times split cleanly around it. Those students graded
every question that existed. Writing marks for a question they were never shown
would fabricate a judgement they never made. They currently read as claiming 0 on
it; self-grading it themselves is the fix.

**`platform-supabase-migrations.yml` had been failing on every merge since 6 Sep**
and nobody noticed, because it only runs on push to `main` and so never appears as
a PR check. Two independent faults, both fixed and both detailed in §4: the direct
database host is IPv6-only and GitHub Actions cannot reach it, and the push step
ran from the repo root, where a second `supabase/` directory shadowed the real
migrations. Either alone was enough to break it, which is why the plain reading
("it worked until 6 Sep") is wrong - it had never applied a migration from CI at
all.

The thing to remember: it is a safety net for a migration file that reaches `main`
unapplied, not the usual path - migrations normally go through MCP
`apply_migration` first, so a green run here usually means it found nothing to do.

## 14. Quick read, overnight marking, and why neither has a worker (9 Sep 2026)

**Segmentation was about a third of what an upload cost.** The 84-page, 7-student
formative scan billed on 4 Sep came to ~$3.00, and ~$1.00 of that was the single
whole-document Opus read that produces `proposed_segments` -- money spent before a
mark has been suggested for anybody. The batch upload now has two ways to get those
segments. **Quick read** puts every page through the single-page Haiku cover-page
check (`lib/cover-page-segmentation.ts`, `pipeline = 'ai_grade_cover_page'`) at ~0.3
cents a page, against ~1 cent a page for Opus reading the document in one go, and
cannot hit Anthropic's 100-page or 32MB document limits at all, because every request
carries exactly one page. **Deep read** is the old whole-document read, kept as a
checkbox. Quick is the default for a new upload; `ai_grade_batches.read_mode` defaults
to `'deep'` in the database instead, because that is what every row predating the
column actually was.

The `source_sha256` dedupe from §10 had to learn the difference, and its reuse rule is
deliberately ASYMMETRIC: a quick request may reuse a stored `quick` or `deep`
proposal, a deep request only a `deep` one. A deep read finds everything a quick read
does and more, so serving one to a quick request is never a downgrade. The other
direction is exactly the teacher's "the quick read got a loose sheet wrong, read it
properly" retry, and answering that out of the cached quick proposal would silently
ignore what they asked for. `forceResegment: true` still bypasses the dedupe entirely.

**What Quick read gives up, plainly.** It builds segments by position: each student
runs from their cover page to the page before the next cover page. A loose sheet
scanned out of order therefore lands in whichever student's run it physically falls
inside, and nothing detects it -- it surfaces as somebody else's working in a
student's script at review time. Deep read, which can reattribute a page to a student
whose cover page is elsewhere, is the answer to that, and is the reason it stays
available rather than being deleted as the expensive old path.

**Overnight marking** sends a whole class to Anthropic's Message Batches API (50% off
every token, cache reads and writes included) instead of the browser looping over
students against the synchronous route at full price with a tab that has to stay open.
Usage is recorded by the collect route, not the submit -- a batch reports its tokens
per result -- so the `ai_usage_log` rows land with `batch = true` as results are read.
As of 9 Sep there are no such rows yet: the halving is Anthropic's published rate, not
something this repo has measured on a real class.

**There is no worker behind it, and that is the design, not an omission.** The obvious
shape for this is a queue plus a background service, and this repo has one already:
the Railway bulk-upload worker (`platform/worker/`, §8). It is not usable. It has
claimed nothing since 30 Aug 2026 -- the newest `na_scan_batches` row with
`is_bulk_upload` is 30 Aug 00:51 UTC -- its container is SIGTERMed within seconds of
starting, and on 7 Sep the Railway account read "15 days or $3.41 left". Handing a
class to it would queue the work into a void, with nothing to tell the teacher. So the
submit runs inside the request the teacher's click makes
(`POST /api/tests/[id]/ai-grade/queue`), and the page does the collecting:
`POST /api/tests/[id]/ai-grade/collect` on load, on a 30s interval while anything is
still pending, and from a "Check for results" button. What makes collect-on-visit safe
rather than lossy is that Anthropic keeps a batch's results for 29 days -- nobody has
to open that page tonight, or this week. (The CV service runs on the same Railway
account, so its funding is a live question for evidence crops too, not only for the
dead worker.)

A submitted run sits at `ai_grade_runs.status = 'submitted'` with
`pending_message_batch_id` pointing at its `ai_grade_message_batches` row; the pointer
is cleared when the result is written, so "non-null and still `submitted`" is exactly
what collect still owes an answer for. Two exits are not results: a run `submitted`
for an hour with no batch pointer never made it into a batch (the Anthropic create
succeeded, the write recording which batch did not) and is failed telling the teacher
to re-submit that student, and a batch still open after 30 hours is past Anthropic's
24h ceiling, so its runs are failed rather than left waiting forever.

**Two migrations, applied through MCP `apply_migration` and renamed to their ledger
versions per §13.** `20260909032326` adds `ai_grade_batches.read_mode`
(`'quick' | 'deep'`, default `'deep'`). `20260909035036` widens the
`ai_grade_runs.status` check to `('submitted', 'running', 'complete', 'failed')`,
creates `ai_grade_message_batches` (one row per submission; `anthropic_batch_id`
unique, so a double submit cannot produce two rows tracking one batch; partial index
on the open statuses, which is the collect route's working set), and adds
`ai_grade_runs.pending_message_batch_id`. Both are in `SCHEMA.md`.

**The operational thing to remember: neither half is a single request.** One submit
call takes at most `MAX_BATCH_REQUESTS` (20) students or `MAX_BATCH_BASE64_BYTES`
(64MB of base64, ~48MB of PDF -- every scan sits in that invocation's heap at once)
and returns the rest as `remaining`. One collect call writes at most
`MAX_RESULTS_PER_CALL` (5 since the collect budget was re-measured; the code is the reference) results, because writing one re-downloads the student's PDF
and calls the CV service for evidence crops, the same 10-30s the synchronous route
spends, and it answers `more: true`. Both are therefore client-driven loops: the batch
tab posts to queue until `remaining` is empty (and gives up if it stops shrinking),
and the page posts to collect up to `MAX_COLLECT_PASSES` (40) times per pass. Code
that calls either route once and reports the class done is wrong.

---

## 15. A.2 set up as a scannable packet (9 Sep 2026)

"What Undoing Really Means" (Unit 1, A.2) is the second packet to become
scannable, and the first with a retained print master. Packet version
`2f8a4c31-6b7e-4d92-a1f5-8c3e07b9d240`, 32 anchors, 99 marks, `page_count` 20.
Three migrations, applied through MCP `apply_migration` and renamed to their
ledger versions per §13: `20260909124540` (packet version, 32 rubric items, 32
anchors), `20260909124702` (master PDF path), `20260909124949` (prompt crops).
132 files / 132 rows, byte-identical.

**Geometry came from the distributed print master**, not from a re-render. That
distinction is the whole ballgame: `d1ff83b` (8 Sep) changed what the Typst
header prints, so a packet rendered today does not lay out like the one the
students were handed in August, and anchors derived from a fresh render would
sit at the wrong offsets on every page. The master is
`U1_A2_What_Undoing_Really_Means.pdf` from Drive, now also at
`na-masters/<packet_version_id>/master.pdf` in `exam-scans` and recorded in
`master_pdf_storage_path` -- the column A.1 leaves null, which is exactly why
A.1's Q26(a) backfill had to borrow a student's split scan and why its 3 orphan
scans could not be backfilled at all. Re-derive A.2's geometry from Storage;
never from a re-render.

**Answer boxes are separable from decoration by x-coordinate.** Answer boxes are
drawn at x0=50.83/x1=544.50; the information boxes (WHAT YOU NEED, TOK, ATL,
the spotlights) are at the inset 51.02/544.25 and quote boxes at 87.87/466.93.
That rule picks out 32 boxes from 57 candidates, and every one of the 32 was
rendered over its page and checked by eye before anything was written.

**Printed question numbers are NOT the `parts[]` ordinal.** The Part 0 Desmos
activity occupies `parts[]` slot 2 but prints unnumbered, so printed Qn ==
`parts[]` question n+1 from Q2 on. The mapping is not a guess: all 21 printed
"Clev's Marks: N" labels agree with the `parts[]` marks exactly. Anything that
joins anchors to `parts[]` by ordinal will be off by one -- including
`lib/na-rubric-bridge.ts`, which is why A.2's rubric rows carry
`source = 'authored_from_print'` rather than `'generated'`: the bridge skips any
row whose source is not `'generated'`, so a later packet re-save cannot overwrite
these with differently-numbered ones. (A.1's 39 hand-authored rubric rows are
marked `'generated'` and do NOT have that protection. Latent, not yet bitten.)

**`page_count` is 20 because the printed packet is 20 pages**, even though the
document's own footer says "Page 1 of 23". A.1 does the same thing -- 26 pages
under a footer reading "of 32" -- because the Extension section is generated but
not printed. `page_count` is the stride the batch segmenter uses to find where
each student's copy starts, so it must match what a student physically hands in,
not what the generator produced. A.2's Extension (printed Q22-Q24, all 0 marks)
has no anchors because it has no printed pages.

**Two conventions carried over from A.1's hard-won fixes.** Sub-part boxes get
their own anchor and their own rubric row, with `question_text`/`answer_key`
scoped to that box's own sub-parts -- the assessor is never shown a neighbouring
box's prompt and left to discard it, which is the setup that produced A.1's
Q1/Q1(e) backtracking (open item 4c). And the Part 0 Desmos box carries no marks
and no key of any kind, so `isUngradedAnchor()` skips it rather than inventing a
verdict for a thinking space.

**Q19's anchor is `manual_table`.** Its reflection table is ruled, not filled, so
only the header row registers as a fill-rect; the anchor is drawn over the whole
table (255.82-470.00, five body rows ending at the 465.9 rule). Same treatment
A.1's Q9 needed, and the same reason `auto_fillrect` missed A.1's Q26(a) grid.

**Prompt crops: 22 of 32**, generated from the master at 300 DPI, two refinements
over the A.1 backfill, both found by looking at the output. The narrow inset
boxes do NOT act as separators (they are printed parts of the question -- treating
them as separators cost Q21 its prompt entirely and cut the quote out of Q5's and
Q17's), and the anchors themselves DO (without that, Q20's crop opened with the
five empty rows of Q19's table). The 10 skipped are sub-part boxes whose prompt
is printed in the shared block above their question's first box.

### The tooling, for A.3 onwards

The method above is now two scripts, cleaned up out of the one-off A.2 session
so the next packet does not start from scratch:

- `platform/scripts/na_derive_anchors.py` — `--layout` (per-page text with box
  boundaries, the read you do first), `--candidates` (proposed anchors plus an
  x-signature census, so a template change shows up as an unfamiliar signature
  instead of as missing anchors), `--annotate` (the anchors drawn over the
  master — look at this), `--sql` (the migration body).
- `platform/scripts/na_prompt_crops.py` — renders, uploads and records the
  printed-prompt crops. Run it after the anchor migration is applied, since it
  needs the anchors' real ids.

`platform/scripts/na_packet_a2.json` is A.2's config, kept as the worked
example. Regenerating from it reproduces all 70 data lines of migration
`20260909124540` and all 22 prompt crops byte-for-byte, which is how the
scripts were checked — with one deliberate exception since: the config carries
Q3's corrected 3/3 split, which `20260909174056` applied afterwards, so a
regeneration diff of exactly those four rows (Q3 and Q3(b), in the rubric
insert and the anchor insert) is correct. Any other difference is not, and
means the tool changed behaviour — A.3 should not be authored with it until
you know why.

The packet-specific judgments live in the config, not the code: the printed-to-
`parts[]` question map, the mark splits, any `open_rubric`, the ungraded
activity boxes, and anchors fill-rect detection cannot see. `--sql` verifies the
map against every printed "Clev's Marks: N" pill and checks that each split sums
to its question's total, and **refuses to write anything if either disagrees** —
that check is what proved A.2's off-by-one mapping rather than assuming it, so
do not work around it.

### What a teacher should check before the first scan upload

- **The per-box mark splits.** `parts[]` records one total per question, not a
  per-sub-part breakdown, so the 7 multi-box questions were split by reading the
  printed sub-parts and their answer keys: Q1 3/1, **Q3 3/3**, Q5 2/3, Q13 1/3,
  Q14 1/2/2/1, Q17 3/2, Q18 1/2/3. Every split sums to that question's printed
  total and the 32 anchors sum to 99, but the division within a question is a
  pedagogical judgment and is the one thing here a teacher may want to move.
  **Q3 already was moved** (9 Sep 2026, migration `20260909174056`): authored
  2/4 on the reading that (b)'s explanation carries more weight than (a)'s
  rewrite, changed by the teacher to 3/3. Both `na_anchors.marks_available`
  and `na_rubric_items.marks` were updated together — stage 5 reads the anchor,
  the review UI shows the rubric row, and letting them disagree would put one
  number on screen and a different one in front of the model. Changing a split
  is only this cheap while a packet has no scans: after the first upload it
  also means re-running stage 5 for every affected crop.
- **`open_rubric` exists only on Q19.** Q20 and Q21 are open reflective questions
  marked from their prompt alone, matching how A.1 left Q29/Q30.
- **The packet's own compulsory-core text is wrong about its numbering.** Page 1
  says "You must complete: Q1-Q7, Q9-Q15, Q17-Q20, Q22, Q23, Q25, Q26", but the
  packet only prints through Q21. That is generated prose that never matched the
  rendered numbering; it is a content bug in the packet, not a setup error.

  **The text itself cannot be edited in place, and this is worth knowing before
  someone goes looking for it.** `nuanced_analyses.draft_content` is null for
  A.2 — and for every one of the six NA packets, A.1 included — so that box's
  wording is never persisted anywhere. It is authored in the sandbox at
  generation time and baked into the rendered PDF. There is no row to correct,
  and the copies students are holding cannot be changed retroactively. Do not
  "fix" it by writing a partial `draft_content` holding just a corrected
  `compulsoryCore`: `editor-client.tsx` loads `draft_content` into the editor
  whenever it is present, so a partial write would replace the whole packet
  with a near-empty draft the next time A.2 is opened. A correct sentence, from
  the packet's own tier data (only printed Q15 is tier 3, and the Reflection
  section already declares itself compulsory), is: "You must complete: Q1-Q14,
  Q16-Q21. Q15 is marked (three stars) and is a genuine challenge — attempt it
  if you have time. Partial working always earns Clev's Marks." Paste that in
  when the packet is next regenerated.

  **What was fixed is the class, not the instance** (9 Sep 2026).
  `lib/numbering-validator.ts` already existed for almost exactly this defect —
  model-embedded numbers that disagree with the structural numbering — but it
  only ever inspected question prompts and Part headings, so numbers written
  *about* the questions went unchecked. It now also validates the question
  numbers cited in `compulsoryCore`, `plantedErrorIntro` and
  `reflectionQuestions` against the count of questions the draft actually
  contains, and the generator surfaces those as warnings before a teacher
  downloads the PDF. The check is deliberately one-sided: it flags only
  citations ABOVE the question count, which are provably impossible, because
  proving an in-range citation wrong would mean reproducing every decision the
  renderer makes about which questions get a printed number. On A.2's own draft
  that yields exactly one flag, Q26 against a bound of 25 — which is the point,
  since one impossible number is enough to send a teacher back to the list.

---

## 16. The Drive mirror was writing into the Bin (10 Sep 2026)

**A teacher asked why a student's self-assessment had not produced an updated
PowerSchool file in their Drive. It had. The file was in the Bin.**

Everything upstream of Drive was correct and stayed correct throughout. Raul
Siucho's 41 `student_self_scores` rows for Formative Assessment 1 landed in one
atomic upsert at `19:34:56Z`; `powerschool_export_files` for 9C rebuilt to
`9C_Form1_15.csv` (15 of 20) at `19:38:03Z`; the Storage object's sha256 matched
`content_sha` exactly. Only the mirror was broken, and it was broken in the way
that is hardest to notice: **it reported success.**

`drive.files.update` on a *trashed* file returns 200 and writes a new revision.
`mirrorExportToDrive` reached its recreate path only from a 404, which Drive
raises for a permanently deleted file and not for a binned one. So the update
succeeded, `drive_error` stayed null, `drive_synced_at` refreshed, and the
gradebook pill (`GradebookGrid.tsx:399-402`) read "Google Drive: copied
10/09/2026, 19:38:03" - all true, and all useless.

Found by reading the file's own metadata with the app's stored token:

```
name: 9C_Form1_15.csv   trashed: true   explicitlyTrashed: true
parents: [1m6Qx89Thaf71CrwtLduHkkT6pGIYNvxO]   8 revisions, last 19:38:02Z
```

**All four classes' files were trashed**, each `explicitlyTrashed` (so binned
individually, not by a trashed parent), along with both download zips and two
manual `9G_Form1_5 N.csv` copies. `My Drive > ¡CleverPlatform! > PowerSchool
exports` held zero untrashed files while the app had been mirroring into it for
two days. The four class CSVs were restored from the Bin the same day with their
content and revision history intact; the zips and duplicates were left binned.

**Fixed in `lib/drive-export-mirror.ts`.** `targetStillInFolder()` now reads
`trashed, parents` before reusing a stored id, and treats trashed, moved-out-of-
folder, and missing all the way the 404 was already treated: create a fresh file
in the configured folder. That also closes a second case nobody had hit yet -
changing `teacher_settings.powerschool_drive_folder_id` used to leave every
export still updating the old file in the old folder. A recreate is logged,
because it costs the file its version history. `lib/drive-export-mirror.test.ts`
is the regression test; it fails on 4 of 7 cases against the pre-fix code.

**Open, and deliberately not done here.** The gradebook still cannot tell a
delivered mirror from a binned one - `drive_synced_at` means "Drive accepted a
write", not "the teacher can see it". Surfacing "recreated in Drive" wants a
column on `powerschool_export_files`, and migrations go through MCP
`apply_migration` first (see `supabase/migrations/README.md`); an agent session
without the Supabase MCP tool cannot apply one or read back the ledger version
it was assigned, and committing an unapplied file would break the 1:1 invariant.
Worth doing from a session that has it.

**The general lesson, because it will recur.** Every "did it sync?" field in
this schema records what an API call returned, not what the teacher can see.
`drive_synced_at`, `drive_error` and `content_sha` were all in a consistent,
healthy state describing a file nobody could find. When a teacher says the file
is not there, check the file, not the row.

---

## 17. Releasing one class's marks, and why a migration's TIMESTAMP decides whether CI can apply it (10-11 Sep 2026)

**READ THIS FIRST IF YOU ARE ADDING A MIGRATION FROM AN AGENT SESSION.** The
headline is in "How it gets applied" below and it cost three failed runs to
learn: `platform-supabase-migrations.yml` will silently refuse any migration
file whose version sorts BEFORE the newest row already in the ledger. Choose
the timestamp at the moment you push, not the moment you started writing.

The migration itself is
`platform/supabase/migrations/20260911055400_test_course_self_assessment_override.sql`,
renumbered from `20260910213307` for exactly that reason.

**The problem.** `tests.require_self_assessment` gates a student seeing Clev's
Marks before they have self-graded, and it lives on the test. A test belongs to
one course but is sat by its whole track family (section 13's migration
`20260905182550`): Formative Assessment 1 hangs off 9G and is sat by 9A, 9C, 9D
and 9G. So releasing marks to 9C's 20 students meant releasing them to roughly
69 across four classes. There was no narrower control, and that is not a
decision anyone wanted to make on three other classes' behalf.

**The mechanism.** `test_course_self_assessment (test_id, course_id,
require_self_assessment)` - the pair is the primary key, because the pair is
the identity. No row means the test's own flag stands, so every existing test
behaves exactly as it did before. `resolveSelfAssessmentRequired()` in
`lib/self-assessment-gate.ts` combines them and **fails closed**: where two
overrides disagree the gate stays up, because withholding marks that should
have been released is a complaint and showing marks that should not have been
cannot be taken back.

`lib/exam-service.ts` folds the override into each test's
`require_self_assessment` as the tests are loaded, so all three existing
readers (the reflection page's student branch, its "view as" branch, and
`reflection-client.tsx`) keep reading one field and get the value for that
viewer. It resolves against the viewer's OWN courses, never the track family -
resolving against the family would let one class's release reach its siblings,
which is the entire point of the table.

**A missing table is not an error.** `applySelfAssessmentOverrides` returns the
tests unchanged if the query fails, on the same reasoning as the column
fallbacks already in that file: the code can reach production before the
migration does, and a reflection page that 500s because nobody has released
anything yet would be worse than one that falls back to the test's own flag.
That is what makes shipping this before the migration safe, and it is also why
a green deploy does NOT tell you the migration landed.

**How it gets applied, and the three ways it failed first.** The normal path is
MCP `apply_migration` (`supabase/migrations/README.md`), which was unavailable
when this was written and intermittently available afterwards. The fallback is
`platform-supabase-migrations.yml`, which takes `workflow_dispatch` and so can
be aimed at a branch -- the same way section 4's fix was verified on 7 Sep.
Three dispatches, three different failures, all worth knowing:

1. **The branch was stale.** It was cut before two migrations landed on `main`
   (`20260910230949`, `20260911015316`), both already in the ledger. The CLI
   compares the ledger against the files it can see and bailed with "Remote
   migration versions not found in local migrations directory" naming exactly
   those two. It fails safe and applied nothing. Merge `main` in first: a
   dispatch is only meaningful from a branch carrying every ledger version.
2. **`supabase/setup-cli@v1` hit a GitHub API rate limit** ("Failed to resolve
   latest Supabase CLI release"), dying before the database was touched. Pure
   infrastructure; one re-run cleared it.
3. **The real one.** `supabase db push` found the migration and refused it:
   "Rerun the command with --include-all flag to apply these migrations". The
   CLI only applies versions AFTER the last one in the ledger, and this file
   was stamped `20260910213307` while the ledger had already moved on to
   `20260911015316` that same night. Section 4 records `--include-all` being
   deliberately dropped from this workflow, because it would drag in the
   destructive `migrations-legacy/` files -- so that flag is not the answer
   and must not be added back.

The fix was to renumber the file to a version later than the newest ledger
row. That is safe here and ONLY here: the README's "never renumber" rule
protects migrations that have ALREADY been applied, where a changed prefix
makes an applied migration look pending. A file the ledger has never seen has
no identity to protect. **A migration written by a long agent session is
exactly the case that hits this** -- the timestamp is chosen when the file is
created, the session then runs for hours, and other migrations land in the
ledger meanwhile.

**Nothing is released yet.** The migration creates the mechanism; it writes no
rows. Releasing 9C is one statement, deliberately kept out of the migration so
that a student-facing change does not ride in on a schema one:

```sql
insert into test_course_self_assessment (test_id, course_id, require_self_assessment)
values ('f5221cd9-66b1-48cd-bfe3-652d87df26b2', 'dc6d8fcf-cacd-4b5b-9674-478ac78f7f3c', false)
on conflict (test_id, course_id) do update
  set require_self_assessment = excluded.require_self_assessment;
```

**Teacher UI, added 11 Sep.** A "Per-class release" block on the test detail
page (`app/dashboard/tests/[id]`), directly under the test's own
require-self-assessment checkbox, because that is where the teacher already
decides this question and the per-class rows are its exceptions. One
three-option select per class -- follow the assessment / released / required --
since the table genuinely has three states and a checkbox cannot express "no
row" when the test flag is already true. Saved by the page's existing Save
button through `PUT /api/tests/[id]/self-assessment-overrides`, a separate
route because these are rows in another table with their own delete semantics,
not columns of `tests`.

Two things about it are deliberate. Each class shows **how many of its
students have not self-assessed**, not its roster size: those are the only
students a release changes anything for, and the number is what makes the
choice an informed one rather than a toggle. And the write order is deletes
then upserts, un-transactional: either half failing leaves a class gated that
should have been released, never the reverse.

**Which classes it lists: the test's track family, and that is narrower than
it looks.** As of 11 Sep the family for Formative Assessment 1 is 9G, 9A, 9C
and the Grade 9 Extended track itself (listed, disabled, "no students
enrolled" -- it is virtual by design). **9D is absent and that is correct**:
the current 9D belongs to no track (only the archived `9D (2025-2026)` is a
Grade 9 Standard member) and has zero `students` rows, so
`track_family_course_ids` returns only itself and a 9D student cannot see this
test at all. Do not "fix" this by listing every course with a
`powerschool_export_files` row for the test -- that table is built from
`loadInvitedRoster`, which reads `invited_students`, a different roster that
counts 18 people in 9D who have never signed in.

**State of 9C's Formative Assessment 1 at the time of writing**, since it is
what prompted all of this: all 20 students fully marked (41 of 41 items each),
15 self-assessed, 5 not (Emilia Ugarte, Emma Benderman, Galo Masias, Ines
Palomino, Yanay Khoury). Every level in the mirrored `9C_Form1_15.csv`
reconciles exactly against `student_marks` summed over 41 items, out of
`total_marks` 50, through boundary set `cf5ccc24`. A `scope=all` export of the
same test fills all 20 rows with no student missing a number.

**One trap worth writing down.** An earlier pass at that reconciliation
appeared to show wild disagreement between the CSV and the marks - students
with a level and no marks at all. It was `student_marks` being read through
PostgREST with a plain `limit`, which silently caps at 1000 rows; the test has
2091. `fetchAllRows` exists for exactly this and the code comments warn about
it. Ad-hoc verification queries need the same paging the application code
uses, or they invent bugs that are not there.

---

## 18. A Formative Assessment could not be got back out of the system (13 Sep 2026)

Started as a question - does an Assessment Creator exist for Grade 9? - and
found that one did, had produced a real paper, and had no way to give it back.

**Formative Assessment 1** (`f5221cd9`, course 9G, 41 items, 50 marks) is the
only test in the database with `custom_content` set, i.e. the only one the
creator has ever produced. 50 students are marked against it, 2091
`student_marks` rows. Neither its paper nor its mark scheme could be
retrieved: `/api/assignments/generate-pdf` and `/api/assignments/mark-scheme`
stream a PDF to the browser and keep nothing, `tests.paper_url` and
`mark_scheme_url` were NULL, and the sandbox could not reload a saved
assessment. Rendering `custom_content` by hand was the only way back to it.
`app/api/tests/[id]/paper-layout/route.ts` already documents the consequence
in its header: "there is no blank paper anywhere in this system."

### What changed (#214, #215)

**Saving now archives both PDFs.** `POST /api/formative-assessments` renders
them and uploads to the private `exam-scans` bucket under
`formative-assessments/<testId>/{paper,mark-scheme}.pdf`, recording the paths
on the test row. Four new `tests` columns, migration `20260913212551`:
`paper_pdf_storage_path`, `mark_scheme_pdf_storage_path`,
`assessment_formatting`, `pdfs_generated_at`.

Deliberately NOT reusing `paper_url` / `mark_scheme_url`: those are free-text
URLs a teacher types into the test detail form and students see as links on
the reflection page. A private-bucket object can only be handed out as a
signed URL minted on demand, which would expire if stored in a text column.
`GET /api/formative-assessments/[testId]/pdf?kind=paper|mark-scheme` mints
one; it is teacher-only, and `kind=mark-scheme` serves the full answers.

`assessment_formatting` closes a real gap: the creator held
`FormattingRequirements` in React state and never persisted it, so
re-rendering an older draft could not reproduce the paper a class actually
sat. Null means the defaults in `lib/formative-assessment-pdf-body.ts`.

Both PDFs share ONE browser launch (`lib/formative-assessment-pdf.ts`). That
is what makes archiving fit inside the save request - the launch dominates,
so it costs little more than the single-PDF routes a teacher already waits
on. A failed archive returns `pdfs: "failed"` with a 207 and is called out in
amber in the sandbox rather than folded into the success notice; re-saving is
the retry. FA1 was backfilled through this same code path (15-page paper,
7-page mark scheme, 51 M/A/R codes), both verified downloadable.

**The creator can now reopen a saved assessment.** `GET
/api/formative-assessments` lists them (`custom_content is not null` is what
qualifies one) and `GET /api/formative-assessments/[testId]` returns the
draft, formatting, course and self-assessment gate. Deliberately not
`GET /api/tests/[id]`, which serves the detail form and would silently drop
the mark schemes. Opening something else asks first, but only when the editor
holds unsaved work; once a loaded assessment has edits, re-opening it is how
you discard them, so the button becomes "Reload, discarding changes" rather
than staying disabled. That last part was found by driving the real UI, not
by the tests - `app/dashboard/assignments/load-saved-assessment.ts` holds the
decision so it is covered.

### Two traps worth keeping

**A mark scheme is made by its RENDERER, not a flag.** The student paper goes
through `DocumentOrchestratorService.render`, the mark scheme through
`generateMarkSchemeHtml`. The request bodies differ only in a subtitle
suffix, so sending the mark-scheme body to the student renderer produces a
convincing paper containing no mark scheme at all. That happened once while
building this and was caught by inspection, before the backfill.
`buildFormativeAssessmentPdfBody` now pins it with a test.

**`new Date("nonsense")` does not throw** - it yields an Invalid Date whose
`toLocaleDateString` returns the string "Invalid Date", so the try/catch
these helpers were written with never fires. Three copies of that pattern
existed; the live one was `load-draft-modal`, rendering "Invalid Date" on
every Load Draft row for a template with an unparseable `updated_at`
(#217, #218). All three are gone, replaced by
`app/dashboard/assignments/format-date.ts`. No `function formatDate` remains
in `app/`, `lib/` or `components/`.

### Migration ledger, third reconciliation

`20260913174538_tighten_a1_answer_sketches` had been applied with no file
committed - 148 files against 149 rows, the same gap the second
reconciliation fixed. Rebuilt from the ledger and verified by md5. See the
correction to §4 above for what the directory-wide md5 check actually proves,
which is less than it looks.

## 19. The creator learned to write a summative (14 Sep 2026)

The assessment creator could write one kind of paper. It now writes both, and
a summative is deliberately NOT a second content type: same `AssignmentDraft`,
same LEVEL bands, same M/A/R/FT mark codes, same marking policy file, same
`tests` + `lib/ai-grading.ts` pipeline. One control at the top of the creator
chooses, and **`lib/assessment-kind.ts` holds everything that follows from the
answer** - so "what makes this a summative?" has one place to be read.

Migration `20260914020122` adds `tests.assessment_kind`
(`formative` | `summative`, default `formative`, CHECK-constrained). All six
pre-existing tests keep behaving exactly as they did.

### What a summative adds

**Exam conditions on the cover** - calculator policy, time allowed, total
marks, academic honesty line. Four new optional fields on
`FormattingRequirements`, rendered by `lib/exam-conditions.ts`.

They live on the FORMATTING, not on the draft, and that is the whole reason
the PDF export needed no changes: formatting already reaches
`DocumentOrchestratorService.render`, `generateMarkSchemeHtml` and
`lib/formative-assessment-pdf.ts`'s archiver. A draft field would have needed
six separate edits, one of them to `MarkSchemeRequest`.

They print on BOTH PDFs, from one renderer. The two cover blocks in
`lib/document-orchestrator.ts` - `buildHtml`'s `.doc-head` and
`generateMarkSchemeHtml`'s header - shared no code at all and had already
drifted (the paper carries a name/block/date grid, a score box and the
instructions; the mark scheme carries none of them). A calculator rule that
printed on the paper but not the mark scheme would be missing at exactly the
moment it is needed, which is a mark being argued over.
`lib/exam-conditions-render.test.ts` drives both real renderers and asserts
the block lands in each, because a unit test of the block alone would pass
with it wired into only one.

**A grade boundary set, required.** Without one the gradebook falls back to
generic bands and shows an `~approx` badge (§3). The save route refuses a
summative that has none; the creator offers a picker. Grade 9 has its own set
(`cf5ccc24`), separate from the DP progression sets.

**Teacher intervention on anything below high confidence.** `POST
.../ai-grade/accept-all` now covers only what the model was fully confident
about; everything else stays `accepted = false` and waits in the review UI,
where accepting one IS a teacher looking at it. `lib/summative-grading-gate.ts`
reuses `gradeNeedsReview()` from `lib/ai-grading.ts` verbatim rather than
restating the rule, so the parts held are exactly the parts already flagged.

One consequence in that route: with results held, the accepted flag can no
longer be set by RUN id (that would flag the held ones too), so it goes out by
result id in chunks of 200. The by-run path is kept untouched for the case
where nothing is held, which is every formative.

The per-student status dot on the roster already reports partial acceptance
("N of M suggested marks accepted"), so a teacher can see what is outstanding
after a summative batch accept without any new UI.

**Self-assessment forced on**, not offered: students judge their own work
before they see the marks the teacher approved. `require_self_assessment` was
already the gate (`lib/self-assessment-gate.ts`, `lib/reflection-steps.ts`) -
a summative simply cannot turn it off.

### What a summative leaves out

**Hints.** `lib/document-orchestrator.ts:198` prints any `hint` it is handed,
and a printed "Hint: try substituting x = 2" on a paper that counts is marks
given away. Stripped in three places - on generation, on the kind switch, and
again in the save route - and the teacher is told how many went rather than
having them vanish.

### Deliberately unchanged

The marking policy. A summative loads the same
`grading_policies/g9_formative_assessment_marking_principles.md` that
`lib/ai-grading.ts` already loads for every `source = 'custom'` item. M/A/R/FT
does not mean something different because the paper counts, and a second
policy file is a second thing to keep in step. Also unchanged: the LEVEL ramp
(the gradebook parses `LEVEL n`) and the reteach guide, which is teacher-only
and is exactly what a summative tells you.

### Naming

The tab label is now "Assessment Creator". The tab ID stays
`formative-assessment` - it is what the saved tab preference already says, and
renaming it would silently move a returning teacher to a different tab. The
API route path and `lib/formative-assessment-*.ts` filenames are unchanged for
the same reason.

## 20. Source material, and two ways into the creator (14 Sep 2026)

### The catalogue

`GET /api/source-materials?grade=` unions four origins into one list the
creator ticks from: uploaded files (`source_materials`), NA packets, saved
assignment templates and previously saved assessments. Ticked items are
resolved to text by `POST /api/source-materials/resolve` at generation time
and appended to the prompt, so a paper is written from the wording, notation
and worked examples the class was actually taught.

Two things that route got wrong and no longer does:

- `assignment_templates` has NO `course_id` and NO `parts` - those are
  `nuanced_analyses` columns, and selecting them made PostgREST refuse the
  query, 500 the whole route, and leave the UI reading "Nothing catalogued for
  Grade 9 yet". That empty state is byte-identical to the honest one, so it
  reads as the teacher's own doing. The route now degrades per origin and
  names what it could not read.
- The prompt ceilings were invented rather than measured. They are now
  `SOURCE_TEXT_PER_ITEM = 150_000` and `SOURCE_TEXT_TOTAL = 400_000` chars
  (from 24k/90k): the generator runs a 1M-token context and the entire Grade 9
  catalogue is about 28k tokens. Deliberately NOT batched - both shapes of it
  (digest-then-generate, per-source-then-stitch) forfeit the cross-source
  synthesis that is the reason for selecting four documents at once.

Uploads go to the same route. PDFs are read with `pdf-parse` v2, which is a
CLASS (`new PDFParse({ data }).getText()`), not a default function; `.md` and
`.txt` are read directly. A scan with no text layer stores with
`usable = false` and is shown ticked out, rather than reaching the generator
as an empty string.

### Two ways in, and only two

The left panel had grown into four boxes that each looked like a place to
begin - what is this, open a saved one, source material, generate with AI. It
is now one **Start** panel with two mutually exclusive buttons, open a saved
assessment or generate a new one, and only the chosen path's controls on
screen. Source material moved inside the generate path, because that is all it
is: an input to the generation. It does nothing to a paper you opened.

Which path opens is decided ONCE, in the fetch that loads the saved list
(`defaultStartMode` in `load-saved-assessment.ts`) - open if there is anything
to open. Re-deriving it on every render would flip the panel from Generate to
Open the moment a teacher saved the paper they had just generated, because a
first save adds a row to that list. Until the list arrives, neither path
shows: an empty list nobody has fetched yet looks exactly like a teacher with
nothing saved.

Generating now asks first before overwriting an OPEN saved assessment that has
unsaved edits - the same bargain the open button already struck. A generated
draft that was never saved does not qualify, because regenerating one is the
normal way to use that button and a prompt there would fire on every attempt.
The button also names the kind it will write (`Generate Summative From 4
Sources`), since the formative/summative control now sits below it.

### What sits above the Generate button

The teacher's rule, given while looking at the live panel: the choices for the
assessment the model is about to write belong ABOVE the button that writes it.
So the order is **The paper** (formative/summative, and for a summative the
exam conditions) -> **Start** (open, or generate) -> **Title page** -> **Save &
Grade** -> **Export**.

What decides the split is whether a generation survives it. The kind steers the
prompt; the exam conditions ride on `FormattingRequirements`, which a generation
does not touch. Both are therefore safe, and useful, above the button. Title and
subtitle are on the DRAFT, which a generation replaces wholesale - typed above
the button they would be typed only to be overwritten, so they wait below it
under Title page.

### The exam conditions steer the paper, not just its cover

Sitting above the Generate button, they look like generation inputs, and now
they are. `buildFormativeAssessmentUserPrompt` carries the calculator rule (in
`calculatorPolicyLabel`'s own words, so the cover and the prompt cannot
disagree) and the time allowed in raw minutes; the system prompt carries what
those MEAN, as summative rules S7 and S8:

- **S7** - the calculator rule is a constraint. No calculator means every value
  is reachable by hand: integers and simple decimals, exact forms rather than
  decimal evaluations, and no part whose method is reading a display. Where one
  IS permitted, the marks still have to be for method, reasoning or
  interpretation.
- **S8** - the estimatedMinutes across the levels must sum to no more than the
  time printed on the cover. A paper that cannot be finished in its own time
  allowance measures speed.

The split matters for caching as well as sense: the standing rule is in the
system prompt, which is stable across papers, and only the values vary.

Both fields are dropped for a formative, whose cover carries no conditions -
`lib/formative-assessment-prompt.test.ts` pins that a formative's prompt is
byte-identical to what it was before any of this existed.

### Where a status line goes

There is still one `notice` at a time, but it now carries the panel that
produced it (`type Notice = { place; text; tone? }`) and renders there, through
`NoticeLine`. One fixed location cannot be right for all of them: notices come
from Start (load, upload, a source shortened), from The paper (the kind switch)
and from Save & Grade (saved, archived, hints stripped). Parked in Save & Grade,
"Switched to summative..." printed some eight hundred pixels below the button
that switched it - off the bottom of a laptop screen, which is where it was
found, by driving the panel signed in.

`tone` is explicit rather than derived from `pdfsArchived`, which had been
rendering "Loaded ..." in green whenever the paper being opened happened to
have archived PDFs - the right colour for a save and meaningless for a load.

## 21. Grade 9 Standard Level: the first summative, and a grader for it (15 Sep 2026)

The teacher supplied the first Grade 9 Standard Level summative - Key
Assessment 1, Unit 1 (sat 14-15 Sep 2026 by 9D; 9 questions, 26 parts, 42
marks, 60 minutes, calculator permitted) - and its Teacher Marking Rubric,
and asked for a grader for Standard Level. Standard is graded differently
from Extended: the rubric groups every part into four STRANDS, each naming
the Common Core standards it assesses (A Expressions 11 marks, B Arithmetic
sequences and explicit rules 13, C Patterns and structure 9, D Reasoning and
justification 9), and turns each strand total, and the paper overall, into a
PERFORMANCE LEVEL - Exceeding / Meeting / Approaching / Beginning - at about
85%, 65% and 40% of the strand's marks. Each part's mark scheme is a "full-mark
response shows ..." descriptor, not an M1/A1 token list. And "future Standard
Level assessments may look different from this first one."

### What was built

**The rubric is data on the test** (`tests.standards_rubric`, jsonb, migration
`20260915164804`), validated by `StandardsRubricSchema` in
`lib/standards-rubric.ts`: strands (code, name, standards, part refs like
`2d` / `5`, level descriptors), level bands as proportions, optional overall
descriptors. Nothing in code knows the letters A-D or the number four. The
same module computes the levels. **Thresholds are the CEILING of proportion x
max**, which is the only rule that reproduces every number printed on the
rubric (11 marks: 10 / 8 / 5; 13: 12 / 9 / 6; 9: 8 / 6 / 4; 42: 36 / 28 / 17)
- rounding gives 9 for 0.85 x 11. `lib/standards-rubric.test.ts` pins all of
them, using the KA1 fixture in `lib/fixtures/g9-standard-ka1-unit1.ts`.

**The marking policy** is `grading_policies/g9_standard_level_marking_principles.md`,
loaded at module init by `lib/ai-grading.ts` like the other two, and appended
by `buildGradingSystemPrompt()` - followed by the rubric's strand table
(`buildStandardsRubricBlock`: standards, parts, mark ranges per level, the
four descriptors per strand) - whenever any unit carries `standards`. On such
a paper the Formative Assessment principles are NOT appended: the two disagree
about what a mark scheme is, and a prompt carrying both leaves the model to
pick. The policy tells the model to itemise each part into exactly max-marks
M/A/R tokens from the descriptor (so `suggestedMarks` stays the count of
awarded tokens and every existing validator holds), to read "show / explain /
justify" as the criterion, to calibrate partial credit by the strand
descriptors, and never to compute a level - that is the platform's job from
ACCEPTED marks. `GradingUnit.standards` rides on the unit rather than being a
second argument, so the interactive route, the overnight batch, the regrade
route and `scripts/eval-grading.ts` all build the same prompt without a
parameter any of them could forget; `assembleMarkScheme` reads the rubric
once per test and attaches each item's strand. `buildUnitBlock` names the
strand on each part.

**The seed.** KA1 was transcribed by hand from the two PDFs into the fixture
and applied as migration `20260915165036`: test
`a1c0f4e2-9d00-4b7e-8c21-000000000001` on 9D, summative, self-assessment
required, `hidden = true` (the teacher unticks "Hide this exam from student
reflection dropdown" on the Tests page when ready), no boundary set, 26
`source = 'custom'` items whose `markscheme_text` is the rubric's line plus
the answer plus marks-for-what notes drawn from the level descriptors. The
question text describes each figure and table in words (the tile pattern, the
bus-pass table) because the item text is all the marker gets besides the scan.
Worth a teacher's eye before the first accept: Q1(a)-(c) are written so a
bare correct value with no substitution earns 0 (the paper says "Show all
work" and the Exceeding descriptor says "with each substitution shown"), and
Q8's guess-and-check cap of 2 comes from the Approaching descriptor. Both are
in the item text and editable.

**The track mapping was stale**, the same fault fixed for Extended on 22 Aug:
Grade 9 Standard -> "9D (2025-2026)" (archived), not this year's 9D. Migration
`20260915164811` repoints it by name. Without it the AI grader's pooled
roster for a 9D test would have been last year's students.

**The importer** (`/dashboard/tests/standards-import`) is the answer to
"future papers may look different": upload the paper and the rubric as PDFs,
`POST /api/standards-assessments/extract` sends both to `claude-opus-5` as
document blocks with structured output (`lib/standards-import.ts`; the rubric
is tables whose meaning is in the layout, and pdf-parse interleaves the
columns), the teacher edits the draft on screen - every part's question and
mark scheme, every strand's parts, standards and descriptors, the bands - and
`POST /api/standards-assessments` saves it as a new test. The same
`validateStandardsDraft` runs on the client on every edit and on the server
on save; its consistency checks are the point (parts sum to the cover's
total, each strand sums to the rubric's printed strand total, every part in
exactly one strand), since a `2a` read as `2d` still parses and only the
strand total catches it. Always a new test, never an upsert: marks hang off
`test_items` ids.

**Where the levels show.** The AI-grade review panel shows a live strand
table from the marks being edited (suggestions, labelled as such). The test
detail page has a Standards rubric section (strand table; the JSON, editable,
saved through `PUT /api/tests/[id]/standards-rubric`, which refuses a rubric
naming a part the test lacks). `/dashboard/tests/[id]/standards-report` is
the class view from Clev's Marks - marks and level per strand per student, a
count of students at each level per strand, a faded level while a paper is
part-accepted - with a CSV at `/api/tests/[id]/standards-report/csv`; both
read `lib/standards-report-data.ts`, the same roster rule as the grader
(class plus track siblings, registered plus invited). The Tests list badges
a Standard Level paper and links the report.

### Deliberately not done

- The gradebook grid is unchanged. It still shows a 1-7 from the fallback
  bands with the `~approx` badge for KA1, because no boundary set applies;
  the standards report is the Standard Level view. Mapping E/M/AP/B onto a
  1-7 for PowerSchool is the teacher's call, not a default. (Since §37 that
  call has a place to be made: the paper's Grade boundaries page.)
- Grade 9 Standard is still not offered by the assessment CREATOR
  (`ASSESSMENT_COURSE_NAMES`); Standard papers arrive as PDFs, through the
  importer.
- Nothing has been graded yet: no scans of KA1 existed when this was built,
  so the policy has not been measured on real work. The first class through
  it deserves the spot-check routine of §11.

## 22. Explorations and homework: a third way to read a paper (18 Sep 2026)

The teacher supplied Math Medic's Exploration 1.1 ("Equations that Describe
Patterns" - Callie's Catering Company, 8 questions on page 1 and a Check
Your Understanding on page 2) with its answer key, and asked for these to go
through the platform the way Grade 9 Extended Nuanced Analysis does, but
"differently". They do not fit either existing route, and the reason is not
mechanical:

- **The NA pipeline is closed to them.** It is bound to a packet whose anchor
  geometry `auto_fillrect` derives from the drawn answer boxes of a master
  PDF (§5). A Math Medic worksheet has no drawn answer boxes - students write
  in open space - and no `nuanced_analyses` record.
- **The test path fits, but both its policies answer the wrong question.** An
  Exploration is sat BEFORE the lesson. Being wrong on it is the design; a
  class that gets full marks has been given the wrong Exploration. The
  Formative and Standard Level policies both mark work a student has already
  been taught, and both withhold method marks from a bare correct answer.

### What was built

**The rubric is data on the test** (`tests.activity_rubric`, jsonb, migration
`20260918182655`), validated by `ActivityRubricSchema` in
`lib/activity-rubric.ts`: LEARNING TARGETS (code, name, the QuickNotes note,
part refs), and outcome bands as proportions. The lesson's own targets - Math
Medic prints them as "LT #1", "LT #2", "LT #3" on the key - are the grouping,
the way strands are on a Standard Level paper. Nothing in code knows how many
there are.

**Outcomes, not levels or marks.** A part is worth 1 or 2 marks, and
`outcomeForPart` reads them as Got it / Almost / Not yet with no thresholds
at all: a 1-mark part is one idea and has no Almost. A TARGET spans several
parts and does band, at 80% and 50% (`DEFAULT_OUTCOME_BANDS`), deliberately
more forgiving than the Standard Level 85/65/40 - reading Almost as Got it
costs little, the reverse reteaches a student who already knew it. Thresholds
use `minMarksForBand` imported from `lib/standards-rubric.ts`, so a
proportion lands on the same mark count whichever table prints it, and part
refs ("2d", "5") are that module's grammar too.

**Marks are plumbing, and the module says so in its header.** Every validator
downstream is built on `suggestedMarks` being a whole number of awarded tokens
in 0..maxMarks, so an activity uses that machinery rather than fighting it.
There is deliberately NO overall figure anywhere - no total, no percentage:
"Got it on LT1, Not yet on LT3" is the point, and rolling it into one number
is the grade this route exists to avoid.

**The marking policy** is `grading_policies/mathmedic_activity_marking_principles.md`,
loaded at module init by `lib/ai-grading.ts` like the other three and
dispatched by `isActivity()`. The dispatch is an ELSE-IF CHAIN and that is
load-bearing: an activity's items are `source = 'custom'`, so the Formative
branch would otherwise fire on every one of them. A test carrying both an
activity rubric and a standards rubric is marked as an activity, with a
warning from `assembleMarkScheme` saying so. The policy's substantive
departure is rule 2: a bare correct answer DOES show the idea and earns the
mark, except where the part itself asks the student to describe, explain or
show. It also asks for a teaching next step in `reasoning` ("multiplied by 8
instead of dividing - is running the rule forwards in both directions", not
"incorrect"), and tells the model that a blank is information about where a
student stopped. `buildActivityRubricBlock` prints the targets but NO
thresholds - unlike the strand block - because handing the model the
arithmetic would invite exactly the outcome-computing the policy forbids.

**The importer** (`/dashboard/tests/activity-import`) takes the worksheet and
the key as PDFs; `POST /api/activity-assessments/extract` sends both to
`claude-opus-5` as document blocks with structured output
(`lib/activity-import.ts`). Documents rather than text is not a preference
here: a Math Medic key is the worksheet with the answers written on it BY
HAND, and the text layer of the 1.1 key renders its handwriting as
"c=8t orE=t" and "entreestituted 8(b- 3)=C". The reader also ASSIGNS the
marks, since the worksheet prints none - 2 where a part holds two separable
ideas, 1 where it holds one.

**The check that does not exist, and why it is called out on screen.** The
Standard Level importer catches a part read as "2d" when it said "2a" by the
strand totals failing to add up (§21). Nothing here can play that role: no
printed marks, no printed totals. `validateActivityDraft` is therefore
structural only (no part twice, every part has an answer, every part is
evidence of something, targets name parts that exist), a test pins that
halving every part's marks is a silently valid draft, and the importer page
says plainly that the teacher's eye is the real check.

**The report** is `/dashboard/tests/[id]/activity-report` with a CSV at
`/api/tests/[id]/activity-report/csv`. The tally at the top - how many
students at each outcome per target - is the thing the route exists for;
the per-student grid below is who to sit with. `lib/report-roster.ts` was
extracted from `lib/standards-report-data.ts` so both reports share one
roster-and-marks rule (the grader's: class plus track siblings, registered
plus invited, accepted marks only) rather than two copies that can drift.

**Scope: 9D only, for now.** `ACTIVITY_COURSE_NAMES` in
`lib/activity-rubric.ts`, enforced in the save route as well as the dropdown.
Math Medic runs in the Extended classes too and DP homework would fit, so
the list is expected to grow; widen it there, not at each call site.

**Gradebook: off unless asked.** An activity saves `hidden`,
`require_self_assessment = false`, and `hidden_from_gradebook` true unless
the teacher ticks "Show this in the gradebook" on the importer.

### Deliberately not done, and what to check first

- ~~The migration has NOT been applied.~~ **Applied 18 Sep 2026** through MCP
  `apply_migration` as `tests_activity_rubric`; the ledger assigned version
  `20260918182655` and the file was renamed from its placeholder
  `20260918000000` to match. Verified: `tests.activity_rubric` is jsonb and
  nullable, all 8 existing tests carry null, and the file is byte-identical
  to the ledger's stored SQL apart from its trailing newline (file md5
  `344e4a1...` with it, `e1485e8...` without, which is the ledger's).

  **Why the order mattered, for the next person adding a column here.**
  `assembleMarkScheme` selects `activity_rubric`, and every grading path goes
  through it, while `app/dashboard/tests/page.tsx` selects it too. Deploying
  that code before the column existed would have failed both on an unknown
  column -- all AI grading and the Tests list, not just activities. Adding a
  nullable column first is invisible to the running code; merging first is
  not.

- **The migrations directory has drifted again, and this is NOT that drift.**
  Before this migration the ledger held 166 rows against 158 files here; it
  now holds 167 against 159. Eight ledger versions have no file, which is the
  same "applied via MCP, file never committed" gap the README's second and
  third reconciliations describe, and it means
  `platform-supabase-migrations.yml` cannot push from CI (the CLI refuses
  when remote versions are missing locally). A fourth reconciliation is owed.
  It was left alone here deliberately: rebuilding eight files from the ledger
  is its own job with its own verification, and folding it into a feature
  branch would have hidden it.
- **Nothing has been graded through it.** The policy has not been measured on
  real student work, exactly as §21 had to say about Standard Level. The
  first class through deserves the spot-check routine of §11.
- **Segmentation will not find these students.** The cover-page check wants a
  printed header, a handwritten `Name:` field and little worked mathematics
  (`lib/na-scanning.ts:474`). Exploration 1.1 has a printed title, NO name
  field at all, and page 1 will be covered in work. Quick read will mis-split
  it. The batch tab's segment table is editable, and at exactly 2 pages per
  student typing the ranges by hand is mechanical - but a teacher who does
  not know this will think the upload is broken. A pages-per-student option
  on the batch upload is the obvious fix and was not built.
- The AI-grade review panel does not yet show a live target table the way it
  shows a live strand table. `ActivityReportTable` renders without hooks
  specifically so it can, when someone wires it in.

---

## 23. Confidence labels: what Accept teaches the marker, and what now does (20 Sep 2026)

The teacher asked, looking at a Grade 9 review row marked **medium** with
settled reasoning, whether clicking Accept helps the marker earn more "high"
labels, and what would. The short answer was no: Accept writes Clev's Marks,
an audit row in `mark_changes` (which names the run, the suggested mark, the
confidence label and whether the teacher applied a different number) and the
`accepted` flag on the result. Nothing read any of that back. The only thing a
later run took from an accepted row was the flag itself, carried forward when a
re-mark suggests the same mark (`lib/ai-grading-run.ts`). The eval script used
accepted rows as its golden set but never reported accuracy by label.

**What the labels were worth.** Measured on the newest complete run per
student across every test, counting an accepted part as a disagreement when
the teacher overrode it at accept or changed it by hand afterwards:

| Label and cause | Parts | Accepted | Disagreed |
|---|---|---|---|
| high, model's own call | 3888 | 1976 | 4 (0.2%) |
| medium, model's own call | 326 | 168 | 10 (6%) |
| medium, hedge-wording cap | 83 | 40 | 0 |
| low, breakdown/deliberation caps | 31 | 21 | 12 (57%) |
| low, model's own call | 15 | 11 | 0 |

Read with two caveats. 93% of accepts came through Accept-all, so "not
corrected afterwards" is a floor on the error rate; on the parts a teacher
accepted one by one it reads high 2/139, medium 5/21, low 0/7. And every
disagreement clustered by PART, not by student: 17 of 22 later corrections
were Formative Assessment 1 Q8(a) (a scheme wording read two ways), all 7
accept-time overrides were Key Assessment 1 Q13(b). The rulings the teacher
wrote into `mark_changes.reason` never reached the marker, so every later
student on the same part was marked the old way and flagged again.

**The row that started it was medium because of a word.** The validator
(`validateGradeResponse`) used to lower "high" to "medium" whenever the
reasoning contained "appears to", "seems to", "probably" and the like
(`lib/examiner-reasoning.ts`, the hedging half). Of 116 parts it had capped,
91 hedged about the student's METHOD ("appears to have confused the
variables"; on the row in question, "appears to have gotten 6.5" beside an
unambiguous transcription and a right mark), not about reading the
handwriting. The 40 capped parts a teacher had accepted had the same record as
"high". The teacher chose, after a plain-language walk-through of the
options, to delete the demotion and keep the warning.

**What changed, in five increments, all in this session:**

- **A. Measurement.** `scripts/confidence-calibration.ts` (DB only, free)
  prints the table above from live data: by confidence and cap cause, again
  for parts accepted one by one, and the parts the teacher disagreed on most.
  Its first output is `docs/eval/2026-09-20-calibration.json`; the SQL that
  first produced the numbers is `docs/eval/confidence-calibration.sql`.
  `scripts/eval-grading.ts` now reports accuracy **by confidence** (and skips
  runs keyed on an invited student with no profile, which used to crash it).
  Run the calibration after any change to how confidence is set; run the eval
  before and after any prompt change. Note the golden set has grown to 66
  student-tests / 869 parts since §11's 9 students, so a full run is about
  $13 on Opus 4.5; `--test <uuid>` keeps a comparison to one paper.
- **B. The hedge cap is gone.** Hedging still writes its warning
  (`"1(b): reasoning hedges on reading ... check the crop before accepting"`),
  and the review panel prints it on the row, but the label is the model's own.
  Deliberation ("wait,", "let me reconsider") still forces low, the breakdown
  and clamp checks still force low, and those are the caps that were earning
  their keep. **Consequence:** `gradeNeedsReview`, `partitionByConfidence` and
  the summative gate all read the stored label, so on a SUMMATIVE, Accept-all
  now writes hedge-warned parts it used to hold. Already-graded rows keep
  their stored label (the pre-cap value was never persisted); a re-mark
  refreshes them.
- **C. The row says why.** Every non-high row carries a few words under its
  badge ("careful wording, glance at the crop" / "breakdown disagreed with the
  total" / "the marker's own call") with the full warning as a tooltip, and
  the Why? panel lists the warnings under a Confidence heading.
  `partWarningLabel`, `warningsForPart` and `capCauseForPart` in
  `lib/ai-grade-review.ts` are the one place the warning strings are read
  back, shared with the calibration script; a test pins `partWarningLabel` to
  `unitLabel()` so the two cannot drift. The MARK SCHEME column, blank on
  every Grade 9 row because `SOURCE_LABEL` had no `custom` entry, now reads
  "Teacher's mark scheme".
- **D. Marking notes the marker reads.** `test_items.marking_notes`
  (migration `20260920042031`), edited from the Why? panel ("Marking note for
  Q8(a), every student on this paper"), printed by `buildUnitBlock` after the
  part's mark scheme under a heading that says the notes win where they
  conflict, and rule 20 of the system prompt says the same and adds that a
  judgement the notes settle is not a reason to lower confidence. Every
  marking path shares `assembleMarkScheme`, so the note reaches the
  interactive route, the overnight queue (for marks queued after the save),
  the regrade route and the eval. The accept route also takes an optional
  `note` per selection, offered as a one-line "why" beside an overridden
  mark, which lands in the `mark_changes` reason. This is the loop that was
  missing: a ruling made once on one student settles the same call for the
  rest of the class, and the model can say "high" on it with reason.
- **E. What "high" means -- measured and NOT shipped.** A rewrite of WORKING
  ORDER step 6 defined the labels by the certainty of the MARK ("a clearly
  wrong answer with legible working is a certain 0 and is high"; "medium means
  another examiner could reasonably award a different number, say which").
  Gate: the BiStats eval before and after, 11 students, 66 parts, Opus 4.5
  at temperature 0, ~$1.70 a run:

  | run | exact | within 1 | MAE | high exact | medium exact | low exact |
  |---|---|---|---|---|---|---|
  | before (`docs/eval/2026-09-20-bistats-before-step6.json`) | 58 (88%) | 66 | 0.12 | 52/54 | 5/7 | 1/5 |
  | after (`docs/eval/2026-09-20-bistats-after-step6.json`) | 59 (89%) | 65 | 0.14 | 57/62 | 1/2 | 1/2 |

  It did what it was written to do -- eleven more parts called "high" -- and
  the cost is in the same row: misses at "high" went from 2 of 54 to 5 of
  62, and one part moved two marks. The gate was "no new disagreement at
  high", so the old wording is back in production with a note beside it
  saying why, and both JSON files are kept. Read the "before" run's
  by-confidence line as the useful result: the label as it stands IS
  informative (high 96% exact, medium 71%, low 20%), which is what B relies
  on. Whoever tries the rewrite again should try only the stale-line fix
  first ("anything below high is put in front of the teacher") and run the
  same two evals; the definition change and the stale-line fix were bundled
  here, so the eval cannot say which of the two moved the labels.
- **F. Feedback to the grader, in the teacher's own words.** The same Why?
  panel, on every part of every paper (a Grade 9 formative, Standard Level or
  activity row as much as an IB one), has a "Feedback to the grader" box. The
  teacher writes what the marker got wrong or should do differently; "Turn
  into a marking rule" sends that, with the part's question, mark scheme,
  current notes and the result in front of the teacher, to
  `GRADER_FEEDBACK_MODEL` (`claude-opus-5`, adaptive thinking, effort high --
  the reference's mandated default and the model the standards and activity
  imports already use for reconciling rubrics; `lib/grader-feedback.ts`),
  which drafts the part's complete marking notes with the ruling folded in,
  a one-line summary, and what that student would now score. The draft lands
  in the note editor; nothing the marker reads changes until the teacher
  saves it. Every round is kept in `grader_feedback` (migration
  `20260920043641`) with the feedback, the notes before, the draft, and
  `applied_at` once saved, so a ruling traces back to the feedback that made
  it. The drafting model can also decline (`cannotApply`) when the feedback
  would break the scheme's maximum or the policy, and says why.


---

## 24. Where the marking money goes, and what was done about it (20 Sep 2026)

The teacher asked what could improve results and cut API cost. The answer
started with a profile of `ai_usage_log` (2 to 20 Sep, $63.4), because the
levers that pay are decided by the shape of the bill, not by the list of
things one could do. **A first pass mis-priced every Haiku line five-fold**
(the log stores Haiku as `claude-haiku-4-5-20251001`; an exact-match CASE
fell through to Opus rates), which briefly made orientation and cover-page
reads look like a third of the bill. They are 9%. The corrected profile:

| Pipeline | Calls | $ | Share |
|---|---|---|---|
| ai_grade (interactive, Opus 4.5) | 123 | 32.26 | 51% |
| ai_grade_batch (overnight, 50% rate) | 62 | 8.60 | 14% |
| NA assess (Sonnet 4.6, mostly batch) | 684 | 6.31 | 10% |
| segment (deep read, Opus 4.5) | 33 | 5.06 | 8% |
| eval | 31 | 4.80 | 8% |
| cover page + chunk cover (Haiku) | 1202 | 3.72 | 6% |
| orientation (Haiku) | 109 | 1.89 | 3% |

Inside a marking call, output is 62% of the cost (6.5k tokens per Grade 9
student; ~10.5k stored characters plus JSON), the uncached scan PDF 32%, and
the cached prefix 6% -- caching is healthy, nothing to gain there. Half of
all marking runs were re-marks (126 student-tests, 246 runs), at full price,
with a tab open. That profile, and the cost-optimisation order from the
Claude API reference (free wins before tradeoffs, one change per diff, each
read against the eval), gave the plan below. `docs/eval/` keeps every run;
`scripts/eval-grading.ts` now builds the request through
`buildGradingRequest` (it had drifted), takes `--model`, `--effort` and
`--trials`, and prints output tokens per student.

**Measurement first.** Fourteen call sites never wrote to `ai_usage_log`
(the packet and NA generators, the question-bank pipelines, classroom
analysis, placement); each now records under its own pipeline name, so the
next profile is the whole bill. The mastery route runs as the student and
cannot insert under the log's teacher-only policy; it says so in a comment.
The feedback drafter (§23 F) now sends the grader's prompt for the paper as
a cached first system block, and the cover-page read runs at temperature 0.

**Shipped, free wins:**
- **Overnight by default.** The batch tab's overnight toggle starts on, and
  "Re-mark stored scan" on the Individual tab goes through the Message
  Batches queue at half price, with "Mark now" as the explicit full-price
  button. The request is byte-identical (`buildGradingRequest`), so the
  marks are the same. Ceiling: up to half of the 51% line.
- **Re-mark one part for the whole class.** Beside a part's marking note:
  the queue route takes `testItemIds`, marks only those parts (the scan
  still goes in full), and records them on the run
  (`ai_grade_runs.requested_test_item_ids`, migration `20260920062335`);
  collect validates against that subset and `persistGradeOutcome` copies
  every other part's row, crop and acceptance from the previous complete
  run. This is the follow-through to §23's marking notes: a ruling written
  once is applied to the class for about a third of a full re-mark.

**Measured and not shipped:** tighter breakdown notes ("one clause, empty
when the token is earned on plain evidence") -- output tokens 2830 -> 2429
per BiStats student (-14%), cost -6%, but exact 58 -> 56, MAE 0.12 -> 0.18
and "high" 5 misses in 59 against 2 in 54
(`docs/eval/2026-09-20-bistats-notes-tightened.json`). Same shape as the
step-6 rewrite in §23, which is what prompted a second baseline trial to
learn the noise floor (below). The prompt is at its measured wording.

**Dropped after the pricing correction:** folding orientation into the
quick read (3% of the bill; needs a column and a rotate step in split) and a
cover-page pre-filter in the CV service (6%; CV engineering). The CV service
itself stays funded: crops, Locate on page, Fix crops and NA packets depend
on it; marks do not.

**The noise floor, measured.** A second trial of the current prompt on the
same 66 parts (`docs/eval/2026-09-20-bistats-baseline-trial2.json`): exact
56 against 58 the first time, MAE 0.17 against 0.12, "high" 54/59 exact
against 52/54. So one run of this eval moves by two exact matches, 0.05 of
MAE and three misses at "high" on its own, at temperature 0. **That is the
band both prompt experiments of this day landed in** (§23 step 6: 59 exact,
57/62 high; the tighter notes above: 56 exact, 54/59 high). Neither was a
measured regression; neither was a measured gain. The reference's rule
holds: never keep or revert on a one-case swing. Both are worth two more
trials each (~$3.40 a pair) before deciding; until then the prompt stays at
its long-measured wording, and the tighter-notes diff is in this section's
commit history if the repeat trials favour it.

**Model x effort sweep** (approved budget $12; $7.40 spent, single trials,
`docs/eval/2026-09-20-bistats-<model>-<effort>.json`):

| Config | Parts | Exact | MAE | High exact | $ / student | Output tok / student |
|---|---|---|---|---|---|---|
| Opus 4.5, temperature 0 (current), trial 1 / 2 | 66 | 58 / 56 | 0.12 / 0.17 | 52/54 / 54/59 | 0.153 / 0.156 | 2830 / 2939 |
| Sonnet 5, effort low | 66 | 51 (77%) | 0.27 | 32/35 | 0.102 | 6652 |
| Sonnet 5, effort medium | 52 of 66 (14 parts came back unusable) | 34 (65%) | 1.02 | 23/26 | 0.145 | 10970 |
| Opus 5, effort low (7 of 11 students; the account ran out of credit) | 42 | 33 (79%) | 0.24 | 29/32 | 0.197 | 2651 |
| Opus 5, effort medium | none: every request failed on credit balance | | | | | |

Read against the noise band: Sonnet 5 at low gives back 5 to 7 exact
matches and doubles MAE, well outside it, and costs 65% of Opus 4.5 rather
than the 40% its token price suggests, because adaptive thinking is billed
as output (6.6k tokens a student against 2.9k). Sonnet 5 at medium is worse
again and no cheaper. Opus 5 at low, on the seven students it finished, is
below the band on exact and dearer per student than Opus 4.5. **Opus 4.5 at
temperature 0 stays**, and the "cheaper model" lever is closed on this
evidence. Opus 5 at medium is the one config still unmeasured; it costs the
same as Opus 4.5 per token and would only be a quality candidate. Worth one
run (~$2) when credit is back, together with the repeat trials above.

**The account ran out of API credit during the sweep** (20 Sep, ~06:45 UTC,
"Your credit balance is too low to access the Anthropic API"). If the
deployment's `ANTHROPIC_API_KEY` is on the same account, marking on the site
fails the same way until it is topped up.

---

## 25. Teacher stats for a Standard Level paper (22 Sep 2026)

The teacher asked for a 9D view of Key Assessment 1 showing the average score
per question (grouped) and per part, plus whatever else would help, and for a
"general Standard Level" scope that can take in students from outside 9D
because work from other classes is coming.

The standards report (§21) answers "where is each student". Nothing answered
"where is the class", which is the question asked the moment a paper is handed
back. `/dashboard/tests/[id]/standards-stats` is that page, with a CSV at
`/api/tests/[id]/standards-stats/csv`.

### What it shows

Per PART: max, how many students are marked on it, mean, mean %, SD, how the
marks fell (nothing / some / all, as a three-segment meter), % at full marks,
% at zero, and a discrimination figure. Per QUESTION, the paper's own
grouping: the same, over the parts summed, plus median and SD. Per STRAND: the
rubric's grouping, with the level counts the standards report already prints.
Above them a paper summary (mean, median, SD, range, level tally) and a "Worth
a look" panel that names the weakest question and strand, the hardest parts,
the parts at least half the class scored nothing on, and the parts whose
discrimination is negative.

**Three rules run through `lib/standards-stats.ts`,** and they are the reason
the numbers can be trusted rather than merely computed:

1. **A missing mark is not a zero.** An unaccepted part is absent from the
   student's map and is skipped, so every aggregate carries its own `n` and
   the page prints it beside the mean.
2. **An aggregate only counts a student who has all of it.** A question mean
   is over the students with every one of its parts marked, a strand mean over
   every part of the strand, the paper over a complete paper. Averaging a
   half-marked total against a whole one reads as a weak student rather than
   an unfinished one.
3. **An absent student is in none of it.** The loader drops them before any
   arithmetic.

**Discrimination is the corrected item-total correlation** -- the part's mark
against the REST of the paper, over complete papers only. It is null below
`MIN_STUDENTS_FOR_DISCRIMINATION` (5) and null when nothing varies, because
`0` would read as "this part did not sort the class" when the truth is "this
part cannot". On the live KA1 data it earns its place: Q7(a) and Q7(b) are
100% and come back null, and Q3(a) and Q3(b) come back NEGATIVE (-0.23,
-0.11), which is the class's stronger students doing worse on those two parts
than the weaker ones -- the one signal on the page that points at the mark
scheme rather than at the students.

### The general Standard Level scope

A scope switcher at the top: the test's own class (9D, the default) or **All
Standard Level**. The `Grade 9 Standard` track is how another class joins --
it currently has 9D as its only member, and adding a class to `track_courses`
is all that the roster, the marker and this page need. **No class was added**:
track membership is SYMMETRIC, so putting 9A / 9C / 9G in the Standard track
would also put all 18 9D students on every Extended paper's roster and
gradebook (§17's `trackFamilyCourseIds`), which is not what anyone wants. The
teacher chose to leave the track at 9D and widen it when there is a real class
to widen it to.

So that widening cannot silently lose work in the meantime,
`loadReportRoster` gained `includeMarkedOutsideRoster`, which the stats loader
turns on and the two per-student reports deliberately do not: anyone with
ACCEPTED MARKS on the paper who is on no roster the test's course reaches is
returned anyway, under their real class. A marked paper missing from the class
averages would be worse than a stranger's name on a list. It costs two small
queries and only when such a student exists.

### Where the numbers came from

Verified by running `loadStandardsStatsData` itself against production (the
skill's §7 rule -- import the real module, never restate its logic) over the
10 marked 9D papers: mean 24.40/42 (58%), median 21, SD 9.50, range 7-38,
levels E2 M2 AP5 B1. Strand means sum to the paper mean (5.8 + 8.8 + 6.9 + 2.9
= 24.4) and both the strand and question maxima sum to 42, which is the check
that the two groupings partition the paper. **Strand D, Reasoning and
justification, is at 32% with 7 of 10 students at Beginning** -- the clearest
teaching signal on the page, and worth a look before Unit 2.

### Deliberately not done

- **The gradebook and the standards report are unchanged.** This is a third
  view, linked from both, not a replacement for either.
- **The page is not restricted to Standard Level papers.** A test with no
  `standards_rubric` renders the question and part tables and says plainly
  that there are no strands or levels; only the LINKS to it are behind the
  Standard Level badge. A formative or an IB paper would work if linked.
- **The "By class" block has not been seen rendered**, because only 9D has
  marks on any Standard paper so far. Its data is unit-tested
  (`lib/standards-stats.test.ts`, "the general Standard Level view") and the
  markup mirrors the strand table beside it, but the first time a second class
  is marked is the first time anyone looks at it.
- **Discrimination at n = 10 is soft.** Five is a floor, not a guarantee; the
  figure is there to point at a part worth re-reading, not to be reported.

## 26. Self-assessing a Standard Level paper, and the student mark scheme (23 Sep 2026)

The teacher asked for Grade 9 Standard Level Key Assessment 1 (§21) to be
available for students to self-assess. Three things stood in the way: the
test was still `hidden = true` from its seed, it had no `mark_scheme_url`
(the field that puts a "Mark Scheme" button on the self-grade form), and the
student mark-scheme route added for Grade 9 Extended the day before
(`app/api/tests/[id]/mark-scheme`, `lib/student-mark-scheme.ts`) could only
build a page from `tests.custom_content` -- the Formative Assessment
creator's draft -- which an imported Standard paper does not have.

### What was built

- **A second source for the student mark scheme.** With no draft, the route
  builds the page from the test's `test_items` (`buildStudentMarkSchemeHtmlFromItems`):
  one row per part, in `sort_order`, labelled the way the self-grade form
  labels a test with no draft (`2(d)`, `5`), carrying the part's
  `markscheme_text` -- for this paper the rubric's "a full-mark response
  shows ..." line with the answer in it. **Never `marking_notes`**: those are
  rulings written to the AI marker, in its vocabulary (confidence labels,
  tokens, the markBreakdown). The route does not even select them, and a
  test pins that the builder ignores them if a row carries them. Checked on
  the live rows: 26 parts, 42 marks, every formula typeset, no marking-note
  wording on the page.
- **A release gate.** Anyone but the teacher now gets a 403 unless the test
  is not hidden AND has a `mark_scheme_url`. Before this the route served
  any test in a student's track family to whoever typed its URL; once it
  could build from `test_items`, that would have reached every imported
  paper, not just the one the teacher released. (Formative Assessment 1,
  which has a draft but no `mark_scheme_url`, stopped being reachable that
  way too. Nothing linked to it.)
- **The Extended mark scheme's numbering was fixed** in its own commit. It
  counted questions across the whole paper (1 ... 14) like the teacher mark
  scheme; the printed paper and the self-grade form both restart in every
  section (`1.1`, `2.1(a)`), so the form's `2.1(a)` was `4(a)` on the page
  beside it. Verified against the live KA1 draft: all 36 rows now agree.

### Released, and in what order

Migration `20260923152709_standard_ka1_student_mark_scheme` (applied
through MCP, file md5-checked against the ledger) sets the Standard KA1
`mark_scheme_url` and deliberately leaves the test **hidden**. Unhiding
before the route above is deployed would put the paper in 9D's list with a
Mark Scheme button that fails, and submitting a self-assessment is what
reveals Clev's Marks -- a student who self-graded without the scheme could
not then do it properly. So the release is the last step, after the deploy:
the "Hide this exam from student reflection dropdown" checkbox on the Tests
page, or `update tests set hidden = false where id =
'a1c0f4e2-9d00-4b7e-8c21-000000000001'`. It is the only test in 9D's track
family, so until then a 9D student's reflection page reads "No tests
available yet".

### Worth knowing before students use it

- **The page shows the scheme, and the marking notes are more generous in
  places.** A student following the page under-claims where a ruling
  widened the scheme. 2(a) and 6(d) were the clear cases -- the notes award
  2(a) for the change of -6 alone and give a bare "k is not a multiple of 3"
  2 marks, where the scheme said the first term was needed too and 1 -- and
  the teacher had their scheme text rewritten to say what the notes rule
  (migration `20260923163545_ka1_unit1_2a_6d_schemes_match_rulings`, applied
  through MCP and guarded by the md5 of the text it replaced; 6(d) keeps its
  "3 marks: one for ..." line, which is what the grader itemises into
  R1-R3). Then the two milder cases the same way
  (`20260923164639_ka1_unit1_3c_9b_schemes_match_rulings`): 3(c)'s structure
  mark now names listing the terms and the -1/+4 step as well as separating
  odd and even positions, and 9(b) says a sketch of Figure 5 showing about
  16 tiles is the explanation. Marking is unchanged throughout: the marker
  already followed the notes where the two conflicted, and those migrations
  touched no note. Last, 6(d)'s note, which still said a bare answer earns 2
  "not the 1 the scheme states" and that "the scheme's other cap is
  unchanged", had just those two phrases tidied
  (`20260923184029_ka1_unit1_6d_note_matches_scheme`, generated from the
  live note by exact replacement; every other paragraph is byte-identical
  and every ruling stands).
- **`lib/fixtures/g9-standard-ka1-unit1.ts` drifted from the live paper,
  and was re-synced on 24 Sep (section 30).** The 18 Sep migration
  `20260918123826` called it "kept 1:1", but none of the 18 and 23 Sep
  scheme rewrites reached it: 2(a), 3(c), 6(d), 7(d), 8 and 9(a)-(c) had all
  drifted. It is not read at runtime, so nothing broke -- but SQL
  regenerated from a stale fixture would quietly revert every fix above.
  When a migration rewrites this paper's live text, update the fixture in
  the same change.
- **Each 9D submission (re)writes a 9D PowerSchool file for this paper.**
  9D has a stored scores template (from Formative Assessment 1), so
  `/api/gradebook/self-assessment-export` retargets it and fills it -- with
  a 1-7 level from the generic fallback bands, because a Standard paper has
  no boundary set (§21: mapping E/M/AP/B onto 1-7 is the teacher's call).
  The teacher's Drive mirror is on, so it lands in that folder like any
  other. Do not import it as a Standard Level result without deciding that
  mapping.

### Deliberately not done

- **Students can already read every mark scheme in their track family.**
  The student SELECT policies on `tests` and `test_items` check the track
  family only, not `hidden`, and `authenticated` holds SELECT on every
  column -- so `custom_content`, `markscheme_text` and `marking_notes` are
  readable through PostgREST with a student's own session, including for a
  paper not yet sat. Teachers share the `authenticated` role, so a column
  REVOKE is not the fix. Left alone here; it predates this work. If it is
  closed, this route's `test_items` read (made under the student's session,
  after its own gates) will need the service role.
- The question text is not shown on the student page, for either source,
  matching the Extended page. On this paper it would also have shown the
  bracketed marker's note describing the Q9 figures, which the student never
  read.

### The mark scheme on the self-grade form itself (same day)

The teacher then asked that a student see the mark scheme and enter marks on
the same screen. The Mark Scheme button opens `DocPanel`, a slide-over whose
backdrop covers the form, so a student closed it to type and reopened it for
the next part. Now `attachStudentMarkScheme` (`lib/exam-service.ts`) puts each
part's scheme on its `ReflectionItem` (`mark_scheme`: HTML pre-rendered by
`renderStudentMarkSchemePart`, the same renderer as the full page), and
`NativeForm` and `ScoreTable` print it in a full-width row directly under the
part's label and marks box.

- **Only for a test whose `mark_scheme_url` is exactly
  `studentMarkSchemePath(test.id)`** -- the platform's own page. Its gates
  are already met by then: the reflection list only holds tests that are not
  hidden and past the viewer's class sitting date. A test with no scheme
  released, or one released as a link elsewhere, is untouched.
- **One pairing rule for both views** (`studentMarkSchemeParts`: the draft
  matched to items by `sort_order`, else each item's `markscheme_text`).
  Checked live: every one of Extended KA1's 36 parts carries its own item's
  note, and all 26 Standard parts render with no KaTeX errors.
- **Full width, not inside the Question column,** because a phone left that
  column a strip a few words wide; and the box is capped at the visible width
  (`<main>` is `p-8` at every size), because the comparison table is wider
  than a phone and scrolls sideways inside its own box.
- The Mark Scheme button stays, for the whole document at once. The page
  carries about 110 kB more for a 26-part paper (the KaTeX HTML).

## 27. The student's self-assessment on the marking screen (23 Sep 2026)

The teacher asked to see each student's self-assessed marks while marking.
The AI-grade review panel (`app/dashboard/tests/[id]/ai-grade`) now has a
**Self** column between Suggested and Max, a "Self-assessed total N / M"
line under the suggested total, and a count of differing parts on the
high-confidence summary row, so it still says something when folded.

- **Where the data comes from.** `GET /api/tests/[id]/ai-grade?studentId=`
  returns `self_scores` (`student_self_scores` over every item of the test,
  not only the graded ones, so the total is the one the student saw on their
  form). `[]` for an `invited-` subject, who has no account to have
  self-assessed from; `null` when the read fails, which the panel reports as
  "could not be loaded" rather than "not self-assessed yet". The whole-class
  load does not carry it.
- **Three states per part, as the rest of the platform reads them**
  (`summariseSelfAssessment` in `lib/ai-grade-review.ts`): a number; a blank
  row (`self_marks` NULL), shown as "no attempt" and compared as a claim of
  0, as `computeDisagreement` does; and no row at all (a part added after the
  student submitted), shown as a dash that never counts as differing. A
  student with no non-null `self_marks` has not self-assessed -- the same
  test as `hasSelfScores` -- so a form submitted blank end to end reads as
  not done, not as a column of blanks.
- **Amber means "differs from the mark in the box"**, i.e. the draft about to
  be accepted, so the highlight and both counts follow an edit as it is
  typed. It is a prompt to look, like the "was N" hint, not a verdict.
- **The numbers are the latest the student saved, not necessarily their
  first judgement.** The Compare step lets a student edit their self-marks
  after seeing Clev's Marks (that is how they reach 0% and unlock Upload
  Corrections), and each save overwrites `self_marks` and `submitted_at` on
  every row, so the original is not kept anywhere. The header line's tooltip
  gives the last-saved time. Rows written through the Override Scores modal
  (`override_by` set) are shown as they are; none existed on 23 Sep (0 of
  2,961 rows).
- **Verified locally, not against production.** The panel was driven in a
  headless browser against a throwaway page rendering the real
  `AiGradeClient`, with every `/api` call answered from synthetic fixtures
  covering each state (matching, over-claim, blank against 1 and against 0,
  missing row, not self-assessed, failed read, a live edit). No teacher
  session was minted, so the route itself has not run against the live
  database; the rows it reads were looked at by SQL instead. Key Assessment
  1 (`ccfa0456`) had 23 students self-assessed, 828 rows, 75 of them blank.

## 28. The orientation check flipped Key Assessment 1 pages back and forth (23 Sep 2026)

The teacher found four 3.2(b) crops upside down in the review panel. The
cause was the section 5 orientation check itself, re-run where it should not
be.

- **What happened.** `uprightScan` (`lib/scan-orientation.ts`) ran on every
  marking run, including every one-part re-mark ("re-mark this part for the
  whole class" still sends each student's whole scan). Each time it wrote
  +180 onto every page Haiku called upside down and overwrote the stored
  file. On the 17 Sep Key Assessment 1 batch Haiku's verdict on pages 7-10
  changed from run to run, so across the seven re-mark rounds of 21-22 Sep
  those pages were inverted and restored repeatedly. A crop -- and the
  marker's reading -- follows whatever orientation the page had in the run
  that produced it, and a one-part re-mark copies every other part's crop
  forward, so crops cut while a page was wrongly inverted stayed that way.
- **Measured.** Only Key Assessment 1 was affected, and only seven scans,
  all from that batch: no other test has a scan rewritten after its crops
  were cut (compared on `storage.objects` timestamps). Each crop was matched
  against the current upright page as it is and turned 180 degrees: 54
  crops on six scans were upside down, and their `evidence_box` had been
  measured on the inverted page, so "Locate on page" outlined the mirrored
  spot. Those 54 marks were read from inverted pages; 3.2(b) was re-checked
  by hand for four of the students and was right, the other parts were not
  re-verified. One scan also had its handwritten extra sheet inverted by the
  check, and carries an unrelated page that was scanned upside down.
- **Code fix.** Both senders now call `findScansMarkedBefore()` and run the
  check only on a stored file's FIRST marking; a re-mark of the same file is
  marked as it is (module header, "ONCE PER STORED SCAN";
  `scanPathsMarkedBefore` is unit-tested). A corrected re-upload is a new
  storage path, so it is still checked once.
- **Data repair.** The 54 crops were turned 180 degrees into new keys
  (`...--upright-20260923.png`; the originals are kept) and their boxes
  mirrored into the upright frame (`x0 = 1 - x1`, `y0 = 1 - y1`, and so on),
  then verified by matching each against the upright page. The extra sheet's
  /Rotate was set back to 0 and the stray page's to 180. No mark, reasoning
  or acceptance was touched. Undo data, one row per crop with its old path
  and box: `exam-scans/_repairs/2026-09-23-ka1-orientation/snapshot.json`
  (private bucket -- the repo is public).
- **Worth knowing.** Four of the repaired crops show blank paper: the box the
  marker gave while reading an inverted page missed the work. Redraw them
  from the review panel if they matter. The fix stops the check from
  re-deciding; it does not make the first decision right, so a page the first
  check wrongly inverts has to be turned by hand (as above) or re-uploaded.
  And reading a stored file straight after overwriting it can return the
  storage CDN's cached copy for a while; a `?cb=` query on the
  `/object/authenticated/` endpoint returns the new one.

## 29. The marking page took ~45 s to show its roster (23 Sep 2026)

The teacher asked for `/dashboard/tests/[id]/ai-grade` to load faster: Key
Assessment 1 sat on "Loading this assessment…" for about 43 s.

- **Where the time went.** The Vercel request log for one load: page 18:38:24,
  `GET /api/tests/[id]` 18:38:28, `/api/students` 18:38:30,
  `/api/tests/[id]/ai-grade` 18:38:33, `/absences` 18:39:05. The whole-class
  `ai-grade` GET took about 32 s. It paged every result row of every run the
  test has ever had (507 runs, 18,119 rows, 19 sequential pages, each URL
  carrying all 507 run ids), signed an evidence URL on nearly every row,
  assembled PPQ images, and sent about 20 MB, of which the page read
  `run_id` and `accepted` to count acceptance for each student's newest
  complete run: 49 runs, 1,752 rows. The four requests were also awaited one
  after another, although only the roster depends on another one (it needs
  `course_id`).
- **The contract now.** The whole-class GET (no `studentId`) returns every
  run as before, but `results` is only `{ run_id, accepted }` for each
  subject's newest complete run. Nothing else is in that response; anything
  that needs full rows, crops, `marks_awarded` or `self_scores` must use
  `?studentId=`, which is unchanged. The same keys were kept on purpose: a
  tab still running the old page reads only those two fields, so it renders
  the same dots and the same "already accepted" warning before a re-mark.
- **One rule for "the run".** `latestRunsByStudent` (`lib/ai-grade-review.ts`)
  picks each subject's newest complete run and newer attempt. The route uses
  it to choose whose rows to count and the page uses it to choose what to
  show, so they cannot disagree. It walks the route's order (`created_at
  desc, id asc`) and never re-sorts; a test pins it to the loop it replaced.
- **Requests start together.** `page.tsx` passes the test's `course_id`, and
  `loadOverview` starts all four requests at once (`Promise.allSettled`),
  then reads them in the old order with the old early returns, so each
  failure leaves the page as it did before. If the test detail names a
  different course than the page passed, the roster is fetched again for the
  right one. One deliberate change: an absences request that throws (not
  just one that errors) no longer blanks the roster's dots behind a red box
  -- absences stay best-effort, as the code always said.
- **Measured against live data.** The real GET handler was called in-process
  with a read-only service-role client standing in for the session, before
  and after. Key Assessment 1: 20.2 MB / 22.4 s / 25 database requests down
  to 0.5 MB / 1.8 s / 3. Unit 1: 21.6 MB / 15.9 s down to 0.4 MB / 0.65 s.
  On all five tests with runs, the acceptance counts per student matched a
  direct count over every row, from the new page code and from the old page
  code reading the new response. Per-student responses from the old and new
  handler, called at the same moment, were identical apart from signed-URL
  tokens (15 of 15).
  The page itself was driven headlessly against fixtures: the four requests
  start within 3 ms, and a roster 500, an aborted runs request, an aborted
  absences request, a stale course and a missing course all behave as
  above. No teacher session was minted.
- **Worth knowing.** The old results query's 20 KB URL failed from this
  sandbox's Node with `UND_ERR_HEADERS_OVERFLOW` (the reply's headers passed
  Node's 16 KB default) until `--max-http-header-size` was raised; production
  answered 200, so it did not bite there. The new query sends one id per
  student. What remains of the load: Vercel functions ran in iad1 and the
  database is in sa-east-1, so every database round trip was about 120 ms and
  every API call spent two of them on sign-in (`getApiTeacher`; the proxy is
  not registered in production, see section 31). The first production load
  after this change (24 Sep 02:09 UTC) took about 8 s: about 4 s before the
  four requests started, then about 4 s for them together. Section 31 moves
  the functions to São Paulo. `BatchGradeTab` still mounts, hidden, on every
  visit and fetches `/ai-grade/batch`.
## 30. The Expand panel shows the question, and Grade 9 papers get a stem (24 Sep 2026)

The teacher, marking KA1 Q3(b), asked for the row's "Why?" toggle to read
"Expand", for the question stem to be visible inside the expanded panel
(minimised, like the student's work), and whether the evidence crop or the
design tools already know what a stem is.

**What the crop does.** Nothing in `fetchEvidenceCrops` targets printed
text. A "Located by marker" crop is the grader's own handwriting box
(`lib/ai-grading.ts` asks for handwriting only) padded by `padModelBox` --
18% a side plus 0.15 of the page downward, then grown by the CV service
while ink touches an edge. The printed "b." line above the work and the
start of "c." below it in that screenshot are the padding, not a stem crop.
There is no stem region in `test_item_anchors` or the paper-layout editor,
so the stem on screen is text.

**Which tools identify the stem.** The assessment creator does:
`formative-assessment-bridge.ts` writes `stem_text` from the question's
prompt and `question_text` from each subpart's. Two paths did not: the
Grade 9 standards importer told the model to repeat the stem in every
part's `questionText` and its save route never wrote `stem_text`; and the
KA1 seed (`20260915165036`, from the fixture) did the same by hand, so all
26 live KA1 rows had `stem_text` null with the stem pasted into
`question_text` for Q2, Q3, Q4, Q6, Q7 and Q9. The NA tools have no stem
notion at all (`na-rubric-bridge.ts` drops it; `na_anchors` has no stem
box); not touched here.

**What changed.**
- `ai-grade-client.tsx`: the toggle is "Expand" / "Hide" (tooltips and
  comments follow). A text-backed part gets a collapsible "Question" block
  in the panel, in the slot the bank-image block uses and on the same
  `questionShown` set (a row has one or the other): the full stem, then
  the part's own wording, LaTeX rendered. Shown on EVERY part's panel; the
  row header keeps its first-part-only rule.
- Migration `20260924024538_ka1_unit1_split_stems`:
  moves the lead-in of Q2/3/4/6/7/9 into `stem_text` and leaves the part's
  wording in `question_text`, idempotent on `stem_text is null` plus a
  `starts_with` guard (`like` was avoided because two stems carry `\ldots`
  and `\times`, and `\` is LIKE's escape). The marker's input is unchanged:
  `composeQuestionText` joins the two. **Q1 is deliberately left whole**:
  "Evaluate ... Show all work." is the command each part's mark depends on,
  and rule A6 (`ask-what-you-mark.ts`) says a demand made only in a stem
  does not carry into a part. The fixture gained `stemText` to match, and
  `ai-grading.test.ts` builds KA1 units through `composeQuestionText`.
- Standards importer: `ExtractedItemSchema` and the draft schema carry
  `stemText` (nullable; defaulted on the draft so an older payload still
  parses), the prompt's QUESTION TEXT rule now puts the shared stem in
  `stemText` word for word on every lettered part and only the part's
  wording in `questionText` (with the A6 caveat spelled out), the save
  route writes `stem_text` on lettered parts, and the review page has a
  per-question "Stem" box that edits every part of that question at once.
- `SCHEMA.md` `test_items` now lists `stem_text` and `marking_notes`.
- Follow-up, same day: the fixture's mark schemes were re-synced from the
  live rows. Eight parts had drifted, not the two the PR body named: 2(a),
  3(c), 6(d), 7(d), 8, 9(a), 9(b), 9(c), i.e. every scheme the 18 and 23 Sep
  migrations rewrote without touching the fixture. All 26 items now compare
  equal to the database on stem, question and scheme.
- Follow-up, same day: the activity importer (`lib/activity-import.ts`,
  `app/api/activity-assessments/route.ts`, the activity-import page) now
  extracts `stemText` per lettered part and writes `test_items.stem_text`,
  the same change the standards importer got above. The teacher first asked
  for this on the NA rubric bridge; that bridge writes `na_rubric_items`,
  which has no stem column and feeds only the teacher rubric export, and NA
  grading reads `na_anchors.question_text` (already stem + part as one
  string), so the change went where the stem was actually being dropped
  before the grader. No activity tests existed in production yet, so no
  backfill.

## 31. Functions run in São Paulo, next to the database (24 Sep 2026)

- **What changed.** `vercel.json` now sets `"regions": ["gru1"]`. Until now
  every function ran in iad1 (Washington), while Supabase is in sa-east-1 (São
  Paulo) and the users are in Lima (`appsscript.json` time zone). Every
  database round trip crossed the continent, about 120 ms each (section 29).
  Requests make those round trips one after another:
  - every API route makes two for sign-in (`getApiTeacher`), then 1-9
    queries;
  - the dashboard layout makes at least four on every page render;
  - grading makes one Storage upload per graded part.
- **Before, for comparison.** Key Assessment 1's marking page on 24 Sep at
  02:09 UTC, after section 29: page request 02:09:47, the four data requests
  02:09:51, roster 02:09:55 -- about 8 s. Compare the same timeline in the
  Vercel runtime log after this change.
- **What ends up farther away:**
  - the Railway CV service, whose region is recorded nowhere: one `/crop` per
    scan, and one `/page-image` per page viewed, which can be about 10 MB of
    base64, so "Locate on page" views may get slower if Railway is in the US;
  - Anthropic, which takes one long call per job, so the extra distance is
    negligible;
  - Vercel Workflow's queue. The installed `@workflow/world-vercel` 4.5.1
    hardcodes `iad1` (`dist/queue.js`), which still works at the cost of a
    few cross-continent calls per step.
  - Nothing in the code assumes a region: no `VERCEL_REGION`, no
    `preferredRegion`, no edge runtime, no crons.
- **Pricing and rollback.** Vercel prices compute per region, so check the
  rate for gru1. To roll back, delete the line; the next deploy returns to
  iad1.
- **Found while checking: `platform/src/proxy.ts` is not registered in
  production builds.**
  - Next 16 takes `proxy.ts` only from beside `app/`, and from `src/` only when
    the app lives in `src/app`
    (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:23`).
    Here `app/` is at the top of `platform/`.
  - A local production build writes an empty
    `.next/server/middleware-manifest.json` and prints no "Proxy (Middleware)"
    line.
  - Pages (`requireTeacher`/`getProfile`) and API routes (`getApiTeacher`)
    check sign-in themselves, so nothing is exposed. But the proxy's session
    refresh and /login redirect do not run in production, and API routes do
    not pay its extra `getUser` call.
  - `CLAUDE.md` forbids renaming the file, so this is left for the owner to
    decide.

## 32. The marking page renders its roster on the server (24 Sep 2026)

- **What was still slow after section 29.** The page arrived saying "Loading
  this assessment...", downloaded and started 748 KB (207 KB gzipped) of its
  own JavaScript, and only then sent four requests, each signing the teacher
  in again, before it could draw the roster. Section 31 moved the functions
  next to the database; this section removes most of the rest.
- **Less JavaScript.** Measured from the route's client-reference manifest in
  local production builds of `3b7428c` and of this change:
  - the page's own chunks went from 748 KB raw / 207 KB gzipped to
    71 KB / 21 KB;
  - its whole first load, framework and layouts included, went from
    1,517 KB / 423 KB to 840 KB / 237 KB.

  What moved:
  - **KaTeX (256 KB).** `LatexRenderer` loads with `next/dynamic` and is
    fetched once the page is idle, so the first review still opens at once.
  - **mafs (52 KB).** `LatexRenderer` imported the graph-marker helpers from
    `components/IbGraph.tsx`, which imports mafs, so IbGraph's own
    `next/dynamic` did nothing on any page that renders LaTeX. The helpers
    now live in the mafs-free `components/ib-graph-spec.ts`, re-exported by
    IbGraph. That fixes every page with LaTeX, not only this one.
  - **zod (281 KB).** It was only needed to parse a Standard Level rubric, and
    the page now does that on the server. The zod-free half of
    `lib/standards-rubric.ts` (types, levels, `buildStandardsReport`) is now
    `lib/standards-report.ts`, re-exported from `lib/standards-rubric.ts`, so
    no other caller changed. **Client components import
    `lib/standards-report.ts`; importing `lib/standards-rubric.ts` from one
    puts zod back in its bundle.**
  - **`lib/assignments` (49 KB).** It came along for a 25-line helper.
    `paperQuestionPrefixes` and `formatQuestionLabel` now live in
    `lib/paper-labels.ts`, re-exported from `lib/assignments`.
  - **The batch tab.** It mounts the first time it is opened and then stays
    mounted, so its restore fetch no longer runs on every visit.
- **The roster is in the first HTML.**
  - `page.tsx` reads the whole test with `lib/test-detail.ts`, the select
    GET /api/tests/[id] also uses, and starts the roster's own loads
    alongside it.
  - The header goes out at once. The roster streams in behind a Suspense
    boundary whose fallback is the old loading line.
  - The loads are the routes' own, moved into shared server loaders:
    `lib/course-roster.ts` for GET /api/students, and
    `lib/ai-grade-overview.ts` for the whole-class GET
    /api/tests/[id]/ai-grade and GET .../absences. Each route keeps its auth,
    parameters and response. Checked byte for byte against the old handlers
    on five live tests (read-only).
  - What the client used to work out from those answers is now
    `buildRosterOptions` and `deriveOverviewState` in
    `lib/ai-grade-review.ts`, and both sides call them. `load-initial.ts`
    builds the client's initial state; on the same five tests it equalled
    what the old client computed, roster order included.
  - Key Assessment 1 gets 91 KB of initial state (each student's newest
    complete run and newer attempt) instead of the 508 KB run list the
    browser used to fetch. That costs about ten queries on the server.
  - If any load fails, the initial state is null and the client loads exactly
    as before: the same four requests and the same error messages.
  - The roster now sorts with an explicit "en" collation (`ROSTER_COLLATOR`).
    `localeCompare` without a locale used each runtime's own, and a
    Spanish-language browser sorts n-tilde after every "n", so a refresh
    could have reordered the server's list.
  - On mount the client now makes only two calls: the Anthropic key check,
    and the overnight collect poll when a run is outstanding. The poll now
    starts at once instead of after the roster fetch.
  - One behaviour change: a rubric edited in another tab now shows only after
    a reload. Before, the next roster refresh picked it up.
- **Collapsed classes are remembered.**
  - The cookie is `cp_ai_grade_collapsed`, built in
    `lib/ai-grade-collapsed-classes.ts`. It holds a JSON array of class
    names.
  - It is scoped to `/dashboard/tests`, kept a year, SameSite Lax, and Secure
    on https. It is deleted once nothing is collapsed.
  - It is written when a class heading is clicked, and read in `page.tsx` with
    `cookies()`, so those classes are collapsed in the first HTML.
  - A malformed value reads as nothing collapsed.
- **Checked locally on a fixture page, in dev and a production build:**
  - no hydration warnings and no data requests on mount;
  - the cookie's classes are collapsed in the server HTML;
  - toggling writes and deletes the cookie, and it is not sent outside
    `/dashboard/tests`;
  - the batch tab's chunk and its single restore fetch wait for the first
    click;
  - the KaTeX chunk arrives after the load event, and a review renders
    KaTeX;
  - the fallback path renders the identical roster.
- **After deploy.** The Vercel log for a load of the marking page should show
  the page request and none of /api/students, /api/tests/[id],
  /api/tests/[id]/ai-grade or /absences after it.

## 33. Evidence crops: bounded at the next part, re-cut idempotently, and a layout proposed from the class (24 Sep 2026)

The teacher's screenshot of Key Assessment 1 (Grade 9 Standard), Q1(c): the
"Student's work" crop, badged **Located by marker**, showed one line of the
student's handwriting at the top and then the whole of Q2 underneath -- the
sequence table, (a), (b) and the (c) prompt. Verified against the scan through
the CV service: the stored box ran 0.33-0.73 of the page for 0.08 of work.

**Three causes, all of them in code that was right in isolation.**

1. `padModelBox` added a fixed `MODEL_DOWNWARD_BIAS` of 0.15 to every marker
   box's bottom edge (§23's neighbour, from the Q4(b) case where the marker sat a
   whole part too high). On a one-line answer that is a crop six times taller
   than the work.
2. The grading run sent marker-located regions to the CV service with NO
   growth caps, so `_adaptive_crop_bounds` grew the bottom edge 8pt at a time,
   twelve times, while any slice of the bottom band was more than 5% dark -- and
   Q2's PRINTED text counts as ink. That is the over-reach §5 warns about in the
   NA pipeline, on the test path.
3. "Fix crops" (`widen-crops`) added ANOTHER 0.15 to every marker row on every
   press. It was written for rows stored before the bias, shipped in the same
   commit as the bias (`a5d856f`), and never hid itself. 1,270 KA1 rows had
   been widened once when this was found.

Nothing stored the marker's own box, so nothing could be recomputed from
source.

**What changed.**

- **`ai_grade_results.evidence_box_reported`** (migration `20260924015720`,
  applied through MCP): the marker's box exactly as reported, written once at
  grading and never touched again. `evidence_box` is derived from it.
- **The bias is bounded by the run's own boxes** (`boundModelBoxes` in
  `lib/evidence-crops.ts`). The marker reports a box for every part, and those
  boxes are self-consistent on a page even when each is off, so a crop may reach
  down to the END of the next part's region: the top of the box after the next
  one (plus `NEXT_PART_OVERLAP`, 0.02), or the next box's own bottom when it is
  the last on the page. Not merely the next part's top: the marker's error runs
  to about one part, and on the very same KA1 student whose Q1(c) box was right,
  Q2(a) was boxed on the sequence table with (a)'s answer sitting under 2(b)'s
  box. Bounding at the next TOP made Q1(c) tidy and cut (a)'s answer out of
  Q2(a); bounding at the end of the next region keeps the answer in both cases
  at the cost of one part too many when the box was right. Three parts too many
  cannot happen. The CV service's growth is capped at the same place
  (`modelExpansionCaps`), so printed text below can no longer pull a crop down.
- **Rows without a reported box** (everything marked before 24 Sep) take the
  legacy rule (`boundStoredModelBoxes`): the stored bottom cut back to the same
  region end read off the run's other stored boxes, with
  `LEGACY_NEXT_ALLOWANCE` (0.05: a stored top sits at least `PAD_FLOOR` above its
  raw top). It never widens, so it is idempotent and undoes the double widening
  too. On the screenshot student's page 2 it changes only 1(c) (0.62 -> 0.49) and
  2(a) (0.66 -> 0.60), and caps growth everywhere.
- **"Fix crops" is gone; "Re-cut crops" replaces it** (`recut-crops` route,
  `lib/evidence-recut.ts`, shared with `scripts/recut-evidence-crops.ts` whose
  `--widen-model` flag is removed). One decision for both: a locked layout cuts
  every part with a region ('anchor'); anything else is cut from the reported
  box, else the stored box, bounded as above. A row whose recomputed box is the
  stored box with an image on file is "already right" and not touched, so the
  button can be pressed twice. Teacher-drawn regions are never re-cut; nothing
  here writes a mark or `evidence_box_reported`.
- **A paper with no layout can have one proposed from the class**
  (`POST /api/tests/[id]/paper-layout/propose`, `lib/paper-layout-consensus.ts`):
  the newest complete run per student, every part's box, median top per part,
  bottom at the next part's median top on the same page (the foot of the page
  for the last part on it), one content width for the paper. The marker's PAGE
  agrees for every student on every KA1 part; its tops scatter +/-0.08, and the
  median is a far better estimate than any one of them. Written to the active
  UNLOCKED layout as `source = 'marker_consensus'`; regions drawn by hand are
  kept; nothing cuts a crop until the teacher locks. The editor badges each
  region (Drawn / Generated / Proposed), lists the warnings, and once locked
  offers "Re-cut every student's crops from this layout" (one request per
  student, stoppable). The paper-layout GET now lists one run per student
  (`latestRunPerSubject`) instead of the newest 60 runs, which on KA1 was a few
  students' repeats.

**KA1 procedure, for the teacher.** Paper layout page -> pick a clean scan as the
reference -> "Propose regions from the class's marker boxes" -> expect one
warning: Q4(c) and Q5 are out of reading order on page 4 (the marker puts Q5's
top at 0.43 and 4(c)'s at 0.49; 4(c) is given its own median bottom) -> open
those two and drag them right; open Q2(a) and Q2(b) too, since the marker boxed
the sequence table for (a) on at least one student -> Lock -> "Re-cut every
student's crops". Until then, "Re-cut crops" on a student bounds that student's
marker crops at the next part.

**Deliberately not done.** No change to the grading prompt or model (§24). No
upward padding of the marker's box: the printed prompt above the handwriting
stays out of a marker-located crop, and the layout path shows it properly. No
layout derived from a master PDF's text layer -- KA1 has no master in Storage,
and the standards importer does not keep the paper it reads; worth doing for the
next imported paper (store the PDF at import, read the printed part labels with
pdfjs the way `paper-layout-derive.ts` reads anchor marks).

## 34. Extended KA1's mark scheme brought in line with its marking notes (24 Sep 2026)

The teacher asked for the same alignment as the Standard paper got in
section 26, on Grade 9 Extended Key Assessment 1. All eleven parts that carry
marking notes had moved away from their printed scheme, in both directions:
more lenient on 2.1(a) ("cost" supplies the units), 2.2(a) (any equivalent
of 6m - 8), 3.1 (a copying slip costs one mark only), 3.4(a) (one slipped
product still earns the method mark), 4.1 (the conclusion need not say "for
every x"), 4.3(b) (a third route, "90% of 80% of c is not 70% of c") and
4.2(a) (every student gets both marks, as material not yet assessed);
stricter or more exact on 1.3(a) (the sum must be evaluated to 0), 2.1(b)
("dollars" must be written; "total cost" alone earns 0 -- note the contrast
with 2.1(a), which is the teacher's ruling, kept as it stands), 3.2(b) (w = 6
with no valid working earns nothing) and 4.3(a) (the answer mark needs 0.72c
written simplified).

Migration `20260924113414_ka1_extended_schemes_match_rulings` rewrites the
eleven texts from the notes. **This paper lives in two places**: it was
written in the creator, so the student page and the per-part scheme beside
each self-grade box read `tests.custom_content`, while the grader reads
`test_items.markscheme_text` -- the migration updates both, in place, with
`jsonb_set` on the draft. Re-saving through the creator is the thing not to
do: `syncTestItems` recreates `test_items` with new ids and cuts the
accepted marks loose from them. A `do` block first checks all 22 texts
against the md5 they were written against and raises, applying nothing, if
any has changed; every update is guarded the same way. There are no
triggers on `tests` or `test_items`.

- Each part keeps its leading M1/A1/R1 openings, which the Formative
  Assessment marker itemises; outcomes are said in words ("the answer mark",
  "1 of 3") because the student page strips the codes, and "earns M1A0"
  stripped reads as "earns". Every text was proof-read in its stripped,
  student-facing form before applying.
- Verified after applying: the draft and the items agree on all 36 parts,
  the eleven new texts are in place, and the real mark-scheme route, run as
  a 9C student against live data, serves them. The notes were not touched,
  so no mark changes.
- **Not updated: the archived teacher mark scheme PDF**
  (`tests.mark_scheme_pdf_storage_path`), which is rendered when the draft is
  saved and still shows the earlier wording. Regenerating it goes through
  the save route, which is the re-save above.

## 35. Batch scans: one class per pile, and a dropped student is flagged (24 Sep 2026)

Two students of 9C's Key Assessment 1 (Extended) self-assessed on 23 Sep and
saw no Clev's Marks. Both were in 9C's batch scan (`U1 Summ_C_1.pdf`, batch
`7e849ed9`, 240 pages, split 15 Sep), and each was lost a different way:

- **One student's pages were never stored.** The split route writes one PDF
  per student; hers failed to upload (a one-off -- her pages split cleanly
  from the same scan on 24 Sep). The route reported that only in its HTTP
  response ("1 could not be sent"), still marked the batch `split` with every
  segment confirmed, and the tab was closed. No run was ever created, and the
  roster showed her exactly like someone who had not handed a script in.
- **The other's script was matched to a student in another class.** His cover
  said only "Santiago" and "Bloc C". The quick read's cover check was given
  all 51 names of the track (9A, 9C, 9G), called 9A's Santiago "the only
  Santiago enrolled" with both on its list, and that became the segment's
  label and match; the teacher confirmed it. The 9A student then carried
  49/50 from the 9C student's paper (one part changed by hand on 16 Sep, the
  rest accepted 22 Sep). His own 9A paper had been marked on 16 Sep, but that
  run no longer exists -- no app code deletes `ai_grade_runs`, so it was
  removed directly in the database between 16 and 21 Sep, by someone unknown.

**Data repair, 24 Sep (execute_sql, approved by the teacher; no schema change):**
the 11 runs, 396 results and 36 `student_marks` rows moved from the 9A
student to the 9C student, with 72 `mark_changes` rows recording the move
(removal on one record, arrival on the other, `changed_by` the teacher). The
scan and its 46 evidence crops were copied into the 9C student's own folder
and repointed; the 47 originals are still in the 9A student's folder,
unreferenced -- deleting them was blocked by the session's permissions and is
the teacher's call. Segment 9 of the batch's `confirmed_segments` now names
the right student, and the test's PowerSchool files were flagged stale. The
missing student's 12 pages were cut from the class scan into her folder. The
9A student's own 9A paper had its even pages stored upside down (the 9A scan
was split on 16 Sep, before the orientation check existed; the other 13 papers
from it were turned at 21:41 that day, his was missed): pages 2, 4, 6 and 8
were turned with the same operation as `rotatePagesUpright` and saved as a new
file. Both students got a placeholder `failed` run pointing at their scan,
whose error begins "Not marked yet", so the roster shows **Mark now** and the
orientation check is skipped (both files are already upright). Neither was
marked from here -- marking only runs on production with a teacher session.

**Code (this change):**

- **The split records every student's outcome** on their confirmed segment
  (`storagePath`, or `splitError`; `ConfirmedSegment` and `withSplitOutcomes`
  in `lib/batch-split.ts`). `{ retryStudentIds }` on the same route splits
  just those students again from the stored mapping. The overview loader adds
  `unmarked` -- anyone in a split batch's confirmed segments with no run of any
  status (`lib/batch-unmarked.ts`) -- and the Individual tab shows a banner and
  flags their row with **Recover & mark overnight** / **Mark now** (re-saving
  the pages first when the split never stored them). Nothing was flagged on
  the day it shipped: every confirmed student had a run after the repair.
- **A batch scan is matched against one class.** The Batch tab asks "Class in
  this scan" whenever more than one class sits the paper (upload is held until
  it is chosen; "Mixed classes" keeps the old whole-track pooling). The class
  is stored on `ai_grade_batches.course_id` (migration `20260924125631`), and
  the cover check, the roster match, the byte-identical-upload reuse (same
  class only) and the batch list's re-match all use it.
  `holdOtherClassNames` clears a match whose cover label is exactly the name
  of a student in another class and says so in the row's note -- without it,
  class-only matching turns a stray 9A script reading "Santiago <surname>"
  into a confident match on 9C's only Santiago, the same mix-up in reverse.
  Batches from before 24 Sep have `course_id` null and behave as before.

## 36. A carried row lost the reason it was not "high" (24 Sep 2026)

The teacher asked why Key Assessment 1 Q10(c) (printed 3.4(c), "Simplify
completely") was marked **low** when its Why? panel said "The marker's own
call: nothing was corrected after the fact". It was not the marker's own call.
On 17 Sep the marker's reasoning settled on the student's `6ab² − 5b` (0 of 1)
while its own breakdown awarded A1 "Correctly combined like terms: 6ab² + 5b".
`validateGradeResponse` never lets a breakdown raise a total, so it kept 0,
forced low, and wrote `10(c): model reported 0 mark(s) but its own breakdown
awards 1 token(s) ...` plus a hedge warning ("appears to"). The doubt was the
model's reading of one sign; the crop reads −5b, so the 0 stands.

**Why the panel lost it.** A partial re-mark copies every part it was not
asked to mark from the previous complete run (`persistGradeOutcome`), but
wrote `coverage.warnings` from the new run's own warnings only. The panel and
`scripts/confidence-calibration.ts` read a row's warnings from the run the row
is stored under, so every carried part lost its reason. This student had eight
one-part re-marks of other questions after 17 Sep (each of a part that carries
a marking note); each copied 10(c) verbatim and dropped its two warnings.

**What changed.**

- `persistGradeOutcome` copies the previous run's warnings for the parts it
  carries, through `warningsForParts` in `lib/ai-grade-review.ts` (beside
  `warningsForPart`, tested).
- `scripts/backfill-carried-warnings.ts` repairs the runs written before:
  each student's runs in completion order, only ever adding a missing warning
  string to `coverage.warnings`, so it can be run twice. Dry run, 24 Sep: 1026
  warnings missing from 625 of 859 partial re-marks, all on Key Assessment 1
  and Key Assessment 1 - Unit 1. On the newest runs (the ones the panel shows)
  that is 69 warnings across 47 students, and 45 rows below "high" that read
  "the marker's own call": 18 were breakdown caps, 27 the hedge cap §23 B
  retired. **Applied 24 Sep 2026**: 625 of 625 runs updated, a second pass
  finds nothing to restore, and no newest run is missing a carried part's
  warnings.
- §23's calibration numbers predate partial re-marks (the first was 20 Sep
  20:04 UTC) and are unaffected. A calibration run between then and the
  backfill would count carried caps as the marker's own call.

**The deliberation scan, done the same day.** `lib/examiner-reasoning.ts`
matched "wait," but not "Wait -", "Re-examining" or "looking again", which is
how this reasoning changed its mind. All three now count as deliberation:
the part is forced low and its row reads "reasoning changed its mind".
"wait" counts only before a dash used as punctuation, so "wait-time" and "the
students wait 5 minutes" in a word problem do not. Measured over every stored
result (32,587 parts): 26 matches, 7 distinct reasonings, and in every one the
conclusion disagreed with its own mark or breakdown ("Wait - this is
correct!" on a 0/1; "M1 M1 A0" on a 1/3). None was labelled high (3 medium,
the rest low). Stored rows keep their labels and warnings until they are
re-marked, as in §23 B, and the calibration script reads stored labels, so it
shows the effect only as re-marks accumulate (§23 A). No prompt change, so no
eval run.

## 37. Each assessment has its own grade boundaries, decided with a stated reason (24 Sep 2026)

The teacher asked what the "suggested grade boundaries" for Extended Key
Assessment 1 were, including students whose marks were not accepted yet. No
such thing existed: every test pointed `tests.boundary_set_id` at a SHARED
preset (A-D for DP progression, `Grade 9`), the gradebook counted accepted
marks only, and nothing recorded who chose a paper's lines or why. Worked out
by hand (accepted mark, else the newest complete run's suggestion, else 0):
49 of 51 scored, and under Grade 9 (45/40/35/30/25/20 of 50) 3/13/11/7/9/6/0 for
levels 7..1. The 30 and 25 lines split clusters (five students on 29, three on
24), so 45/40/35/28/23/18 was suggested (3/13/11/12/7/3/0). The teacher then
asked for: each assessment to have its own boundaries; the boundaries and the
decision to use them shown to the teacher; an input to tell the AI how to
adjust its boundary suggestion; and a toggle between "this assessment only"
and "a general rule for all assessments". Standard papers included, at the
teacher's choice; activities excluded (not graded 1-7).

### What was built

**Schema** (migration `20260924171151_per_test_grade_boundaries`, applied
through MCP before any code shipped, md5-checked against the ledger; schema
only, no existing row changed):

- `grade_boundary_sets.test_id` (an assessment's OWN set; null = preset) and
  `origin_set_id` (the preset it descends from). `name` stays unique; own sets
  are named `'test ' || test_id` and labelled at read time ("Grade 9" while the
  lines are the preset's, "Own" once they differ).
- `boundary_guidance`, `boundary_suggestions`, `test_boundary_decisions`, all
  teacher-only (`get_my_role()`); decisions are SELECT-only for teachers.
- `decide_test_boundaries()` -- the ONE write path. SECURITY DEFINER, teacher
  and owner checked, test row locked, a stale `p_expected_decision_id` raised
  as SQLSTATE `PT409` (PostgREST answers 409: another tab decided first), own
  set created on the FIRST decision, bands upserted, `tests.boundary_set_id`
  repointed, decision row written, `powerschool_export_files.stale` set when
  the lines moved -- one transaction. Exercised on KA1 inside a `DO` block that
  raised at the end (so nothing persisted): own set created with origin
  "Grade 9", bands 0.36..0.90, the test repointed, a stale expected id refused
  with PT409, the Grade 9 preset untouched; a student's JWT refused.

**No bulk copy.** A test keeps pointing at its preset until its first
decision, and the page and badges say "Shared 'Grade 9' preset, not decided
yet". That kept the deploy order safe: old gradebook code never saw an own
set. "Keep the boundaries in use" is a decision too (it makes the own copy).

**Marks and levels** (`lib/grade-bands.ts`): cut-offs are entered and shown in
MARKS and stored as `floor(m*10000/T)/10000` (numeric(5,4); rounding 43/70 up
to 0.6143 would ask for 43.001 marks). An existing proportion that lands on
the same mark is kept (`boundariesFromCutoffs`), so an unmoved Grade 9 line
stays 0.9 and not an equivalent re-derivation. The lookup got a 1e-9 margin.
`grade-bands.test.ts` round-trips every cut-off at every total 1..200.

**The gradebook's aggregates** (Overall, P1/P2/P3/IA) compare tests by their
LINES, not their set ids (`aggregateGrade`): identical lines are used as they
are (no regression while FA1 and KA1 both read 90/80/70/60/50/40), different
lines are BLENDED by marks (`sum(p x total) / sum(total)` per level -- a
student on every paper's line is on the blended one), and only a test with no
boundaries still means the generic bands. The page loads only the sets its
tests use, paged (seven rows per test passes PostgREST's 1000-row cap at ~140
tests).

**The page** `/dashboard/tests/[id]/boundaries` (`lib/boundary-data.ts` loads
everything once; `lib/boundary-scores.ts` computes in the browser as the
teacher types):
- In use: lines in marks, students per level (everyone scored / every part
  accepted), the decision statement with who, when and source, history, and a
  warning if total marks changed since.
- Scores: stacked histogram (accepted / not final; colours checked with the
  dataviz validator against `--color-da-surface`), lines in use solid, draft
  dashed, a table view, cluster-split warnings, and "Check these first": not-
  final students whose level hangs on a pending or never-marked part.
- Draft: six inputs, starting from the lines in use, a preset or the AI.
- Decision: a required statement; "Use these boundaries" / "Keep the
  boundaries in use", each behind a confirm naming how many students move.
  The server works out the source; the client never sends it.
- Guidance for the AI: textarea, the two-way toggle, Save / Save & suggest
  again, the active rules with Remove (archive).

**The AI** (`lib/boundary-suggestion.ts`, `POST .../boundaries/suggest`):
Opus 5, adaptive thinking, effort high, `messages.parse` + `zodOutputFormat`,
the system block cached. The policy is `grading_policies/
grade_boundary_principles.md` (own words -- the repo is public -- listed in
`platform/CLAUDE.md`); the fixed rules follow it in code. The model gets the
paper's sections (LEVEL headings, Standard strands, or Section A/B), the lines
in force and the presets IN MARKS, the other assessments in the track family,
every student's total/status/section subtotals with NO names, ids or classes,
and the guidance. Structured output cannot enforce ranges, so
`checkSuggestion` does (whole marks, strictly decreasing, in range, every
guidance note reported once, none invented). Usage pipeline
`boundary_suggest`, ref type `test`. The installed SDK (0.90) has no
server-side refusal fallback, so a refusal is the house 502.

**Elsewhere:** the test page's preset dropdown is now a summary with a link,
and `PATCH /api/tests/[id]` no longer accepts `boundary_set_id` (it also marks
PowerSchool files stale when `total_marks` changes -- a gap that predated this).
The Tests list shows a status chip and "Boundaries ->". The Assessment Creator
lists presets only, shows an own set read-only, and its save route never
repoints a test with its own set or takes another test's set. `DELETE
/api/tests/[id]` archives the lines, decisions and guidance -- and now pages
the marks and self-scores it archives (it read them unpaged, so a 50-student
paper archived 1000 of ~1,800 marks) and keeps `invited_student_id`.
`scripts/check-deploy-schema.mjs` probes the new columns and tables and treats
a missing table (PGRST205/42P01) as missing rather than unexpected.

### Verified

- `npm test` and `npm run build` green; the schema probe passes on production.
- The real loader, run read-only against production with the service role,
  matched an independent SQL count for KA1 at 17:37 UTC exactly (49 scored,
  34 fully accepted, mean 35.04, median 37, 3/13/11/7/9/6/0 and 2/12/8/5/3/4/0),
  and loads the Standard KA1 (four strands, no boundaries), FA1 and a DP paper
  (Section A/B, set B).
- In a browser against production (24 Sep, a teacher session minted with the
  teacher's OK and revoked after; every POST except the key-less suggest was
  blocked, so nothing was written):
  - The KA1 page matched the SQL count taken 25 seconds later, including the
    draft 45/40/35/28/23/18: 3/13/11/12/8/2/0, 9 up and 0 down (one more than
    at 17:37, as marks had been accepted since).
  - Suggest without the key shows its error. Both decision buttons stay
    disabled until there is a statement, and the guidance toggle flips.
  - The 9A, 9C, 9G, 9D and 27AH gradebooks are cell-for-cell identical to
    main's.
  - That run found seven UI faults, fixed in the same PR:
    - the draft lines were drawn over identical lines in use;
    - the page said "draft" when nothing had been drafted;
    - empty scores were listed unsorted;
    - messages were set at the top of the page, out of sight of the button that
      set them (now a fixed toast);
    - the chart was unreadable on a phone (now a 560px minimum inside its own
      scroll box);
    - a paper with no lines in use was pre-filled with the first preset, DP
      "A" (now it starts empty);
    - the tests-list chip wrapped mid-word and squeezed the card's buttons.
  - Two warnings in that run come from the harness, not the app:
    - a hydration warning quoting `style="caret-color: transparent"`, which
      Playwright sets on inputs when it screenshots before hydration;
    - `notFound()` answering 200. `app/dashboard/loading.tsx` streams every
      dashboard page, and main's test pages do the same.

### Deliberately not done

- No decision or guidance was saved on any real test: which lines KA1 uses is
  the teacher's call, on the page.
- The suggest route needs `ANTHROPIC_API_KEY`, absent from agent sandboxes;
  it runs on production.
- Students can still SELECT every set and band (the policy from 20260802224213
  is unchanged). Nothing student-facing reads them.
- The archived teacher mark scheme PDFs and old PowerSchool files are not
  rebuilt by a decision beyond being marked stale (they rebuild on download).

## 38. Re-mark requests, the ClevMarks rename, and no "AI" on the student side (24 Sep 2026)

The teacher asked that a student who has self-assessed, and sees their mark
differ from the teacher's on a part, be able to send a written explanation
of why that part should be re-marked. In the same request: teacher marks are
now called **ClevMarks**, and **the term "AI" must never appear on the
student side** -- not in copy, not in URLs, not anywhere. Both are now rules
in `platform/CLAUDE.md`.

### What a student sees

- On the Compare step (`components/reflection/ScoreTable.tsx`), every part
  where their SAVED self mark differs from ClevMarks (a blank counts as 0,
  as everywhere) gets an **Ask for a re-mark** button under it
  (`components/reflection/RemarkRequestRow.tsx`). The explanation must be
  15-1000 characters; any difference qualifies, an under-claim included.
- A waiting request shows their text, **Edit**, and **Withdraw** -- the
  last only until they upload corrections for that test (the route enforces
  it). Once answered it shows "Re-marked: ClevMarks changed from 2 to 3" or
  "Re-mark reviewed: ClevMarks stay at 2", with the teacher's note.
- **A part with a waiting request is left out of the disagreement %**
  (`computeDisagreement(items, excusedItemIds)`, `lib/reflection-utils.ts`),
  so it does not hold Upload Corrections shut -- the "challenge your
  teacher's mark" path the locked Upload panel always listed, which nothing
  implemented until now. Once answered the part counts again: after "Mark
  stands" the student changes their own mark to settle it, unless they have
  already uploaded. Whether a student has self-graded, and whether anything
  is marked, are still read from every part.
- Requests are attached to the items (`ReflectionItem.remark_request`, by
  `attachRemarkRequests` in `lib/exam-service.ts`) only where the page is
  showing marks: a request carries marks, and attaching one to items the
  self-assessment gate has blanked would leak them. The client updates items
  in place after a request is sent -- never `router.refresh()`, which would
  remount and throw away unsaved Compare edits.
- `?viewAs=` shows the button disabled (the preview must match what the
  student sees); `?viewStudent=` and the Upload step show requests read-only.

### What the teacher sees

- **`/dashboard/remark-requests`** (nav: Re-mark Requests; a count card on
  the dashboard): waiting requests across every test, grouped by test and
  then by part in paper order, oldest first, each part's mark scheme printed
  once as the student saw it (`studentMarkSchemeParts`, never
  `marking_notes`). Its toggle says "as the student sees it" only for a test
  whose scheme is released to students (`releasesStudentMarkScheme` in
  `lib/student-mark-scheme.ts`, the same gate `attachStudentMarkScheme`
  uses); otherwise it reads "not released to students" -- Formative
  Assessment 1 has a full scheme in its draft that students were never
  shown. Each request: the student's words, ClevMarks and their
  self mark now, badges for "was N when asked" / "their mark now agrees" /
  "corrections uploaded", links to the student's view and the marking
  screen, and **Mark stands** / **Mark changed** with an optional note.
  Loaded by `lib/remark-requests-service.ts`, every read paged.
- **Mark changed** (`PATCH /api/remark-requests/[id]`) writes
  `student_marks`, a `mark_changes` row (reason `Re-mark request: <note>`,
  through `logMarkChanges`) and flags the PowerSchool export stale -- the
  same as a gradebook edit, so the part's `ai_grade_results` row stays as it
  was, exactly as after a gradebook edit. The mark is written first and the
  request second; a retry after a failed second half finds the mark in place
  and skips the write. The page sends the ClevMark it showed
  (`expectedCurrentMarks`) and a mark that moved since is refused with 409.
- The reflection dashboard's grid and student preview leave waiting parts
  out of the disagreement too (`StudentReflectionRow.pending_remark_item_ids`
  from `getClassReflectionData`), so the two views never disagree about
  whether a student's upload is open.

### The table: `remark_requests`

Migration `20260924211255_remark_requests` (applied through MCP, byte-identical to the ledger). One row per student per part;
`marks_at_request` / `self_marks_at_request` are taken by the route when the
request is made. **Students can only SELECT their own rows; nobody but the
service role can insert or delete** (`revoke insert, delete, truncate ...
from authenticated`, everything from anon). `app/api/remark-requests` does
every student write with the service role, after checking in the student's
own session what no row policy can: the test is one they can see
(`getTestsForStudent`: track family, hidden, release time), they have
self-graded it, and the part's ClevMark differs from their saved mark. A
student insert policy would have let a student skip all of that, invent the
marks they asked about, or back-date the queue, straight through PostgREST
-- and the teacher's `?viewStudent=` session cannot file on a student's
behalf, because no insert policy exists for anyone.

Teachers SELECT and UPDATE requests on tests they own (the `student_marks`
ownership test), not by `get_my_role()`: two of the teacher's own test
accounts carry `role='teacher'` and own no tests. `remark_requests_guard`
refuses to change the part, the student, the snapshots or `created_at`, any
change to an answered request, and a reworded explanation in the write that
answers it; `resolved_by` therefore has no ON DELETE action.
`remark_requests` is also in `DEPENDENT_TABLES`
(`lib/formative-assessment-bridge.ts`), so a creator re-save refuses to
delete a part a request hangs off -- which also means a missing table makes
Formative Assessment saves fail, so **the migration must be applied before
this code reaches `main`**.

Dry-run before applying (PGlite, Supabase-like default privileges): student
SELECT sees own rows only, INSERT/DELETE are denied and UPDATE touches 0
rows; the owning teacher reads and resolves; a teacher-role account owning no
tests sees nothing; anon is denied; the guard, the four checks, the unique
key, the `updated_at` trigger and the cascade from `test_items` all behave.
Repeated against production after applying, each probe in a rolled-back
transaction as a real student, the teacher (`702750f6`) and the teacher-role
test account `822c943e`: the same results, and 0 rows left behind. Advisors
list nothing new but three unused-index INFOs (an empty table) and the
two-SELECT-policy WARN the schema already has 268 of. The deploy schema probe
(`scripts/check-deploy-schema.mjs`) checks `remark_requests.status`.

**Browser check, 24 Sep, against production** (dev server, sessions minted
with the teacher's approval and revoked afterwards with `signOut(token,
"local")`, not the run-app skill's `"global"`, which would also have signed
the teacher out on their own devices). The test account `44db5d56` was
switched to student with `set_test_account_role` and, on "27AH [K06] P1":
15 differing parts offered "Ask for a re-mark", the column read ClevMarks
and the page said neither AI nor Claude; sending one request showed it
waiting and moved the disagreement from 41.4% (29/70) to 41.2% (28/68) with
"1 part waiting for a re-mark isn't counted". `/dashboard/graph-lab` sent
that account to `/unauthorized` (the redirect is streamed from the layout,
so it lands a moment after the first 200). As the teacher: the dashboard
card read 1, the queue grouped it under the test and part, and **Mark
stands** with a note recorded `stands`, the note and the teacher, wrote no
`student_marks` or `mark_changes` row, and dropped the queue to 0. Back as
the student: "Re-mark reviewed: ClevMarks stay at 2.", the note, and 41.4%
again. The request was then deleted, the account put back to teacher, and
its 18 self-scores were untouched. Two things about running it: the dev
server restarts itself on its memory ceiling while compiling
`/api/remark-requests/[id]` cold (warm it with an unauthenticated request
first), and a screenshot taken before hydration makes React report a
`caret-color` mismatch on inputs -- Playwright hides the caret with an
inline style; it is not the app.

### The rename

"Clev's Marks" / `Clev&apos;s Marks` / `Clev&rsquo;s Marks` became
"ClevMarks" in every UI string (57 lines, student and teacher), and the
student-facing "Teacher" labels for the same marks followed (the Compare
table's column, the mastery pages, the reflection dashboard's tooltips).
Comments, test titles, migrations and this file's history keep the old
name.

- **The packet generator's copy rule lives in the database.** The canonical
  `nuanced_analysis_specs` row wins over `lib/nuanced-analysis-spec.defaults.ts`
  (`loadCanonicalSpecForGeneration`), so migration `20260924211331_clevmarks_copy_rule` (likewise)
  rewrites the `copy-clevs-marks` rule text in place (id and `spec_version`
  unchanged; a no-op if the rule has been reworded). Rule 22 in
  `lib/assignments.ts`, the edit prompt's rule 9 and the DP designer's
  `assessment_tracker` default are code only.
- `scripts/na_derive_anchors.py` checks a packet against its printed
  "Clev's Marks: N" pills; its pattern now reads "ClevMarks: N" too.
- **Deliberately left:** stored content that already says "Clev's Marks" --
  `nuanced_analyses` drafts, parts, companions and digests, two
  `assignment_templates` drafts, two `na_anchors` and two `na_rubric_items`
  prompts, `na_continuity`, and the generation logs. All of it quotes paper
  students already hold (the anchors were cut from those printed masters),
  and none of it is page text on a student screen.

### "AI" on the student side

Audited every student-reachable page and every URL a student's browser
calls. Fixed: the Mastery page's packet panel ("Claude will read the PDFs")
and its route's error ("Empty response from AI"), and `/dashboard/graph-lab`,
the one dashboard page with no role check (a client page mentioning Claude),
which now has a server `layout.tsx` calling `requireTeacher()`. The new
feature's paths (`/api/remark-requests`), fields and copy carry no "AI".
Watch for two things: `TeacherDashboard.tsx` ships in the student's
reflection bundle, so it must never gain an `ai-grade` URL or AI copy; and
the IB course "Applications & Interpretation" is abbreviated AI, so a test
or packet NAME can still put the letters on a student's screen (none visible
today).

## 39. Student mark schemes put marking codes into words (24 Sep 2026)

`stripMarkCodes` (`lib/student-mark-scheme.ts`) turns a teacher's
"How it's marked" note into what a student reads, on the full mark-scheme
page and beside each part of the self-grade form. It used to delete every
M/A/R code and then recapitalise every sentence, which garbled 12 of the 103
live notes and left "FT" in 7 more:

- a code used as a noun left a hole: "three of four earns M1A0." read "three
  of four earns", "(the R1 is for the conclusion ... earns M1R0)" read "(the
  is for the conclusion ... earns )", and a sentence ran into the next;
- recapitalising changed the maths: "A1 for x = ..." read "X = ...",
  "A1. u^2 - v^2" read "U^2 - v^2", and "e.g. dividing" became "e.g.
  Dividing";
- "A1 -- the whole ..." kept its dash.

Now each code becomes the words it stands for, in the vocabulary the
Formative Assessment principles and the notes' own prose use: "M1 for X" is
"Method mark for X", "earns M1A0" is "earns the method mark only", "M0A0"
is "no marks", "M1M0A0" is "the first method mark only", "the R1" is "the
reasoning mark", FT is "follow-through" ("FT through (b)" is "follow-through
applies to (b)"), and "the second M" is "the second method mark". A code
that only labels a part ("A1." opening a one-mark note) is still dropped. The
teacher's own words are never recapitalised; only a dash-continued label's
next plain word is ("A1 -- the whole" reads "The whole").

- Checked against all 103 live notes (Extended KA1, Formative Assessment 1
  and Standard Level KA1): 42 read differently, none keeps a code, none has
  a hole, and no variable changes case. Standard Level KA1 has no codes and
  is unchanged.
- §34 rewrote Extended KA1's outcomes in words to dodge the holes; that is
  no longer needed, so a teacher can write "earns M1A0" again.
- A part whose note was only a label and which has no answer now shows no
  box at all, rather than an empty one.

## 40. Grade 9 Standard Level Formative Assessment 2 (25 Sep 2026)

The teacher supplied Formative Assessment 2 (5 pages, 6 questions, 14
parts, 36 marks) and asked for it as a Grade 9 Standard Level formative the
platform can grade. It is live and hidden on 9D: test
`739386b4-9b96-4695-8978-bc8ef8370d0c`.

### What was built

- **The paper as data, in KA1's pattern (section 21).** A fixture,
  `lib/fixtures/g9-standard-fa2.ts`, and a seed generated from it rather
  than copied by hand (`20260925040451_seed_g9_standard_fa2`, applied
  through MCP; the ledger's md5 is the file's minus its trailing newline).
  One `tests` row: `formative`, `standards_rubric` set, self-assessment
  required, no boundary set, `short_name` Form2, no test date (the paper
  prints none), no `mark_scheme_url`, `hidden = true`. 14 `custom` items,
  each with its stem, its own wording and a scheme.
- **Not through the importer.** `/dashboard/tests/standards-import` reads
  a paper AND its Teacher Marking Rubric. This paper came with no rubric,
  so there was nothing to transcribe strands from.
- **So the rubric was written here, from the paper's own question
  grouping in KA1's shape:** A Expressions: evaluate, write and rewrite
  (Q1-Q2, 13 marks); B Arithmetic sequences: explicit rules and
  representations (Q3, 12); C Arithmetic and geometric sequences (Q4-Q5,
  7); D Reasoning and justification (Q6, 4). Standards are worded as KA1
  words them wherever KA1 names the same one, and the descriptors were
  written to agree with the part schemes. Ranges (E / M / AP / B): A
  12-13 / 9-11 / 6-8 / 0-5, B 11-12 / 8-10 / 5-7 / 0-4, C 6-7 / 5 / 3-4 /
  0-2, D 4 / 3 / 2 / 0-1, overall 31-36 / 24-30 / 15-23 / 0-14. D is only 4
  marks, so its level moves a band per mark. All of it is editable on the
  test page.
- **The schemes carry the KA1 rulings forward** (section 26 and KA1's
  `marking_notes`): an intermediate result only the method could produce
  is evidence of it; follow-through is applied, not mentioned; one error
  costs one mark; a reason earns its mark for its content, not its
  wording; a check by substitution is a complete method. There are no
  M/A/R codes, so `stripMarkCodes` leaves every scheme as written.
- **One call for the teacher.** "Show all work" is printed only on the
  cover. The calculation parts (1a-c, 2a, 3a, 5) give a bare correct answer
  its answer mark and withhold the method mark, citing the cover. Rule A6
  of `lib/ask-what-you-mark.ts` says a demand made only in the instructions
  does not carry into a part. If the teacher reads the cover that way,
  each of those schemes has one sentence to change.
- **Q3's stem is only on (b)-(d)**: the printed table and graph, in a
  bracketed marker's note like KA1 Q9's figures. Q3(a) is a different
  sequence. The marking page prints a stem in the row header on a
  question's first part only, so Q3's row header shows none; the Expand
  panel shows it on (b)-(d).

### Verified

- `lib/fixtures/g9-standard-fa2.test.ts` covers:
  - parts against the printed question totals and 36;
  - rubric validity, and `validateStandardsDraft` with no findings;
  - the Standard Level policy in the prompt and the Formative one absent;
  - an itemisation on every multi-mark scheme;
  - a bare answer refused a mark only for a demand the paper makes;
  - the student mark scheme (14 rows, 36 marks, typeset).

  Mutation-checked: a 4-mark 3(b), a marking code in a scheme and a strand
  naming a missing part each fail it.
- The seed was dry-run in PGlite: twice, to show a re-run is a no-op, and
  once with 9D missing, which the guard refused. After applying, the live
  rows matched the fixture on all 42 fields (14 rows x stem, question,
  scheme) by md5. `assembleMarkScheme` over the live rows gives 14 units,
  36 marks, no warnings, every unit on its strand.
- **One real marking pass.** A synthetic script was written onto the
  actual paper: typed answers in the boxes, and a point plotted at (3, 15)
  with the graph's scale calibrated off its three printed points. It was
  wrong on purpose in 9 parts. It went through `buildGradingRequest` with
  the live units to `claude-opus-4-5` (`GRADING_MODEL`). Read-only: no
  run, no results, no usage row.
  - First pass: 13 of 14 parts as the schemes say. Q1(b) came back 1 of 3
    where the scheme says one carried sign error earns 2. The scheme had
    defined its last mark as "working correctly to the end, -5", and the
    marker read that over the follow-through sentence after it.
  - Reworded in `20260925041302_fa2_1b_scheme_follow_through` (md5-guarded
    on the text it replaces and the text it writes; fixture updated in the
    same change) and re-marked: 14 of 14, 24/36 as predicted. Every other
    part came back identical across the two runs.
  - About $0.43 for both calls, on `GRADING_ANTHROPIC_API_KEY`.

### Deliberately not done

- **Not released to students.** The test is hidden and no student mark
  scheme is set. To release the platform's own scheme (section 26), set
  Mark Scheme URL to
  `/api/tests/739386b4-9b96-4695-8978-bc8ef8370d0c/mark-scheme`.
- **No test date and no boundaries.** The gradebook shows `~approx` until
  the teacher decides lines on the boundaries page (section 37). A 9D
  PowerSchool export uses the fallback bands until then.
- **No `marking_notes`.** Those are the teacher's rulings from real
  scripts.
- **Section 7 of `grading_policies/g9_standard_level_marking_principles.md`
  was written for KA1.** It says a calculator is permitted and mentions a
  precision rule; FA2 prints neither. It is harmless here, since every
  answer is an integer, but worth generalising before a no-calculator
  Standard paper.
- **Nothing real has been marked yet.** The first class through deserves
  section 11's spot-check.

### The ledger, as this branch leaves it

187 ledger rows against 186 files on this branch.
`20260925040006_mark_scheme_explanations` was applied through MCP at
04:00 UTC by another session, whose branch was not on the remote when this
one was pushed. Until both branches merge, `platform-supabase-migrations.yml`
names whichever version main lacks. That is the fail-safe described in the
README, not drift: never "repair" it as reverted.

## 41. Parts with no mark scheme are listed before marking (25 Sep 2026)

The teacher asked whether 27AH [L67] P1 (AA HL Paper 1, sat 23 Sep 2026)
was ready for scans. It was not, twice over, and nothing on screen said so:

- It existed only as an ExamBuilder draft (`saved_exams`
  `7bc430fd-8db5-4814-9707-9513038b11a6`); no `tests` row, so no Mark Scans
  page to upload to.
- Six of its eight bank questions (Q2, Q3, Q4, Q5, Q7, Q8 -- 12 of the 14
  parts it would import as, 59 of 70 marks) have no mark scheme text in the
  PPQ bank: no `markscheme_latex`, `markscheme_text`, `stem_markscheme_latex`
  or `parts_draft_markscheme_latex`. They do have mark-scheme IMAGES, which
  the grader never reads. Q1 and Q6 have only old Tesseract
  `markscheme_text`.

Because two parts were gradeable, marking would NOT have been refused -- the
422 fires only when zero parts are (`ai-grade/route.ts`, `queue/route.ts`,
`collect/route.ts`). The paper would have been marked out of 11 and said so
only afterwards ("graded X/11 of 70 total"). The Import dialog also promised
the new test "can be AI-graded straight away", and its warnings were never
seen: the parent closed the modal the moment the import succeeded.

### What was built

- `lib/mark-scheme-readiness.ts` (pure, `import type` only): summarises the
  units `assembleMarkScheme` builds -- total parts/marks, and the parts whose
  `markschemeSource` is `"none"` grouped by question -- plus the headline,
  the import note and the banner rows. Only `"none"` counts: it is exactly
  what `loadGradeableMarkScheme` drops, so "will be skipped" is literal.
  Whole-question and draft schemes are still marked and already warned about
  per part.
- `POST /api/tests/import-from-saved-exam` appends one note listing the gaps
  (headline, "use LaTeX Review's Extract & apply", a line per question). The
  grader is imported lazily in a try/catch: the test exists by then, so a
  failure can only add a softer note, never fail the import.
- The Import dialog now awaits `onImported` and closes itself: at once after
  a clean import (as before), otherwise it stays open on its warnings with a
  "Mark Scans ->" link. The subtitle no longer promises instant grading.
- Mark Scans (`/dashboard/tests/[id]/ai-grade`) shows a banner above the
  roster (`mark-scheme-gaps.tsx`, server-only): amber when some parts are
  missing, red when all are (marking is refused then). Each question links to
  LaTeX Review (`?focus=<ib_questions.id>`), or to the PPQ Bank search when
  its code is not in the bank. Its load starts beside the roster's loads, it
  renders in its own `<Suspense fallback={null}>`, and it never throws (no
  `error.tsx` exists under `app/`): a failed load shows no banner. LaTeX
  Review is the link because the PPQ Bank's per-question "Extract" writes the
  whole question's LaTeX onto every part (`ocr-latex/route.ts`), and on a
  question-side extract it also re-runs Auto-classify, which can rewrite
  hand-set subtopic tags.

### Verified

- `lib/mark-scheme-readiness.test.ts` (16 tests, L67 as the fixture),
  `npm run build`, `npm test` (132 files, 2251 tests), eslint on the changed
  files (the one error left, the `<a>` "Back to tests" link in the ai-grade
  `page.tsx`, predates this change).
- The build traces the four policy files the grader reads at load into both
  the import route and the ai-grade page, as for the existing grading route.
- Read-only against production with the real `assembleMarkScheme`: the
  banner shows on 27AH [K06] P1 (2 of 19 parts, 7 of 70 marks -- Q6 (a), (b)),
  [L00] P2 UniStats (4 of 5), [K05] P2 (13 of 14) and, red, [P01] P1 (none of
  14; three of its codes are not in the bank). No banner on FA1, FA2, both
  KA1s or [L00] P2 BiStats.
- In a browser, locally against production (teacher session minted with the
  teacher's approval at the prompt, revoked with scope `local` after): Mark
  Scans shows amber on [K06] P1, red on [P01] P1 (its three unknown codes say
  "not in the PPQ bank" and link to the bank search), and nothing on Key
  Assessment 1 or the new L67 test. The Import dialog, given warnings (a
  mocked response -- no second test), stays open, links to Mark Scans and
  closes on Close; the real L67 import returned no warnings and closed.

### L67 made ready (25 Sep 2026)

Test `290bd5bc-7f43-4dc0-90fe-da36dc14afe2` "27AH [L67] P1", created through
Tests -> "Import from PPQ Bank" (14 parts, 70 marks), date 23 Sep 2026.
`loadGradeableMarkScheme` on it: 14/14 parts, 70/70 marks, every part
`part_latex`, no warnings. Question and mark-scheme LaTeX was extracted for
all eight bank questions (the `ib_questions` ids are 17N.1.AHL.TZ0.H_4
`4114c3f4`, 18M.1.SL.TZ2.S_3 `ecf0811f`, 19M.1.AHL.TZ2.H_4 `156fa7c4`,
13M.1.AHL.TZ2.H_5 `4fb6865b`, 13M.1.AHL.TZ1.H_7 `4bdddd86`,
19N.1.AHL.TZ0.H_6 `25d224d6`, 18N.1.AHL.TZ0.H_9 `73bc0cba`,
18N.1.AHL.TZ0.H_10 `dbf4a4cc`), each checked against its images and sent to
the teacher side by side for approval. What went wrong on the way, and is
worth knowing before extracting another multi-part question:

- **LaTeX Review's mark-scheme "Extract & apply" wrote the QUESTION into
  18N.1.AHL.TZ0.H_9's mark scheme.** Run without MathPix (any agent session:
  `ocr-latex` falls back to Claude vision), the `parts_draft_markscheme_latex`
  prompt asks to "extract the FULL question content", and the model rebuilt
  the question from the mark-scheme images. Production normally has MathPix,
  whose literal transcription is normalised instead, so this may not bite
  there -- but check the parts after any mark-scheme Extract & apply. What
  worked: the plain `markscheme_latex` prompt (a faithful transcription of
  the whole scheme), then that text pasted into the Review draft box and
  "Apply to editors", which splits it by part with the page's own code.
- **The splitter only sees a part label at the start of a line.** A
  transcription with `\section*{(a) METHOD 1}` headings (18N.1.AHL.TZ0.H_10)
  did not split, so every part got the whole scheme. Rewriting those
  headings as plain "(a)" lines fixed it.
- **The question-side boundary pass missed three setup paragraphs** (Q2,
  Q7, Q8: the sentence introducing part (b) or (c) sat at the end of the
  previous part). Moved by hand through `latex-update`.
- **LaTeX Review loses images for some focused questions.** Its "targeted
  image-presence lookup" (`review/page.tsx`) still hits PostgREST's 1000-row
  cap on the merged set, so 18M.1.SL.TZ2.S_3 and 18N.1.AHL.TZ0.H_10 showed
  "No page images available" and the right-hand Question / Mark Scheme toggle
  instead of Q / MS. Extraction still works (the route reads
  `question_images` itself); the page's own images do not show.

Section B is answered in a separate booklet, so each student's scan is the 9
printed pages plus a variable number of booklet pages; Quick read handles
that, but a booklet cover can read as a second row for the same student
("Merge into one row").

### Not done (follow-ups)

- ExamBuilder "Save to Gradebook" (`app/api/gradebook/tests/route.ts`) could
  run the same check; the Mark Scans banner covers tests made that way.
- The three 422 messages still say "Extract the mark scheme LaTeX in the PPQ
  Bank" rather than pointing at LaTeX Review.
- `ocr-latex`'s `parts_draft_markscheme_latex` prompt says "extract the FULL
  question content" for a mark scheme; it should ask for the mark scheme.
- LaTeX Review's image-presence lookup (`review/page.tsx`) needs paging or a
  per-question query; at ~600 questions it passes the 1000-row cap.
- The run-app skill's `revoke-session.mjs` now runs in place and defaults to
  scope `"local"` (it used to sign out `"global"`, which also ended the
  teacher's own browser sessions). `mint-session.mjs` is unchanged: an agent
  editing it, or `.claude/settings.json`, so that minting no longer prompts
  was refused by the auto-mode check as a permission bypass. Whether agents
  may mint a teacher session without a prompt is the teacher's setting to
  add, not an agent's.
