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

## When the service will not stay up

Symptom seen on 6 Sep 2026: the container starts, prints its first log line,
and is stopped 4 seconds later, leaving only `npm error signal SIGTERM`. The
CV service in the same project cycled in the same window, and the database
showed the worker had claimed nothing since 30 Aug.

Nothing in this process signals itself, so a SIGTERM is always the platform
stopping the container. Since that day the worker says so itself: it now
logs `received SIGTERM after Ns of uptime -- the platform stopped this
container, it did not crash`, and it binds `$PORT` with a `/health`
endpoint. Read those two things first.

| What you see | What it means |
|---|---|
| The `received SIGTERM` line | Railway stopped it. Nothing is wrong with this code -- work through the settings below. |
| A stack trace, no SIGTERM line | The worker itself failed. Fix the code. |
| `cannot start: <VAR> must be set`, HTTP 503 on `/health` | A missing or misnamed environment variable. The process deliberately stays up so this stays readable. |
| Nothing after `Starting bulk-upload worker` | It is running and idle. That is normal -- it only logs when it does work. |

Settings to check on the Railway service, in the order most likely to be the
cause:

1. **Usage limits and credit.** A project out of credit has its services
   stopped. This is the first thing to rule out, and it matches "both
   services cycled at once".
2. **App sleeping / serverless.** A service set to sleep when idle will be
   stopped seconds after starting, because this worker serves no traffic of
   its own. It must be off.
3. **Health check path.** If one is configured it must point at `/health` on
   `$PORT`. Before the health endpoint existed, any configured check could
   never pass and every deploy was killed.
4. **Restart policy.** `ON_FAILURE` is right. The worker now exits 0 on
   SIGTERM, so an ordinary stop no longer looks like a failure.
5. **Deploy source.** Root directory `platform`, Dockerfile path
   `worker/Dockerfile`, branch `main`.
6. **Variables.** Exactly `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   `GRAPH_LAB_CV_SERVICE_URL`, `CV_SERVICE_SECRET`. `ANTHROPIC_API_KEY` must
   be spelled exactly that -- `GRADING_ANTHROPIC_API_KEY` silently does
   nothing, and has cost a day once already.

To confirm it is alive without opening Railway at all, query the database:

```sql
select worker_id, last_seen_at, now() - last_seen_at as stale_for, started_at, detail
from public.worker_heartbeats order by last_seen_at desc;
```

Every pipeline tick rewrites that row whether or not there was work to do,
so `stale_for` under a minute means the worker is running. No rows, or a
`stale_for` of hours, means it is not. A `started_at` that keeps moving
while `last_seen_at` stays fresh is a restart loop.

Or open the service's public URL at `/health`. `status: "running"` with a recent `lastPipelineTickAt` is
a working worker; `status: "failed"` names the variable to fix.

## Rollout safety

Per the plan this shipped under: deploy this worker and validate it against
1-2 manually-inserted `queued` rows (a one-off script using
`SUPABASE_SERVICE_ROLE_KEY`, same precedent as `scripts/*.mjs`) *before* the
bulk-upload UI is used for anything real. At that point the worker changes
nothing about the live app, since nothing feeds it `queued` rows yet. Once
validated, the UI's bulk-upload cap (see `MAX_BULK_UPLOAD` in
`scan-test-client.tsx`) should stay low (a handful of files) for a first
real pilot before raising it toward 50.
