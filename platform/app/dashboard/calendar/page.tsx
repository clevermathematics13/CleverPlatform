import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  SCHOOL_TIME_ZONE,
  formatAssessmentDate,
  groupAssessmentsByMonth,
  todayInTimeZone,
  type CalendarAssessment,
} from "@/lib/assessment-calendar";

/**
 * When the key assessments are, across every class.
 *
 * The dates were kept in four hand-maintained Google Classroom posts, one per
 * class, which is why nothing in the platform knew that Key Assessment 1 had
 * already been sat. This page reads them from the one place the platform
 * already stores a date -- `tests.test_date` -- so a date set on the test is
 * the date the calendar shows, with nothing to keep in step by hand.
 *
 * Key assessments only: `assessment_kind = 'summative'`. Formatives and NA
 * packets are deliberately absent -- see lib/assessment-calendar.ts.
 *
 * A key assessment with NO date is not silently missing from this page. It is
 * counted at the bottom with a link to go and set one, because a calendar that
 * quietly omits a paper is worse than one that admits it does not know when it
 * is.
 */
export default async function CalendarPage() {
  const profile = await requireTeacher();
  if (profile.role !== "teacher") redirect("/dashboard");

  const supabase = await createClient();
  const { data: tests, error } = await supabase
    .from("tests")
    .select(
      // courses!tests_course_id_fkey for the same reason the Tests page names
      // it: powerschool_export_files makes a bare `courses(name)` ambiguous.
      `id, name, test_date, total_marks, courses!tests_course_id_fkey(name)`,
    )
    .eq("assessment_kind", "summative")
    .order("test_date", { ascending: true, nullsFirst: false });

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-2xl font-bold text-blue-300">Assessment Calendar</h1>
        <div className="rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
          <p className="font-semibold">Could not load the assessment dates.</p>
          <p className="mt-1 text-red-200/90">{error.message}</p>
          <p className="mt-2 text-red-200/70">
            Your assessments are still there -- this is a problem reading them.
          </p>
        </div>
      </div>
    );
  }

  const rows = (tests ?? []) as unknown as Array<{
    id: string;
    name: string;
    test_date: string | null;
    total_marks: number | null;
    courses: { name: string } | null;
  }>;

  const dated: CalendarAssessment[] = rows
    .filter((r): r is typeof r & { test_date: string } => Boolean(r.test_date))
    .map((r) => ({
      id: r.id,
      name: r.name,
      courseName: r.courses?.name ?? "No course",
      testDate: r.test_date,
      totalMarks: r.total_marks,
    }));

  const undated = rows.filter((r) => !r.test_date);
  const today = todayInTimeZone(SCHOOL_TIME_ZONE);
  const months = groupAssessmentsByMonth(dated, today);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-blue-300">Assessment Calendar</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every key assessment with a date set, across all classes. Set a date on the
          assessment itself and it appears here.
        </p>
      </div>

      {months.length === 0 ? (
        <div className="rounded-md border border-slate-700 bg-slate-900/50 p-6 text-sm text-slate-300">
          <p className="font-semibold text-slate-200">No key assessment has a date yet.</p>
          <p className="mt-2 text-slate-400">
            Open a key assessment from{" "}
            <Link href="/dashboard/tests" className="text-blue-300 hover:underline">
              Tests
            </Link>{" "}
            and set its date. It will show up here.
          </p>
        </div>
      ) : (
        months.map((month) => (
          <section key={month.key} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {month.label}
            </h2>
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/40">
              {month.assessments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/dashboard/tests/${a.id}`}
                    className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-slate-800/60 ${
                      a.isPast ? "opacity-60" : ""
                    }`}
                  >
                    <span className="min-w-[13rem] font-semibold text-slate-100">
                      {formatAssessmentDate(a.testDate)}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-blue-300">
                      {a.courseName}
                    </span>
                    <span className="text-sm text-slate-300">{a.name}</span>
                    {a.totalMarks !== null && (
                      <span className="text-xs text-slate-500">{a.totalMarks} marks</span>
                    )}
                    <span className="ml-auto text-xs text-slate-500">{a.relative}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {undated.length > 0 && (
        <div className="rounded-md border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-medium">
            {undated.length} key assessment{undated.length === 1 ? " has" : "s have"} no date
            yet, so {undated.length === 1 ? "it is" : "they are"} not on this calendar:
          </p>
          <ul className="mt-2 space-y-1">
            {undated.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/dashboard/tests/${r.id}`}
                  className="text-amber-100 underline hover:text-amber-50"
                >
                  {r.courses?.name ?? "No course"} -- {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
