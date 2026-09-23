import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITED_SUBJECT_PREFIX } from "./grading-subject";
import { fetchAllRows } from "./na-scanning";

/**
 * no-attempt.ts
 * -----------------------------------------------------------------------------
 * Per-student, per-part "no attempt" flags for one test, straight from the AI
 * grader's own blank detection (ai_grade_results.work_found = false on each
 * subject's latest COMPLETE run) -- never from student_marks.
 *
 * Deliberately separate from lib/report-roster.ts, whose whole point is that
 * a report only ever says what a teacher has ACCEPTED. This is the opposite:
 * on a summative, `lib/summative-grading-gate.ts` withholds a confidently-
 * blank part from "Accept all" so a teacher opens it before it counts -- which
 * means the roster's `marks` map can stay silent about a part for a long time
 * after the AI already knows it was left blank. Teacher stats
 * (lib/standards-stats.ts) wants that signal immediately, not after the
 * accept queue is cleared, so it is loaded on the side and merged into each
 * StatsSubject as `noAttempt`, never mixed into `marks` itself.
 * -----------------------------------------------------------------------------
 */

interface RunRow {
  id: string;
  student_id: string | null;
  invited_student_id: string | null;
  created_at: string;
}

interface BlankResultRow {
  run_id: string;
  test_item_id: string;
}

/** subjectId -> the test_items.id this subject's latest complete run found no attempt on. */
export async function loadNoAttemptFlags(
  supabase: SupabaseClient,
  testId: string
): Promise<Map<string, Set<string>>> {
  const runs = await fetchAllRows<RunRow>((from, to) =>
    supabase
      .from("ai_grade_runs")
      .select("id, student_id, invited_student_id, created_at")
      .eq("test_id", testId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  // Newest run per subject, same rule accept-all and the review panel use.
  const runIdToSubject = new Map<string, string>();
  const seenSubjects = new Set<string>();
  for (const r of runs) {
    const subjectId = r.student_id ?? (r.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${r.invited_student_id}` : null);
    if (!subjectId || seenSubjects.has(subjectId)) continue;
    seenSubjects.add(subjectId);
    runIdToSubject.set(r.id, subjectId);
  }

  const runIds = [...runIdToSubject.keys()];
  const bySubject = new Map<string, Set<string>>();
  if (runIds.length === 0) return bySubject;

  const blanks = await fetchAllRows<BlankResultRow>((from, to) =>
    supabase
      .from("ai_grade_results")
      .select("run_id, test_item_id")
      .in("run_id", runIds)
      .eq("work_found", false)
      .order("id", { ascending: true })
      .range(from, to)
  );

  for (const b of blanks) {
    const subjectId = runIdToSubject.get(b.run_id);
    if (!subjectId) continue;
    let set = bySubject.get(subjectId);
    if (!set) {
      set = new Set();
      bySubject.set(subjectId, set);
    }
    set.add(b.test_item_id);
  }
  return bySubject;
}
