# Bulk-upload background worker — deployment

A long-running Node process that claims `na_scan_batches` rows queued by the
bulk-upload UI (`na-review/scan-test`'s multi-file picker) and drives each
through segment → split → crop → submit-for-assessment unattended, with the
assessment stage submitted as an Anthropic Message Batch (50% cheaper,
polled separately — see `assess-poll.ts`). It exists because none of
Vercel's serverless functions can run longer than 300s, and this pipeline
needs to run for however long it takes, with nobody watching a browser tab.

**Nothing here changes the existing single-PDF upload flow.** `handleUpload`
and every existing `app/api/na-review/*` route are untouched — this worker
only ever touches rows created by the bulk-upload endpoint
(`POST /api/na-review/batch/bulk`), which start at `status: 'queued'`. If
this worker is never deployed, the app behaves exactly as it does today.

## What it needs

Same Supabase project and Anthropic account as the main app, plus the same
CV service the existing crop route already depends on:

| Env var | Same value as |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel project env |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel project env (service role, bypasses RLS — this is a trusted backend process, not a teacher session) |
| `ANTHROPIC_API_KEY` | Vercel project env |
| `GRAPH_LAB_CV_SERVICE_URL` | Vercel project env — the existing CV service |
| `CV_SERVICE_SECRET` | Vercel project env |

The image must also contain `feedback_voice/` (and, defensively,
`grading_policies/`) — `lib/na-assessment.ts` reads the feedback voice guide at
module init and throws if it is missing. Failure signature: the container
restarts on boot, `na_scan_batches` rows stay in `status: 'queued'` forever, and
the logs show a thrown path ending in `na_student_feedback_voice.md`. Note that
`npm run worker:dev` will NOT reproduce it — that runs with cwd `platform/`,
where the file is present regardless; only building the image can.

Optional tuning (sane defaults if unset):

| Env var | Default | Purpose |
|---|---|---|
| `WORKER_CONCURRENCY` | `3` | How many `na_scan_batches` rows are claimed and processed in parallel at each stage. Kept conservative by default since this account's actual per-minute Anthropic rate-limit tier is unverified, and stage 1 (segmentation) is the one stage here still making synchronous Anthropic calls. |
| `WORKER_PIPELINE_INTERVAL_MS` | `15000` | How often the claim/process loop ticks. |
| `WORKER_ASSESS_POLL_INTERVAL_MS` | `180000` | How often open Anthropic Message Batches are checked. Kept much longer than the pipeline interval since Batch API turnaround is measured in minutes to hours, not seconds — polling faster just burns API calls for no benefit. |
| `WORKER_ID` | a random id | Recorded on `na_scan_batches.claimed_by` for whichever row this worker last claimed; only useful for debugging which instance touched what. |

## Local smoke test before deploying

```bash
cd platform
npm run worker:dev
```

Runs the worker against whatever `NEXT_PUBLIC_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` are in your shell env (or
`.env.local`, loaded automatically by `next dev` but NOT by `tsx` — export
them yourself, or use `dotenv -e .env.local -- npm run worker:dev`). With
nothing in `status: 'queued'`, it should just log a start line and sit idle;
insert one manually-queued test row to see it actually process something.
**Do this against real data with real caution** — this repo has no staging
environment, so a local smoke test with a deliberately-inserted test row is
the safest way to validate the worker before it ever touches a teacher's
real bulk upload.

## Deploying (Railway)

Same pattern as `cv-service/DEPLOYMENT.md`, as a **second, separate**
Railway service in the same project:

```bash
cd platform
docker build -f worker/Dockerfile -t cleverplatform-worker .
docker run --rm \
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e ANTHROPIC_API_KEY=... \
  -e GRAPH_LAB_CV_SERVICE_URL=... \
  -e CV_SERVICE_SECRET=... \
  cleverplatform-worker
```

On Railway: point at this repo, root directory `platform/`, Dockerfile path
`worker/Dockerfile`. Unlike the CV service, this process has **no HTTP
endpoint and needs no exposed port** — it's a pure background loop, so skip
Railway's networking/domain setup for it entirely.

**This step (actually creating the Railway service) has not been done as
part of writing this code** — provisioning a new hosted service is a real
account action outside what an agent session can safely do unattended.
Follow the steps above once ready to deploy for real.

## Rollout safety

Per the plan this shipped under: deploy this worker and validate it against
1-2 manually-inserted `queued` rows (a one-off script using
`SUPABASE_SERVICE_ROLE_KEY`, same precedent as `scripts/*.mjs`) *before* the
bulk-upload UI is used for anything real. At that point the worker changes
nothing about the live app, since nothing feeds it `queued` rows yet. Once
validated, the UI's bulk-upload cap (see `MAX_BULK_UPLOAD` in
`scan-test-client.tsx`) should stay low (a handful of files) for a first
real pilot before raising it toward 50.
