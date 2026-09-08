import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildScoreRows } from "./powerschool-rows";

/**
 * A student's number lives in two places and only one of them is filled
 * reliably: the `students` row is created on first sign-in without it, while
 * `invited_students` carries the one the teacher entered.
 *
 * Reading only the `students` row is how 9G exported seventeen rows with
 * every Score cell empty. PowerSchool then said "0 of 17 scores will be
 * imported" and could not say why -- a row with no student number is simply
 * one the template never matches, so nothing anywhere reports a problem. All
 * twelve of that class's registered students had NULL there; 9A and 9C were
 * each quietly losing one.
 *
 * The number is the same person's either way, so the builder falls back. This
 * test is that fallback, because nothing else fails when it is missing.
 */

vi.mock("@/lib/na-scanning", () => ({
  loadInvitedRoster: async () => ({
    roster: [{ invitedId: "inv-1", profileId: "prof-1", name: "Rafael Benavides" }],
    sourceCourseIds: ["course-1"],
  }),
  fetchAllRows: async () => [],
}));

vi.mock("@/lib/ai-grading", () => ({ INVITED_SUBJECT_PREFIX: "invited:" }));

/** The handful of reads buildScoreRows makes, answered from a fixture. */
function clientWhere(studentsRowNumber: string | null): SupabaseClient {
  const tables: Record<string, unknown> = {
    tests: {
      id: "test-1",
      name: "Formative Assessment 1",
      short_name: "Form1",
      test_date: "2026-08-31",
      total_marks: 41,
      boundary_set_id: null,
    },
    courses: { id: "course-1", name: "9G" },
  };

  const builder = (table: string) => {
    const rows =
      table === "students"
        ? [{ profile_id: "prof-1", student_number: studentsRowNumber, profiles: { display_name: "Rafael Benavides" } }]
        : table === "invited_students"
          ? [{ profile_id: "prof-1", student_number: "30009", id: "inv-1", full_name: "Rafael Benavides" }]
          : [];

    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "in", "not", "order", "gte", "lte", "is"]) {
      chain[m] = vi.fn(self);
    }
    chain.single = async () => ({ data: tables[table] ?? null });
    chain.maybeSingle = async () => ({ data: tables[table] ?? null });
    // Awaiting the chain itself yields the row list, the way PostgREST does.
    chain.then = (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: rows });
    return chain;
  };

  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

describe("buildScoreRows student numbers", () => {
  it("uses the students row's number when it has one", async () => {
    const built = await buildScoreRows(clientWhere("30009"), "test-1", "course-1", false);
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect(built.rows[0]?.studentNumber).toBe("30009");
  });

  // The regression. Without the fallback this comes back null, the template
  // matches nothing, and every score exports blank with no warning anywhere.
  it("falls back to the invitation's number when the students row has none", async () => {
    const built = await buildScoreRows(clientWhere(null), "test-1", "course-1", false);
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect(built.rows[0]?.studentNumber).toBe("30009");
  });
});
