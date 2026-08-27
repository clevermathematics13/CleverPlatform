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

---

## 1. What this is

A private-by-intent, single-teacher IB DP + Grade 9 MYP Mathematics platform, run by
Pablo Clevenger at https://www.clevermathematics.com. One teacher, ~17 active
students, 113 `invited_students`. No admin panel, no public signup.

**The GitHub repository is PUBLIC.** The previous handoff described the platform as
"private", which is true of the product but not of the source. See §7.

Courses: `26AH` (Y12 AA HL), `27AH` (Y11 AA HL), `9A` (`2abe4055`), `9A (2025-2026)`
(`31370a33`, archived - do not delete), `Grade 9 Extended` (`b1d3b183`, virtual, no
roster by design), `Grade 9 Standard` (virtual, no NA packets yet).

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
- **Sonnet 5 returns thinking blocks first.** Use
  `response.content.find(b => b.type === "text")`, never `content[0].text`.
- **Supabase:** `CREATE OR REPLACE FUNCTION` fails silently on return-type change -
  use `DROP` + `CREATE` as separate calls. `execute_sql` returns one result set per
  call. Use `public.set_updated_at()` (no `moddatetime`). Revoke EXECUTE from PUBLIC
  on SECURITY DEFINER functions. Dollar-quote large JSONB payloads.
- **Vercel deploy is confirmed only when `readyState: READY` AND
  `lambdaRuntimeStats` are both present.** Bare READY is insufficient.
- **CV service:** `opencv-python-headless==4.11.0.86` (no libGL on Railway),
  `pymupdf==1.24.14`, guarded by `CV_SERVICE_SECRET`.

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

**The migration ledger and the repo now agree exactly: 83 files, 83 rows,
byte-identical.** Read `platform/supabase/migrations/README.md` before touching
anything in that directory - it documents the invariant and how to add a migration
without breaking it.

History, because it matters: files `001_*`..`057_*` were never recorded in the
ledger, while ~4 months of changes applied via MCP existed only in the database. The
Supabase CLI matches `^([0-9]+)_(.*)\.sql$` - `[0-9]+`, not a 14-digit timestamp - so
`001_initial_schema.sql` parsed as version `001` and counted as pending. Several of
those files are destructive (`014_016_combined.sql` drops the seating tables;
`023_reset_aahl_students.sql` deletes student enrolment rows). Nothing was ever
applied only because `CLEVERPLATFORM_SUPABASE_DB_URL` is unset, which makes the
workflow's push step skip and exit 0 - all 23 "successful" runs were no-ops.

Those 64 files now live in `platform/supabase/migrations-legacy/` and
`--include-all` has been dropped from the workflow.

**Setting `CLEVERPLATFORM_SUPABASE_DB_URL` is safe once the reconciliation is merged
to `main`, and worthwhile - the workflow currently reports green while doing
nothing. Do not set it before that merge.**

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
| 2 | Page identity via Opus 4.5 - affine fit, NOT match-count voting |
| 3 | Pre-split oversized batches into linked chunks |
| 4 | Crop extraction via PyMuPDF at 300 DPI on the Railway CV service |
| 5 | Per-crop assessment via Sonnet 4.6, one call per crop, results in `na_feedback` |

Architecture decisions - do not reverse without understanding why: geometry is solved
once from the master PDF, not per scan; orientation is recovered via affine fit;
adaptive crop expansion happens in a single upright coordinate space after rotation;
verdict and marks are independent fields; "correct verdict must equal full marks" is
enforced in prompt and server-side; use `nuanced_analyses.parts` answer keys, not
`answer_sketch`.

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

4. Grade 9 Standard NA packets - none seeded.

**Low**

5. Full NA generation wiring for Grade 9. The generator is hardcoded to Grade 12,
   `buildActivityGeneratorSystemPrompt()` does not fetch `na_continuity`, and saves
   do not write back.

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
