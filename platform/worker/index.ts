import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createWorkerClient } from "./db";
import { createWorkerAnthropicClient } from "./anthropic-client";
import { runPipelinePass } from "./pipeline";
import { pollAssessmentBatches } from "./assess-poll";

/**
 * Entry point for the bulk-upload background worker. A long-running Node
 * process (deployed on Railway, alongside the existing CV service -- see
 * Dockerfile and README.md in this directory) rather than a Vercel
 * serverless function, because this pipeline's whole reason for existing is
 * to run without any of Vercel's 60-300s function-duration caps and without
 * a browser tab staying open. Ties together two independently-paced loops:
 *
 *  - the pipeline loop (claim queued/split/cropped na_scan_batches rows and
 *    drive them through segment -> split -> crop -> submit-for-assessment),
 *    which makes synchronous Anthropic calls for stage 1 and so runs
 *    fairly often but at bounded concurrency;
 *  - the assessment-batch poll loop (check Anthropic Message Batches
 *    submitted by the pipeline loop, write results once they're ready),
 *    which makes no synchronous Anthropic calls at all and can safely run
 *    on a much longer interval since Batch API turnaround is measured in
 *    minutes to hours, not seconds.
 */

const WORKER_ID = process.env.WORKER_ID?.trim() || `worker-${randomUUID().slice(0, 8)}`;
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 3);
const PIPELINE_INTERVAL_MS = Math.max(5_000, Number(process.env.WORKER_PIPELINE_INTERVAL_MS) || 15_000);
const ASSESS_POLL_INTERVAL_MS = Math.max(30_000, Number(process.env.WORKER_ASSESS_POLL_INTERVAL_MS) || 180_000);

/**
 * The worker does no HTTP work, but it still listens. Railway reports "no
 * open ports detected" for a process that never binds one, a health check
 * configured against the service can never pass, and there is no way to ask
 * the thing whether it is alive short of reading its logs. One socket fixes
 * all three, and costs nothing: GET anything returns the same small JSON.
 *
 * PORT is whatever Railway injects; the fallback only matters locally.
 */
const PORT = Math.max(1, Number(process.env.PORT) || 8080);

const STARTED_AT = new Date();

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...args);
}

function uptimeSeconds(): number {
  return Math.round((Date.now() - STARTED_AT.getTime()) / 1000);
}

/**
 * Nothing in this process signals itself, so a signal arriving means the
 * platform stopped the container -- a redeploy, a failing health check, a
 * sleep policy, an account limit. That was invisible before: the container
 * died leaving only npm's "signal SIGTERM" line, which reads like a crash
 * and sent one investigation looking for a bug that was never there. Saying
 * it plainly, with the uptime, is what tells the next reader which of the
 * two happened.
 */
function installSignalHandlers(stop: () => void) {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(
      `received ${signal} after ${uptimeSeconds()}s of uptime -- the platform stopped this ` +
        `container, it did not crash. Check the service's deploy, health-check, sleep and ` +
        `usage-limit settings. Shutting down.`
    );
    stop();
    // Exit 0: a container the platform asked to stop has not failed, and
    // reporting failure invites a restart policy to fight the platform.
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main() {
  log(`Starting bulk-upload worker (concurrency=${WORKER_CONCURRENCY})`);
  // Logged so a misconfigured service is visible in the first two lines of
  // its own log rather than inferred from behaviour hours later.
  log(
    `config: pipeline=${PIPELINE_INTERVAL_MS}ms assessPoll=${ASSESS_POLL_INTERVAL_MS}ms ` +
      `port=${PORT}${process.env.PORT ? "" : " (PORT unset, using the local default)"}`
  );
  let status: "starting" | "running" | "failed" = "starting";
  let fatalError: string | null = null;
  let lastPipelineTickAt: string | null = null;
  let lastAssessPollAt: string | null = null;

  // Bound BEFORE the clients are built, deliberately. Every way this worker
  // can fail to start is a missing or misnamed environment variable, and
  // this repo has already lost a day to one (GRADING_ANTHROPIC_API_KEY set
  // where the code reads ANTHROPIC_API_KEY -- see docs/HANDOFF.md). Exiting
  // on that turns the reason into a single log line inside a restart loop;
  // answering 503 with the message keeps it readable from a browser for as
  // long as the mistake lasts.
  const health = createServer((_req, res) => {
    const body = {
      service: "bulk-upload-worker",
      status,
      workerId: WORKER_ID,
      startedAt: STARTED_AT.toISOString(),
      uptimeSeconds: uptimeSeconds(),
      lastPipelineTickAt,
      lastAssessPollAt,
      error: fatalError,
    };
    res.writeHead(status === "failed" ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => health.listen(PORT, resolve));
  log(`health endpoint listening on ${PORT}`);

  let supabase: ReturnType<typeof createWorkerClient>;
  let anthropic;
  try {
    supabase = createWorkerClient();
    anthropic = createWorkerAnthropicClient();
  } catch (e) {
    // Not rethrown: see the comment above. The process stays up so the
    // endpoint can keep saying what is wrong.
    status = "failed";
    fatalError = e instanceof Error ? e.message : String(e);
    log(`cannot start: ${fatalError}`);
    log("staying up so /health can report this; fix the variable and redeploy.");
    installSignalHandlers(() => health.close());
    return;
  }
  status = "running";

  let pipelineRunning = false;
  let assessPollRunning = false;

  const runPipelineTick = async () => {
    if (pipelineRunning) return; // don't overlap a slow pass with the next timer tick
    pipelineRunning = true;
    try {
      const summary = await runPipelinePass(supabase, anthropic, WORKER_ID, WORKER_CONCURRENCY);
      if (summary.claimed || summary.split || summary.needsReview || summary.cropped || summary.assessSubmitted || summary.failed) {
        log("pipeline pass:", summary);
      }
    } catch (e) {
      log("pipeline pass threw (will retry next tick):", e instanceof Error ? e.message : e);
    } finally {
      lastPipelineTickAt = new Date().toISOString();
      pipelineRunning = false;
    }
    // After the pass, and unconditionally: the point of the heartbeat is
    // that it is written whether or not there was anything to do. A worker
    // with an empty queue writes nothing else at all, which is exactly why
    // ten days of silence could not be told apart from ten days of being
    // dead. Failures here are logged and dropped -- a heartbeat that could
    // not be recorded must never take down the pass that just succeeded.
    const { error: beatErr } = await supabase.from("worker_heartbeats").upsert(
      {
        worker_id: WORKER_ID,
        service: "bulk-upload-worker",
        started_at: STARTED_AT.toISOString(),
        last_seen_at: new Date().toISOString(),
        detail: {
          uptimeSeconds: uptimeSeconds(),
          concurrency: WORKER_CONCURRENCY,
          pipelineIntervalMs: PIPELINE_INTERVAL_MS,
          assessPollIntervalMs: ASSESS_POLL_INTERVAL_MS,
          lastAssessPollAt,
        },
      },
      { onConflict: "worker_id" }
    );
    if (beatErr) log("heartbeat write failed (ignored):", beatErr.message);
  };

  const runAssessPollTick = async () => {
    if (assessPollRunning) return;
    assessPollRunning = true;
    try {
      const summary = await pollAssessmentBatches(supabase, anthropic);
      if (summary.checked > 0) log("assessment batch poll:", summary);
    } catch (e) {
      log("assessment batch poll threw (will retry next tick):", e instanceof Error ? e.message : e);
    } finally {
      lastAssessPollAt = new Date().toISOString();
      assessPollRunning = false;
    }
  };

  const pipelineTimer = setInterval(runPipelineTick, PIPELINE_INTERVAL_MS);
  const assessTimer = setInterval(runAssessPollTick, ASSESS_POLL_INTERVAL_MS);
  installSignalHandlers(() => {
    clearInterval(pipelineTimer);
    clearInterval(assessTimer);
    health.close();
  });

  await runPipelineTick();
  await runAssessPollTick();
}

main().catch((e) => {
  console.error("Fatal error starting bulk-upload worker:", e);
  process.exit(1);
});
