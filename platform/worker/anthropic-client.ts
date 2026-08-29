import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client for the worker, with more retry patience than the
 * interactive app routes use. Every synchronous-API app route in this repo
 * (batch/route.ts, response-crops/[cropId]/assess/route.ts) relies on the
 * SDK's default of 2 retries because a teacher is waiting on the response
 * within a 60-300s Vercel function budget. The worker has no such deadline
 * and no user watching a spinner, so it can afford to wait out a 429 or a
 * transient 5xx rather than giving up -- especially important here since
 * this pipeline still has NO Anthropic-specific rate-limit/backoff handling
 * of its own anywhere (see WORKER_CONCURRENCY in pipeline.ts for the other
 * half of that mitigation).
 */
export function createWorkerAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY must be set for the bulk-upload worker.");
  }
  return new Anthropic({ apiKey, maxRetries: 6 });
}
