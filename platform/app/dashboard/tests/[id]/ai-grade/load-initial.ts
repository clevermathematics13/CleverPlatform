import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadAiGradeOverview,
  loadTestAbsences,
  type AiGradeOverviewResult,
  type TestAbsencesResult,
} from "@/lib/ai-grade-overview";
import { buildRosterOptions, deriveOverviewState } from "@/lib/ai-grade-review";
import { loadCourseRoster } from "@/lib/course-roster";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import type { AiGradeInitial, RunRow, TestDetail } from "./ai-grade-client";

/**
 * The AI-grade roster, loaded on the server so the page's first HTML already
 * shows it. Before this, the page arrived with "Loading this assessment..."
 * and only asked for the roster once its JavaScript had downloaded and
 * started: four requests to four routes, each signing the teacher in again.
 *
 * Every load here is the one the matching route runs (GET /api/students,
 * /api/tests/[id]/ai-grade and /api/tests/[id]/absences), and the client's
 * loadOverview derives its state with the same functions
 * (buildRosterOptions, deriveOverviewState), so the first render and every
 * refresh after it agree.
 */

/** The loads that need only the test id, started before the test row is read. */
export interface AiGradeInitialLoads {
  overview: Promise<AiGradeOverviewResult>;
  absences: Promise<TestAbsencesResult>;
  /** The teacher's "show hidden students" setting; null if it could not be read. */
  showHidden: Promise<boolean | null>;
}

const failed = (e: unknown) => ({
  ok: false as const,
  status: 500 as const,
  error: e instanceof Error ? e.message : String(e),
});

/**
 * Starts the loads that do not need the test row, so they run while the page
 * reads it rather than after. None of them ever rejects: the page may still
 * decide the test does not exist and stop without awaiting them.
 */
export function startAiGradeInitialLoads(
  supabase: SupabaseClient,
  testId: string,
  teacherId: string
): AiGradeInitialLoads {
  return {
    overview: loadAiGradeOverview(supabase, testId).catch(failed),
    absences: loadTestAbsences(supabase, testId).catch(failed),
    showHidden: getShowHiddenStudents(supabase, teacherId).catch(() => null),
  };
}

/**
 * The client's initial state, or null when a load it cannot do without
 * fails. The client then loads the roster itself, exactly as it did before
 * this existed -- with the same error messages, in the same order.
 *
 * Never throws. It renders behind the page's Suspense boundary, and with no
 * error boundary under the dashboard a throw there would replace the whole
 * page with the app's error screen; anything unexpected (a row shape nothing
 * here anticipated) falls back to the client's own load instead.
 */
export async function loadAiGradeInitial(
  supabase: SupabaseClient,
  test: TestDetail,
  loads: AiGradeInitialLoads
): Promise<AiGradeInitial | null> {
  try {
    return await buildInitial(supabase, test, loads);
  } catch {
    return null;
  }
}

async function buildInitial(
  supabase: SupabaseClient,
  test: TestDetail,
  loads: AiGradeInitialLoads
): Promise<AiGradeInitial | null> {
  if (!test.course_id) return null;
  const showHidden = await loads.showHidden;
  if (showHidden === null) return null;
  const [roster, overview, absences] = await Promise.all([
    // includeTrackSiblings, as the client asks for it: a Grade 9 test is
    // attached to one class (9G) but the scanned pile mixes every class in
    // its track (9A, 9C, 9G), so the roster pools them all.
    loadCourseRoster(supabase, test.course_id, {
      showHidden,
      includeInvited: true,
      includeTrackSiblings: true,
    }).catch(failed),
    loads.overview,
    loads.absences,
  ]);
  if (!roster.ok || !overview.ok) return null;

  // Each student's newest complete run and newer attempt, not every run the
  // test has had: that is all the roster shows, and a class re-marked a few
  // times has several times as many.
  const state = deriveOverviewState(overview.runs as RunRow[], overview.results);
  return {
    test,
    students: buildRosterOptions(roster.students, test.course_id),
    runsByStudent: state.runsByStudent,
    newerAttemptByStudent: state.newerAttemptByStudent,
    acceptanceByRun: state.acceptanceByRun,
    clevMarksByRun: state.clevMarksByRun,
    submittedStudentCount: state.submittedStudentCount,
    outstandingCollectCount: state.outstandingCollectCount,
    // Best-effort, as in the client: a failed read means nobody shows as
    // absent, not that the roster cannot be shown.
    absentStudentIds: absences.ok ? absences.absences.map((a) => a.studentId) : [],
    unmarkedFromBatches: overview.unmarked,
  };
}
