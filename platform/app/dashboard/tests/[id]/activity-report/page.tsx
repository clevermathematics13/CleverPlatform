import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { loadActivityReportData } from "@/lib/activity-report-data";
import { ACTIVITY_OUTCOMES, activityOutcomeLabel } from "@/lib/activity-rubric";
import { OutcomeChip } from "@/components/ActivityReportTable";

/**
 * The class's learning targets for a Math Medic Exploration or a homework.
 *
 * What the route exists to produce: for each learning target, how many
 * students have it and who does not, so the teacher knows what to teach. The
 * tally at the top is the part that changes tomorrow's lesson; the per-student
 * grid below it is who to sit with.
 *
 * There is deliberately no total, no percentage and no grade anywhere on this
 * page. Outcomes come from accepted marks only -- a student whose activity is
 * half marked shows a faded, provisional outcome.
 */
export default async function ActivityReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireTeacher();
  const { id } = await params;

  const supabase = await createClient();
  const showHidden = await getShowHiddenStudents(supabase, profile.id);
  const loaded = await loadActivityReportData(supabase, id, { showHidden });

  if (!loaded.ok && loaded.status === 404) notFound();
  if (!loaded.ok) {
    return (
      <div className="max-w-5xl">
        <a href={`/dashboard/tests/${id}`} className="text-sm text-blue-300 hover:underline">
          ← Back to the activity
        </a>
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
          {loaded.error}
        </div>
      </div>
    );
  }

  const { test, rubric, rows, tallies, classCount, complete } = loaded.data;
  const present = rows.filter((r) => !r.absent);
  const kindLabel = rubric.kind === "exploration" ? "Exploration" : "Homework";

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <a href={`/dashboard/tests/${id}`} className="text-sm text-blue-300 hover:underline">
          ← Back to the activity
        </a>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          {kindLabel}
          {rubric.lesson ? ` · Lesson ${rubric.lesson}` : ""}
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">{test.name}</h1>
        <p className="mt-1 text-sm text-da-muted">
          Where the class is on each learning target, from Clev&apos;s Marks.
          {rubric.kind === "exploration"
            ? " This was sat before the lesson, so Not yet is an expected answer, not a bad one."
            : ""}
          {!complete && " Some activities are not fully marked yet — those outcomes are faded and provisional."}
        </p>
      </div>

      {/* ---- The tally: what to teach ----------------------------------- */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Where the class is</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                <th className="px-3 py-2 font-semibold">Learning target</th>
                {ACTIVITY_OUTCOMES.map((o) => (
                  <th key={o.value} className="px-3 py-2 text-center font-semibold">
                    {o.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold">Not marked</th>
              </tr>
            </thead>
            <tbody>
              {tallies.map((t, i) => {
                const target = rubric.targets[i];
                return (
                  <tr key={t.code} className="border-b border-da-border/50 align-top">
                    <td className="px-3 py-2 text-da-text">
                      <span className="font-semibold">{t.code}</span> {t.name}
                      {target?.note && <span className="block text-xs text-da-muted">{target.note}</span>}
                    </td>
                    {ACTIVITY_OUTCOMES.map((o) => (
                      <td key={o.value} className="px-3 py-2 text-center">
                        <span className={t[o.value] > 0 ? "text-da-text" : "text-da-muted"}>{t[o.value]}</span>
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center text-da-muted">{t.unmarked}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-da-muted">
          {present.length} student{present.length === 1 ? "" : "s"} on the roster
          {rows.length - present.length > 0 ? `, ${rows.length - present.length} away` : ""}.
        </p>
      </section>

      {/* ---- Per student ------------------------------------------------ */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold text-da-text">Every student</h2>
          <a
            href={`/api/tests/${id}/activity-report/csv`}
            className="text-sm text-blue-300 hover:underline"
          >
            Download CSV
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                <th className="px-3 py-2 font-semibold">Student</th>
                {classCount > 1 && <th className="px-3 py-2 font-semibold">Class</th>}
                {rubric.targets.map((t) => (
                  <th key={t.code} className="px-3 py-2 font-semibold" title={t.name}>
                    {t.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.subjectId}>
                  <tr className="border-b border-da-border/50">
                    <td className="px-3 py-2 text-da-text">{row.name}</td>
                    {classCount > 1 && <td className="px-3 py-2 text-xs text-da-muted">{row.className ?? ""}</td>}
                    {row.report.targets.map((t) => (
                      <td key={t.code} className="px-3 py-2">
                        {row.absent ? (
                          <span className="text-xs text-da-muted">Away</span>
                        ) : (
                          <OutcomeChip
                            outcome={t.outcome}
                            provisional={t.markedParts > 0 && t.markedParts < t.totalParts}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-da-muted">
          {ACTIVITY_OUTCOMES.map((o) => activityOutcomeLabel(o.value)).join(" · ")}. A faded chip means not
          every part behind that target is marked yet.
        </p>
      </section>
    </div>
  );
}
