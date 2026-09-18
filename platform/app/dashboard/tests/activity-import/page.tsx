import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { allowedActivityCourses } from "@/lib/activity-rubric";
import { ActivityImportClient } from "./activity-import-client";

/**
 * Set up a Math Medic Exploration or a homework from its two PDFs.
 *
 * A new one arrives every lesson, so instead of a hand-written seed per
 * activity the worksheet and the answer key are read into a draft
 * (POST /api/activity-assessments/extract), the teacher checks it here --
 * parts, answers, learning targets -- and saves it as a markable activity
 * (POST /api/activity-assessments).
 */
export default async function ActivityImportPage() {
  await requireTeacher();
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .eq("archived", false)
    .order("name");

  const offered = allowedActivityCourses((courses ?? []) as { id: string; name: string }[]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link href="/dashboard/tests" className="text-sm text-blue-300 hover:underline">
          ← Back to tests
        </Link>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          Exploration and homework
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">Import a Math Medic activity</h1>
        <p className="mt-1 text-sm text-da-muted">
          Upload the blank worksheet and its answer key. Clev reads both into the parts, their answers
          and the lesson&apos;s learning targets; you check every line, then save it as an activity to
          mark scans against. Nothing is saved until you press Save.
        </p>
      </div>
      {offered.length === 0 ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-5 text-sm text-amber-200">
          No class here is set up for Explorations and homework yet. The route is switched on for 9D
          while it is new; widen <code className="text-amber-100">ACTIVITY_COURSE_NAMES</code> in
          lib/activity-rubric.ts to add more.
        </p>
      ) : (
        <ActivityImportClient courses={offered} />
      )}
    </div>
  );
}
