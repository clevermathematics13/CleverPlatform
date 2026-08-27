# CleverPlatform — Technical Handoff

**Supersedes the 23 Aug 2026 handoff. Last verified against production: 24 Aug 2026.**

Every figure here was checked against the live database, the live Vercel project or
the repo on the date above. Where the previous handoff was wrong, the correction is
called out inline, because two of its errors caused real mistakes in the session
that produced this file.

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
added on 24 Aug 2026). As of 27 Aug 2026: 17 packet scans (was 11), 7 of which have
a Q26(a) crop (was 0) - the backfill is progressing outside agent sessions (via the
production app, not something an agent session can drive - see §6).

`na_packet_versions.master_pdf_storage_path` for A.1 is **NULL** - the master PDF was
never stored. Anchor geometry can only be re-derived from a copy of the rendered
packet PDF; a student's split PDF is pixel-identical page content and stands in.
This is why `lib/na-anchor-locking.ts` and its lock-anchors route (below) refuse
to lock any FUTURE packet version with a null master_pdf_storage_path.

**Anchor-locking validation gate, added 27 Aug 2026.** Nothing in the codebase had
ever set `anchors_locked = true` except a one-off SQL statement run by hand for
A.1 - there was no gate at all, which is how A.1 shipped with 9 days of undetected
bugs (mark splits not summing to the question total, Q26(a) missing entirely, no
master PDF retained). `POST /api/na-review/packet-versions/[packetVersionId]/lock-
anchors` is now the only place `anchors_locked` is ever set. It refuses to lock
unless: every base question's anchors sum to its authoritative `parts[]` total,
every gradable (`marks > 0`) `parts[]` question has at least one anchor, a master
PDF is on file (or supplied in the request and uploaded there and then), and it
writes `na_rubric_items` directly from `parts[]` as part of locking rather than
leaving that as a later backfill. See `lib/na-anchor-locking.ts` for the validation
logic (unit-tested in `lib/na-anchor-locking.test.ts`, and hand-verified against
A.1's real 40-anchor/35-question data before being trusted) and why the positional
mapping against `parts[]` is safe. Nothing currently calls this route automatically
- stage 0 (anchor extraction) is still a one-off manual process, not wired
end-to-end - so this is a gate future automation must be built to call, not yet a
fully closed loop.

---

## 6. What an agent session can and cannot reach

Verified 24 Aug 2026; Storage corrected 27 Aug 2026 (was wrong - see below). This is
the single most useful thing to know before planning work.

| Capability | Status |
|---|---|
| Supabase SQL (via MCP) | Full - connects as `postgres` superuser |
| Supabase Storage | **Full**, via direct HTTPS to `qnawglgnoojrlaivylou.supabase.co/storage/v1` with `SUPABASE_SERVICE_ROLE_KEY` (present in the session env) - see correction below |
| Railway / CV service | **No access** - no connector, no CLI, egress blocked (unverified 27 Aug 2026 - not re-tested, only Storage was) |
| Vercel (via MCP) | Full - projects, deployments, logs |
| GitHub | Full, once the Claude GitHub App is installed |
| Google Drive | Read |
| Direct HTTPS to the app | **Blocked** - `clevermathematics.com` and `*.vercel.app` 403 at the gateway (re-confirmed 27 Aug 2026) |

Consequences: an agent can read and write every database row. It can also now
download from and upload to Storage directly (confirmed 27 Aug 2026 by downloading
a real 4.9MB student scan PDF and re-verified with a plain `curl` + service-role
key, not just the Supabase MCP tools) - the 24 Aug entry below claiming Storage
was blocked was wrong for this session's environment. What still cannot be done
from an agent session is anything requiring the Railway CV service (crop
extraction, stages 4/5) or the live app itself, since both remain unreachable.

**Correction (27 Aug 2026):** the previous handoff stated Storage egress 403s at
the gateway. That was tested and found false in this session: `curl` with
`Authorization`/`apikey` headers set to `$SUPABASE_SERVICE_ROLE_KEY` against
`https://qnawglgnoojrlaivylou.supabase.co/storage/v1/object/...` returned 200 and
the real file. Re-verify this in any future session rather than trusting either
version by default - egress policy can differ between environments/sessions.

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
3. **Q26(a) crop backfill.** The anchor and rubric item now exist; as of 27 Aug 2026,
   7 of 17 packet scans have a Q26(a) crop (progressing outside agent sessions, via
   the production app). Re-run stage 4 for the rest, then stage 5. Needs the CV
   service, so it cannot be done from an agent session.

**Medium**

4. Grade 9 Standard NA packets - none seeded.
5. **Wire stage 0 (anchor extraction) to call the new lock-anchors gate.**
   `POST /api/na-review/packet-versions/[packetVersionId]/lock-anchors` (added
   27 Aug 2026, see §5) enforces mark-split/coverage/master-PDF/rubric checks, but
   nothing calls it yet - anchor extraction itself is still a one-off manual
   process for A.1, not a reusable pipeline stage. Whenever that gets built, it
   should end by calling this route rather than setting `anchors_locked` directly.

**Low**

6. Full NA generation wiring for Grade 9. The generator is hardcoded to Grade 12,
   `buildActivityGeneratorSystemPrompt()` does not fetch `na_continuity`, and saves
   do not write back.

**Closed since the previous handoff**

- Migration drift - reconciled, 83/83, invariant documented.
- Q26(a) anchor - added (see below).
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
