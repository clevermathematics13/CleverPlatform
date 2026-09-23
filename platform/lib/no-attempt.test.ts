import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNoAttemptFlags } from "./no-attempt";

/** A fake client whose two tables answer from fixed row lists, PostgREST-style. */
function clientWith(
  runs: { id: string; student_id: string | null; invited_student_id: string | null; created_at: string }[],
  blanks: { run_id: string; test_item_id: string }[]
): SupabaseClient {
  const rowsByTable: Record<string, unknown[]> = { ai_grade_runs: runs, ai_grade_results: blanks };
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "in", "order", "range"]) chain[m] = vi.fn(self);
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rowsByTable[table] ?? [], error: null });
    return chain;
  };
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

describe("loadNoAttemptFlags", () => {
  it("keys blank parts by subject, from each subject's newest complete run", async () => {
    const client = clientWith(
      [
        { id: "run-1", student_id: "p1", invited_student_id: null, created_at: "2026-09-01T00:00:00Z" },
        { id: "run-2", student_id: null, invited_student_id: "inv-1", created_at: "2026-09-01T00:05:00Z" },
      ],
      [
        { run_id: "run-1", test_item_id: "item-1a" },
        { run_id: "run-2", test_item_id: "item-2b" },
      ]
    );
    const flags = await loadNoAttemptFlags(client, "test-1");
    expect([...flags.get("p1")!]).toEqual(["item-1a"]);
    expect([...flags.get("invited-inv-1")!]).toEqual(["item-2b"]);
  });

  it("uses only the newest complete run per subject, ignoring an older one's blanks", async () => {
    const client = clientWith(
      [
        // Newest first, as the real query orders it.
        { id: "run-new", student_id: "p1", invited_student_id: null, created_at: "2026-09-02T00:00:00Z" },
        { id: "run-old", student_id: "p1", invited_student_id: null, created_at: "2026-09-01T00:00:00Z" },
      ],
      [
        // The new run marked 1a with real work; only the OLD run flagged it blank.
        { run_id: "run-old", test_item_id: "item-1a" },
      ]
    );
    const flags = await loadNoAttemptFlags(client, "test-1");
    // The stale blank from the superseded run must not surface.
    expect(flags.get("p1")).toBeUndefined();
  });

  it("returns an empty map when nobody has a complete run", async () => {
    const client = clientWith([], []);
    const flags = await loadNoAttemptFlags(client, "test-1");
    expect(flags.size).toBe(0);
  });
});
