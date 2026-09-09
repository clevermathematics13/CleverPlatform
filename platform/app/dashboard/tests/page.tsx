import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TestsClient } from "./tests-client";

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
        `id, name, short_name, test_date, exam_time, release_at, total_marks, course_id, hidden, hidden_from_gradebook, require_self_assessment,
         courses!tests_course_id_fkey(name),
         test_items(id, question_number, part_label, max_marks, sort_order)`
      )
      .order("test_date", { ascending: false }),
    supabase.from("courses").select("id, name").eq("archived", false).order("name"),
  ]);

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
          initialTests={(tests ?? []) as unknown as TestRow[]}
          courses={courses ?? []}
        />
      )}
    </div>
  );
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
  courses: { name: string } | null;
  test_items: {
    id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
    sort_order: number | null;
  }[];
}
