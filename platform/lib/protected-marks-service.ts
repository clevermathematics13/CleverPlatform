import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./na-scanning";

/**
 * Server-side lookups for the ClevMark protection rule (lib/protected-marks.ts).
 *
 * Both helpers throw when a read fails. The routes that call them treat that
 * as "could not check" and write nothing: saving without knowing would risk
 * exactly the unreported decrease the rule forbids.
 */

/** Bounds every `.in()` list, which PostgREST sends inline in the URL. */
const ITEM_CHUNK = 40;
const STUDENT_CHUNK = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chunked = <T,>(values: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
};

/**
 * Which of these students have a self-assessment on file for the test: any
 * student_self_scores row on any of its parts (see lib/protected-marks.ts for
 * why any row counts). Ids that are not account ids -- the "invited-..."
 * subjects of imported students who have not signed in -- are skipped, since
 * those students cannot self-assess.
 */
export async function selfAssessedStudentIds(
  supabase: SupabaseClient,
  testId: string,
  studentIds: readonly string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  const ids = [...new Set(studentIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0) return found;

  const { data: items, error: itemsErr } = await supabase.from("test_items").select("id").eq("test_id", testId);
  if (itemsErr) throw new Error(itemsErr.message);
  const itemIds = (items ?? []).map((row: { id: string }) => row.id);
  if (itemIds.length === 0) return found;

  for (const itemChunk of chunked(itemIds, ITEM_CHUNK)) {
    for (const studentChunk of chunked(ids, STUDENT_CHUNK)) {
      const rows = await fetchAllRows<{ student_id: string }>((from, to) =>
        supabase
          .from("student_self_scores")
          .select("student_id")
          .in("test_item_id", itemChunk)
          .in("student_id", studentChunk)
          // Paging without a fixed order can skip rows between pages.
          .order("id", { ascending: true })
          .range(from, to)
      );
      for (const row of rows) found.add(row.student_id);
    }
  }
  return found;
}

export interface MarkProtection {
  /** Whether this student has self-assessed the test this part belongs to. */
  isSelfAssessed(studentId: string, testItemId: string): boolean;
}

/**
 * Protection for a set of (part, student) cells that may span several tests,
 * as a gradebook paste can. A part that cannot be found belongs to no test and
 * reads as unprotected, which mirrors the trigger: a mark whose part is gone
 * is being deleted along with it.
 */
export async function loadMarkProtection(
  supabase: SupabaseClient,
  cells: readonly { testItemId: string; studentId: string }[]
): Promise<MarkProtection> {
  const profileCells = cells.filter((c) => UUID.test(c.studentId));
  const testIdByItem = new Map<string, string>();
  const itemIds = [...new Set(profileCells.map((c) => c.testItemId))];

  for (const itemChunk of chunked(itemIds, ITEM_CHUNK)) {
    const { data, error } = await supabase.from("test_items").select("id, test_id").in("id", itemChunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { id: string; test_id: string }[]) testIdByItem.set(row.id, row.test_id);
  }

  const studentsByTest = new Map<string, Set<string>>();
  for (const c of profileCells) {
    const testId = testIdByItem.get(c.testItemId);
    if (!testId) continue;
    if (!studentsByTest.has(testId)) studentsByTest.set(testId, new Set());
    studentsByTest.get(testId)!.add(c.studentId);
  }

  const selfAssessedByTest = new Map<string, Set<string>>();
  for (const [testId, students] of studentsByTest) {
    selfAssessedByTest.set(testId, await selfAssessedStudentIds(supabase, testId, [...students]));
  }

  return {
    isSelfAssessed(studentId: string, testItemId: string): boolean {
      const testId = testIdByItem.get(testItemId);
      if (!testId) return false;
      return selfAssessedByTest.get(testId)?.has(studentId) ?? false;
    },
  };
}
