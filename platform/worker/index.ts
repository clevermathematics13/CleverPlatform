import { randomUUID } from "node:crypto";
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

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...args);
}

async function main() {
  log(`Starting bulk-upload worker (concurrency=${WORKER_CONCURRENCY})`);
  const supabase = createWorkerClient();
  const anthropic = createWorkerAnthropicClient();

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
      pipelineRunning = false;
    }
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
      assessPollRunning = false;
    }
  };

  setInterval(runPipelineTick, PIPELINE_INTERVAL_MS);
  setInterval(runAssessPollTick, ASSESS_POLL_INTERVAL_MS);
  await runPipelineTick();
  await runAssessPollTick();
}

main().catch((e) => {
  console.error("Fatal error starting bulk-upload worker:", e);
  process.exit(1);
});
