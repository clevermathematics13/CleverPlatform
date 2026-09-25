import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITED_SUBJECT_PREFIX, formatGradingSubject, parseGradingSubject } from "@/lib/grading-subject";
import {
  clevMarksBySubjectFrom,
  latestRunsByStudent,
  sumClevMarks,
  type AcceptanceRef,
  type ClevMarkRow,
  type ClevMarksSummary,
} from "@/lib/ai-grade-review";
import { fetchAllRows } from "@/lib/na-scanning";
import { findUnmarkedBatchStudents, type SplitBatchRef, type UnmarkedBatchStudent } from "@/lib/batch-unmarked";

/**
 * What the AI-grade roster loads for a whole test, from anywhere on the
 * server: every grading run, the acceptance rows it counts, and who was
 * absent. GET /api/tests/[id]/ai-grade (without studentId) and
 * GET /api/tests/[id]/absences serve exactly these, and the AI-grade page
 * calls them directly so its roster is in the first HTML instead of fetched
 * after the page's JavaScript starts. One loader for both is what keeps the
 * server-rendered roster and a later client refresh from disagreeing.
 */

/** The ai_grade_runs columns the review UI reads. */
export const AI_GRADE_RUN_COLUMNS =
  "id, test_id, student_id, invited_student_id, status, model, source_storage_path, coverage, error, created_at, completed_at, pending_message_batch_id";

/** One ai_grade_runs row as the review UI reads it. */
export interface AiGradeRunRow {
  id: string;
  test_id: string;
  student_id: string | null;
  invited_student_id: string | null;
  status: string;
  model: string | null;
  source_storage_path: string | null;
  coverage: unknown;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  /**
   * The Anthropic message batch a run is still tied to, or null once it is
   * settled. Served to the review UI because a 'running' run that still
   * carries one is a run the collect route left for a later sweep to promote
   * (its results were written, its own status update was lost) -- the page
   * has to keep polling collect for it, and 'running' alone cannot say so.
   */
  pending_message_batch_id: string | null;
}

export type AiGradeOverviewResult =
  | {
      ok: true;
      runs: AiGradeRunRow[];
      results: AcceptanceRef[];
      /** Students a batch scan was confirmed for who have no run at all (lib/batch-unmarked.ts). */
      unmarked: UnmarkedBatchStudent[];
      /**
       * What ClevMarks holds on the test per student, keyed by subject id --
       * the roster's "ClevMarks 41/50" beside the AI's total. Empty when
       * nobody has a completed run, or when ClevMarks could not be read.
       */
      clevMarks: Record<string, ClevMarksSummary>;
    }
  | { ok: false; status: 500; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Every run of the test, newest first, with student_id collapsed to the
 * opaque subject id (see formatGradingSubject), { run_id, accepted } for
 * each subject's newest complete run -- the acceptance counts the roster
 * shows, and nothing else -- and each subject's ClevMarks total on the test.
 *
 * The runs are not capped. Overnight marking creates one run per student on
 * every click, so a class that has been re-marked a few times passes 100 runs
 * within a term (60 on one test already, 5 Sep 2026) -- and .limit(100)
 * dropped the oldest ones with no error, so those students read as never
 * graded on the page that is the only record of their marking.
 *
 * The results are the roster's only need from them. They used to be every
 * result row of every run the test had ever had, crops signed and PPQ images
 * attached, counted over a fraction of them: on Key Assessment 1 (23 Sep
 * 2026) that was 18,119 rows in a 20 MB response to count 1,752, and the
 * page sat on "Loading this assessment..." for over half a minute. So only
 * the runs the page will show are counted -- chosen by latestRunsByStudent,
 * the same function the page uses -- and only these two columns are sent.
 */
export async function loadAiGradeOverview(
  supabase: SupabaseClient,
  testId: string
): Promise<AiGradeOverviewResult> {
  let rawRuns: AiGradeRunRow[];
  try {
    rawRuns = await fetchAllRows<AiGradeRunRow>((from, to) =>
      supabase
        .from("ai_grade_runs")
        .select(AI_GRADE_RUN_COLUMNS)
        .eq("test_id", testId)
        // id breaks created_at ties: one overnight submission inserts a whole
        // class in a single statement, so those runs share a created_at to the
        // microsecond and paging on it alone would repeat and skip rows.
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    return { ok: false, status: 500, error: message(e) };
  }
  // Collapse student_id/invited_student_id back into the one opaque subject
  // id every caller already keys its state by (see parseGradingSubject) --
  // the review UI never needs to know which column a run's identity lives in.
  const runs = rawRuns.map((r) => ({ ...r, student_id: formatGradingSubject(r) }));
  // Started now so it runs alongside the acceptance read below.
  const unmarkedLoad = loadUnmarkedBatchStudents(supabase, testId, runs);
  if (runs.length === 0) return { ok: true, runs: [], results: [], unmarked: await unmarkedLoad, clevMarks: {} };

  const latestIds = Object.values(latestRunsByStudent(runs).latestComplete).map((r) => r.id);
  if (latestIds.length === 0) return { ok: true, runs, results: [], unmarked: await unmarkedLoad, clevMarks: {} };
  // Started now so it runs alongside the acceptance read below.
  const clevMarksLoad = loadClevMarks(supabase, testId);
  try {
    // Still paged: the newest runs alone pass PostgREST's 1000-row cap on a
    // big class (49 runs x 36 parts on Key Assessment 1).
    const results = await fetchAllRows<AcceptanceRef>((from, to) =>
      supabase
        .from("ai_grade_results")
        .select("run_id, accepted")
        .in("run_id", latestIds)
        .order("id", { ascending: true })
        .range(from, to)
    );
    return { ok: true, runs, results, unmarked: await unmarkedLoad, clevMarks: await clevMarksLoad };
  } catch (e) {
    return { ok: false, status: 500, error: message(e) };
  }
}

/**
 * What ClevMarks holds on the test for each student, over every part of the
 * test -- not only the parts in a run: see clevMarksBySubjectFrom.
 *
 * Paged like the gradebook's read of the same table: one assessment for a
 * 50-student track is ~1,800 marks, past PostgREST's silent 1000-row cap.
 *
 * Best-effort: empty when either read fails, which leaves the figure off the
 * roster rather than stopping it loading -- the same footing as the absences
 * and the unmarked-batch flags. Never rejects.
 */
async function loadClevMarks(supabase: SupabaseClient, testId: string): Promise<Record<string, ClevMarksSummary>> {
  try {
    const { data: items, error } = await supabase.from("test_items").select("id").eq("test_id", testId);
    if (error) return {};
    const itemIds = (items ?? []).map((i) => i.id as string);
    if (itemIds.length === 0) return {};
    const marks = await fetchAllRows<ClevMarkRow>((from, to) =>
      supabase
        .from("student_marks")
        .select("test_item_id, student_id, invited_student_id, marks_awarded")
        .in("test_item_id", itemIds)
        .order("id", { ascending: true })
        .range(from, to)
    );
    return clevMarksBySubjectFrom(marks);
  } catch {
    return {};
  }
}

/**
 * What ClevMarks holds on the test for one student (`studentId` the opaque
 * subject id): each part's mark, which the review panel's boxes start from,
 * and the whole test's total, which is their roster line's ClevMarks figure
 * -- the same figure loadClevMarks gives the roster for everyone, so an
 * accept made in the panel can move it without reloading the class. Read
 * over every part of the test, like loadClevMarks, not only the parts in
 * the student's runs.
 *
 * Null when a read fails; the panel then starts its boxes from the
 * suggestions, as it always did when this read came back empty. Never
 * rejects.
 */
export async function loadStudentClevMarks(
  supabase: SupabaseClient,
  testId: string,
  studentId: string
): Promise<{ byItem: Map<string, number>; summary: ClevMarksSummary } | null> {
  try {
    const { data: items, error: itemsErr } = await supabase.from("test_items").select("id").eq("test_id", testId);
    if (itemsErr) return null;
    const itemIds = (items ?? []).map((i) => i.id as string);
    if (itemIds.length === 0) return { byItem: new Map(), summary: { total: 0, marked: 0 } };
    const subject = parseGradingSubject(studentId);
    const marksQuery = supabase.from("student_marks").select("test_item_id, marks_awarded").in("test_item_id", itemIds);
    const { data: marks, error } = await (subject.kind === "invited"
      ? marksQuery.eq("invited_student_id", subject.id)
      : marksQuery.eq("student_id", subject.id));
    if (error) return null;
    const byItem = new Map<string, number>();
    for (const m of marks ?? []) {
      if (typeof m.marks_awarded === "number") byItem.set(m.test_item_id as string, m.marks_awarded);
    }
    return { byItem, summary: sumClevMarks(marks ?? []) };
  } catch {
    return null;
  }
}

/**
 * Students a batch scan was confirmed for who have no run of any kind on the
 * test (see lib/batch-unmarked.ts for why that means the flow dropped them).
 * `runs` carry the opaque subject id already.
 *
 * Best-effort: a failed read means nobody is flagged, never that the roster
 * cannot load -- the same footing as the absences beside it.
 */
async function loadUnmarkedBatchStudents(
  supabase: SupabaseClient,
  testId: string,
  runs: readonly { student_id: string | null }[]
): Promise<UnmarkedBatchStudent[]> {
  try {
    const { data: batches, error } = await supabase
      .from("ai_grade_batches")
      .select("id, file_name, status, confirmed_segments, created_at")
      .eq("test_id", testId)
      .eq("status", "split");
    if (error || !batches || batches.length === 0) return [];
    const handled = new Set(runs.map((r) => r.student_id).filter((id): id is string => !!id));
    const flagged = findUnmarkedBatchStudents(batches as SplitBatchRef[], handled);

    // Someone confirmed before their first login is an invited subject on the
    // batch; if they have signed in since, their runs sit under the profile.
    const invitedIds = flagged
      .map((u) => u.studentId)
      .filter((id) => id.startsWith(INVITED_SUBJECT_PREFIX))
      .map((id) => id.slice(INVITED_SUBJECT_PREFIX.length));
    if (invitedIds.length === 0) return flagged;
    const { data: invited } = await supabase.from("invited_students").select("id, profile_id").in("id", invitedIds);
    const sameAs = new Map(
      (invited ?? [])
        .filter((r) => !!r.profile_id)
        .map((r) => [`${INVITED_SUBJECT_PREFIX}${r.id as string}`, r.profile_id as string] as const)
    );
    return findUnmarkedBatchStudents(batches as SplitBatchRef[], handled, sameAs);
  } catch {
    return [];
  }
}

/** One absence as the roster reads it. */
export interface TestAbsence {
  /** The grader's opaque subject id (a profiles.id, or "invited-<id>"). */
  studentId: string;
  note: string | null;
  created_at: string;
}

interface AbsenceRow {
  profile_id: string | null;
  invited_student_id: string | null;
  note: string | null;
  created_at: string;
}

function subjectOf(row: AbsenceRow): string | null {
  return row.profile_id ?? (row.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${row.invited_student_id}` : null);
}

export type TestAbsencesResult =
  | { ok: true; absences: TestAbsence[] }
  | { ok: false; status: 500; error: string };

/** Who was recorded absent for the test (table test_absences). */
export async function loadTestAbsences(supabase: SupabaseClient, testId: string): Promise<TestAbsencesResult> {
  const { data, error } = await supabase
    .from("test_absences")
    .select("profile_id, invited_student_id, note, created_at")
    .eq("test_id", testId);
  if (error) return { ok: false, status: 500, error: error.message };

  const absences = ((data ?? []) as AbsenceRow[])
    .map((r) => ({ studentId: subjectOf(r), note: r.note, created_at: r.created_at }))
    .filter((r): r is TestAbsence => !!r.studentId);
  return { ok: true, absences };
}
