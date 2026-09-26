import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseStoredExplanation, type StoredExplanation } from "./mark-scheme-explanation";

/**
 * mark_scheme_explanations: one written explanation per part of a test,
 * keyed on (test_id, question_number, part_label) -- the natural key
 * test_items is unique on, which survives a creator re-save that recreates
 * the items with new ids.
 *
 * Teachers read and write the rows of tests they own. Students have no
 * policy at all: the server reads rows for them with the service role, and
 * only after its own gates (the test is released to them, their class has
 * sat it, its scheme is the platform's page -- attachStudentMarkScheme and
 * the mark-scheme page). A row policy cannot express the per-class sitting
 * date, and an explanation carries every answer on the paper.
 */

/**
 * The service-role client for reading explanations on a student's behalf,
 * or `fallback` where no service key is configured (a local run), which
 * then shows a student no explanations rather than failing. Built per call,
 * not at module scope, so `next build` never needs the key.
 */
export function explanationReader(fallback: SupabaseClient): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return fallback;
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Every stored explanation for a test, by part key. A failed read --
 * including the table not existing yet, since this code can reach
 * production before its migration does -- is an empty map: the parts show
 * the teacher's own text, as they did before explanations existed.
 */
export async function loadStoredExplanations(client: SupabaseClient, testId: string): Promise<Map<string, StoredExplanation>> {
  const stored = new Map<string, StoredExplanation>();
  try {
    const { data, error } = await client
      .from("mark_scheme_explanations")
      .select("question_number, part_label, source_hash, content, model, prompt_version, updated_at")
      .eq("test_id", testId);
    if (error) return stored;
    for (const row of data ?? []) {
      const key = `${row.question_number as number}|${(row.part_label as string | null) ?? ""}`;
      stored.set(key, {
        key,
        sourceHash: row.source_hash as string,
        content: parseStoredExplanation(row.content),
        model: row.model as string,
        promptVersion: row.prompt_version as number,
        updatedAt: row.updated_at as string,
      });
    }
  } catch {
    return new Map();
  }
  return stored;
}
