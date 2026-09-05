import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which pipeline made the call. Kept as a closed union so a spend query can
 * group on it without discovering typos the hard way.
 */
export type UsagePipeline =
  | "ai_grade"
  | "ai_regrade"
  | "ai_grade_segment"
  | "ai_grade_chunk_cover"
  | "ai_grade_blank_check"
  | "na_assess"
  | "na_assess_wide"
  | "na_assess_batch"
  | "na_cover_page";

export type UsageRefType = "ai_grade_run" | "ai_grade_result" | "ai_grade_batch" | "na_crop" | "na_scan_batch";

/** The subset of the SDK's Message.usage this cares about. Cache fields are nullable on the wire. */
export interface UsageMeters {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface RecordUsageInput {
  pipeline: UsagePipeline;
  model: string;
  usage: UsageMeters | null | undefined;
  /** True when the call went through the Message Batches API (50% rate). */
  batch?: boolean;
  ref?: { type: UsageRefType; id: string };
}

/**
 * Writes one ai_usage_log row for a completed Anthropic call.
 *
 * Fire-and-forget by design: the call it describes has already succeeded,
 * and a bookkeeping failure must never turn a good grade into a failed
 * request. Errors are logged and swallowed; a missing usage object is a
 * silent no-op. Works with either a teacher-session client (the app
 * routes -- RLS allows teacher inserts) or the service-role client (the
 * worker).
 */
export async function recordUsage(supabase: SupabaseClient, input: RecordUsageInput): Promise<void> {
  const { usage } = input;
  if (!usage) return;
  try {
    const { error } = await supabase.from("ai_usage_log").insert({
      pipeline: input.pipeline,
      model: input.model,
      input_tokens: usage.input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      batch: input.batch ?? false,
      ref_type: input.ref?.type ?? null,
      ref_id: input.ref?.id ?? null,
    });
    if (error) console.error(`[ai-usage] could not record ${input.pipeline} usage:`, error.message);
  } catch (e) {
    console.error(`[ai-usage] could not record ${input.pipeline} usage:`, e instanceof Error ? e.message : e);
  }
}
