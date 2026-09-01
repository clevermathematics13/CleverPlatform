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

### Q2 top-edge bug, 1 Sep 2026 - a NEW bug class: y0_pt excludes inline answers ABOVE the box

The teacher spotted it live in Davi Verma's released feedback ("the work being
shown here is not all Davi's work"): Q2's "See my work" panel showed only part
(e) and the ruled box, while Davi had answered ALL FIVE parts (a)-(e) inline,
correctly, next to the printed items - and the AI had graded him 2/5 against
the incomplete crop (its own margin comment even told him to "double-check
your other answers are in the right place"). Verified directly against his
split PDF, page_index 4: the printed (a)-(e) items sit at ~248-290pt and Q2's
anchor started at y0=276.48 (auto_fillrect only ever saw the ruled box below),
slicing through the (c)/(d) row. The cut-off tails of his handwriting are
literally visible at the old crop's top edge.

Every prior truncation fix in this file was about the BOTTOM/RIGHT edges
(y1_pt / expand_max_*); this is the top edge, where NO expansion mechanism
exists at all, so `possibly_truncated` structurally cannot flag it. Worse,
the 28 Aug prompt-crop backfill actively masked it: Q2's "Question, as
printed" image covered exactly the excluded band, cut from a representative
student who happened to write inside the box, so the panel showed pristine
unanswered (a)-(d) items above a crop missing the real answers - everything
LOOKED coherent. The other 6 students wrote their answers inside the box
(their transcriptions cover all five parts; three scored 5/5), which is why
only Davi's marks were visibly wrong.

**Fixed the established way, data not heuristics** (1 Sep, via MCP SQL):
Q2 anchor `da2cc841`, `y0_pt` 276.48 -> 210.0 (just below the ACTIVITY box's
printed border at ~203-207pt, measured off the page; includes the printed
header + all five items), and `prompt_crop_storage_path` cleared - the gap
above the new y0 is ~3pt, an "inside-the-box" case like Q1(e), and the old
prompt image would have duplicated content now inside the student's own crop.
Verified end-to-end for Davi: the CV service /crop call with the new geometry
returns a complete image (header, five inline answers, box; expanded=true,
possibly_truncated=false).

**NOT completed from that session - the agent environment's permission layer
allowed reads, MCP SQL, and CV-service calls but blocked production Storage
writes and the grading API call**, so the regenerated crops and re-assessment
are pending. Everything is staged in `platform/scripts/recrop-assess-q2.ts`
(committed, unlike the deleted 28 Aug one-off, precisely because the fix
couldn't be executed in-session): re-crops Q2 for the 7 live scans and
re-runs stage 5, ai_* only, idempotent, safe to re-run. Until it runs, Q2
crops still show the old truncated image and Q2 has no prompt image.

After it runs, **Davi's released Q2 needs teacher review**: his na_feedback
row has `final_marks_awarded=2` (not teacher_edited) from approve-all against
the truncated evidence; the re-assessment writes a new ai_* proposal (all
five inline answers are correct and the box names a valid feature) but, by
the stage-5 contract, never touches final_*.

**Systemic follow-up worth doing**: any anchor whose printed sub-items sit
ABOVE its detected box can hit this, and neither the truncation detector nor
`audit_anchor_geometry.py` (which measures bottom borders) can see it. A
cheap sweep: for each anchor, compare `question_text`'s enumerated parts
against where students actually write - or simply eyeball each anchor's
printed layout once per packet version for "items above the box" questions
like Q2. The prompt-crop images are the wrong place to look for this: they
can show the excluded band looking clean (see above).

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

**High (added 1 Sep 2026)**

3b. **Run `platform/scripts/recrop-assess-q2.ts`, then review Davi Verma's Q2.**
   The Q2 anchor geometry fix (§5, "Q2 top-edge bug") is applied in the DB but
   the re-crop + re-assessment couldn't be executed from the agent session
   (production Storage writes and the grading API were permission-blocked).
   Until the script runs, all 7 students' Q2 crops still show the truncated
   image and Q2 has no prompt image; afterwards, Davi's RELEASED Q2
   (`final_marks_awarded=2`, evidence now shows 5 correct parts) needs a
   teacher's re-approval through the normal review flow. Also delete the
   orphaned old prompt image
   `na-crops/1462a2f2-fc2a-4bab-8135-ed3aefeb0aff/prompts/da2cc841-379f-4496-a449-d5dc6dd4dbef.png`
   from Storage (its anchor no longer references it; same permission block).

**Medium**

4. Grade 9 Standard NA packets - none seeded.
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

6. Full NA generation wiring for Grade 9. The generator is hardcoded to Grade 12,
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
