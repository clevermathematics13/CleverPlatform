import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { loadStandardsReportData } from "@/lib/standards-report-data";
import {
  PERFORMANCE_LEVELS,
  levelRanges,
  type PerformanceLevel,
} from "@/lib/standards-rubric";
import { LevelChip } from "@/components/StandardsReportTable";

/**
 * The class's strand levels for a Grade 9 Standard Level assessment.
 *
 * What the teacher rubric's "score record" page is for, done for the whole
 * class at once from Clev's Marks: each student's marks and level per
 * strand, the overall level, and how many students sit at each level of
 * each strand. Levels come from accepted marks only -- a student whose
 * paper is half accepted shows a faded, provisional level.
 */
export default async function StandardsReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireTeacher();
  const { id } = await params;

  const supabase = await createClient();
  const showHidden = await getShowHiddenStudents(supabase, profile.id);
  const loaded = await loadStandardsReportData(supabase, id, { showHidden });

  if (!loaded.ok && loaded.status === 404) notFound();
  if (!loaded.ok) {
    return (
      <div className="max-w-5xl">
        <a href={`/dashboard/tests/${id}`} className="text-sm text-blue-300 hover:underline">
          ← Back to the assessment
        </a>
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
          {loaded.error}
        </div>
      </div>
    );
  }

  const { test, rubric, items, rows, classCount } = loaded.data;
  const totalMax = items.reduce((s, i) => s + i.max_marks, 0);

  // How many students at each level of each strand, over the students with a
  // complete set of marks -- a provisional level is not a level yet.
  const tally = (pick: (row: (typeof rows)[number]) => PerformanceLevel | null) => {
    const counts: Record<PerformanceLevel, number> = { exceeding: 0, meeting: 0, approaching: 0, beginning: 0 };
    let counted = 0;
    for (const row of rows) {
      if (row.absent || !row.report.complete) continue;
      const level = pick(row);
      if (!level) continue;
      counts[level] += 1;
      counted += 1;
    }
    return { counts, counted };
  };
  const strandTallies = rubric.strands.map((s, i) => ({
    code: s.code,
    name: s.name,
    max: rows[0]?.report.strands[i]?.max ?? 0,
    ...tally((row) => row.report.strands[i]?.level ?? null),
  }));
  const overallTally = tally((row) => row.report.overall.level);
  const marked = rows.filter((r) => !r.absent && r.report.overall.markedParts > 0).length;
  const complete = rows.filter((r) => !r.absent && r.report.complete).length;
  const absent = rows.filter((r) => r.absent).length;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <a href={`/dashboard/tests/${test.id}`} className="text-sm text-blue-300 hover:underline">
          ← Back to the assessment
        </a>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          Standards report
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">{test.name}</h1>
        <p className="mt-1 text-sm text-da-muted">
          Strand levels from Clev&apos;s Marks. {rows.length} student{rows.length === 1 ? "" : "s"} on the
          roster · {complete} fully marked · {marked - complete} partly marked · {absent} absent.
          {rubric.source ? ` Rubric: ${rubric.source}.` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/tests/${test.id}/standards-report/csv`}
            className="rounded border border-blue-400/40 bg-blue-500/15 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/25"
          >
            Download CSV
          </a>
          <a
            href={`/dashboard/tests/${test.id}/standards-stats`}
            className="rounded border border-teal-400/40 bg-teal-500/15 px-3 py-1.5 text-xs text-teal-300 hover:bg-teal-500/25"
          >
            Teacher stats →
          </a>
          <a
            href={`/dashboard/tests/${test.id}/ai-grade`}
            className="rounded border border-purple-400/40 bg-purple-500/15 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-500/25"
          >
            Mark Scans →
          </a>
        </div>
      </div>

      {/* -- Class summary ------------------------------------------------- */}
      <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Class at each level</h2>
        <p className="mt-1 text-xs text-da-muted">
          Counted over the {complete} student{complete === 1 ? "" : "s"} whose every part is marked.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-da-muted">
                <th className="px-3 py-1.5 font-semibold">Strand</th>
                <th className="px-3 py-1.5 font-semibold">Marks</th>
                {PERFORMANCE_LEVELS.map((l) => (
                  <th key={l.value} className="px-3 py-1.5 font-semibold">
                    {l.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strandTallies.map((t) => {
                const ranges = levelRanges(t.max, rubric.bands);
                return (
                  <tr key={t.code} className="border-t border-da-border/50">
                    <td className="px-3 py-1.5 text-da-text">
                      <span className="font-semibold">{t.code}</span>
                      <span className="ml-2 text-da-muted">{t.name}</span>
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-da-muted">{t.max}</td>
                    {PERFORMANCE_LEVELS.map((l) => (
                      <td key={l.value} className="px-3 py-1.5 tabular-nums text-da-text">
                        {t.counts[l.value]}
                        <span className="ml-1 text-xs text-da-muted">({ranges[l.value]})</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="border-t border-da-border">
                <td className="px-3 py-1.5 font-semibold text-da-text">Overall</td>
                <td className="px-3 py-1.5 tabular-nums text-da-muted">{totalMax}</td>
                {PERFORMANCE_LEVELS.map((l) => (
                  <td key={l.value} className="px-3 py-1.5 tabular-nums font-semibold text-da-text">
                    {overallTally.counts[l.value]}
                    <span className="ml-1 text-xs font-normal text-da-muted">
                      ({levelRanges(totalMax, rubric.bands)[l.value]})
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* -- Students -------------------------------------------------------- */}
      <section className="rounded-xl border border-da-border bg-da-surface shadow-sm">
        <div className="border-b border-da-border px-5 py-3">
          <h2 className="font-bold text-da-text">Students</h2>
          <p className="text-xs text-da-muted">
            Marks out of each strand&apos;s total, and the level. A faded level means not every part in
            that strand has been accepted yet.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-da-muted">No students are enrolled in this assessment&apos;s class.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                  <th className="px-5 py-2 font-semibold">Student</th>
                  {rubric.strands.map((s) => (
                    <th key={s.code} className="px-3 py-2 font-semibold" title={s.name}>
                      {s.code}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-semibold">Total</th>
                  <th className="px-3 py-2 font-semibold">Overall</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const classHeading =
                    classCount > 1 && (i === 0 || rows[i - 1].className !== row.className)
                      ? (row.className ?? "Other")
                      : null;
                  const r = row.report;
                  return (
                    <Fragment key={row.subjectId}>
                      {classHeading && (
                        <tr>
                          <td
                            colSpan={rubric.strands.length + 3}
                            className="bg-da-hover/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-da-muted"
                          >
                            {classHeading}
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-da-border/50 last:border-0">
                        <td className="px-5 py-2 font-medium text-da-text">
                          {row.name}
                          {row.absent && (
                            <span className="ml-2 rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                              Absent
                            </span>
                          )}
                        </td>
                        {r.strands.map((s) => (
                          <td key={s.code} className="px-3 py-2 whitespace-nowrap">
                            {row.absent ? (
                              <span className="text-xs text-da-muted">Abs</span>
                            ) : (
                              <>
                                <span className="mr-2 tabular-nums text-da-muted">
                                  {s.markedParts > 0 ? s.marks : "—"}/{s.max}
                                </span>
                                <LevelChip level={s.level} short provisional={s.markedParts > 0 && s.markedParts < s.totalParts} />
                              </>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-2 tabular-nums text-da-text">
                          {row.absent ? "" : `${r.overall.markedParts > 0 ? r.overall.marks : "—"}/${r.overall.max}`}
                        </td>
                        <td className="px-3 py-2">
                          {row.absent ? "" : (
                            <LevelChip level={r.overall.level} provisional={!r.complete && r.overall.markedParts > 0} />
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
