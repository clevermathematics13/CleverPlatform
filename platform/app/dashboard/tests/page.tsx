import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TestsClient } from "./tests-client";
import { fetchAllRows } from "@/lib/na-scanning";

export default async function TestsPage() {
  const profile = await getProfile();
  if (profile.role !== "teacher") redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: tests, error: testsError }, { data: courses }] = await Promise.all([
    supabase
      .from("tests")
      .select(
        // courses!tests_course_id_fkey, not courses: powerschool_export_files
        // has a composite primary key over (course_id, test_id), so PostgREST
        // reads it as a join table and sees TWO ways to get from tests to
        // courses. A bare `courses(name)` is then ambiguous and the whole
        // query fails with PGRST201. Naming the foreign key settles it.
        `id, name, short_name, test_date, exam_time, release_at, total_marks, course_id, hidden, hidden_from_gradebook, require_self_assessment, standards_rubric, activity_rubric, boundary_set_id,
         courses!tests_course_id_fkey(name),
         test_items(id, question_number, part_label, max_marks, sort_order)`
      )
      .order("test_date", { ascending: false }),
    supabase.from("courses").select("id, name").eq("archived", false).order("name"),
  ]);

  // Each assessment's grade boundaries at a glance: decided (and when), still
  // on a shared preset, or none. Two small queries rather than an embed,
  // because tests <-> grade_boundary_sets now has two foreign keys.
  const boundaryStatus = new Map<string, BoundaryStatus>();
  const rows = (tests ?? []) as { id: string; boundary_set_id?: string | null }[];
  if (rows.length > 0) {
    const setIds = [...new Set(rows.map((t) => t.boundary_set_id).filter((x): x is string => !!x))];
    const [{ data: sets }, decisions] = await Promise.all([
      setIds.length > 0
        ? supabase.from("grade_boundary_sets").select("id, name, test_id").in("id", setIds)
        : Promise.resolve({ data: [] as { id: string; name: string; test_id: string | null }[] }),
      // Paged: every decision of every test, which passes 1000 rows in time.
      fetchAllRows<{ id: string; test_id: string; decided_at: string }>((from, to) =>
        supabase
          .from("test_boundary_decisions")
          .select("id, test_id, decided_at")
          .in("test_id", rows.map((t) => t.id))
          .order("id", { ascending: true })
          .range(from, to)
      ).catch(() => [] as { id: string; test_id: string; decided_at: string }[]),
    ]);
    const setById = new Map((sets ?? []).map((x) => [x.id as string, x]));
    const decidedAt = new Map<string, string>();
    for (const d of decisions) {
      const seen = decidedAt.get(d.test_id);
      if (!seen || d.decided_at > seen) decidedAt.set(d.test_id, d.decided_at);
    }
    for (const t of rows) {
      const set = t.boundary_set_id ? setById.get(t.boundary_set_id) : undefined;
      const when = decidedAt.get(t.id) ?? null;
      boundaryStatus.set(
        t.id,
        when && set?.test_id
          ? { kind: "decided", label: null, decidedAt: when }
          : set
          ? { kind: "preset", label: set.name as string, decidedAt: null }
          : { kind: "none", label: null, decidedAt: null }
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-blue-300">Tests</h1>
      </div>
      {/* A failed query used to arrive here as an empty array and render as
          "No tests yet. Create your first test above." -- which reads as an
          answer rather than a failure, and sent the teacher looking for tests
          they had already made. Say what happened instead. */}
      {testsError ? (
        <div className="rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
          <p className="font-semibold">Could not load your tests.</p>
          <p className="mt-1 text-red-200/90">{testsError.message}</p>
          <p className="mt-2 text-red-200/70">
            Your tests are still there -- this is a problem reading them, not a
            sign they are gone.
          </p>
        </div>
      ) : (
        <TestsClient
          initialTests={((tests ?? []) as unknown as TestRow[]).map((t) => ({
            ...t,
            boundary_status: boundaryStatus.get(t.id),
          }))}
          courses={courses ?? []}
        />
      )}
    </div>
  );
}

/** Where an assessment's grade boundaries stand, for the Tests list. */
export interface BoundaryStatus {
  kind: "decided" | "preset" | "none";
  /** The preset's name when kind is "preset". */
  label: string | null;
  decidedAt: string | null;
}

// Exported so the client can use it
export interface TestRow {
  id: string;
  name: string;
  /** Short label used in the generated PowerSchool filename, e.g. "Form1". */
  short_name: string | null;
  test_date: string | null;
  exam_time: string | null;
  release_at: string | null;
  total_marks: number | null;
  course_id: string | null;
  hidden: boolean;
  /** Omit this test's column from the gradebook grid. Not the same as `hidden`,
   *  which is about what students see. */
  hidden_from_gradebook: boolean;
  require_self_assessment: boolean;
  /** Non-null on a Grade 9 Standard Level paper (see lib/standards-rubric.ts): graded by strands into performance levels. */
  standards_rubric?: unknown;
  /** Non-null on a Math Medic Exploration or homework (see lib/activity-rubric.ts): reported as Got it / Almost / Not yet per learning target. */
  activity_rubric?: unknown;
  /** Absent for a test created in this session, which has no boundaries yet. */
  boundary_status?: BoundaryStatus;
  courses: { name: string } | null;
  test_items: {
    id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
    sort_order: number | null;
  }[];
}
