import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import {
  ALL_CLASSES_SCOPE,
  loadStandardsStatsData,
  type StatsScopeOption,
} from "@/lib/standards-stats-data";
import { MIN_STUDENTS_FOR_DISCRIMINATION, type PartStat } from "@/lib/standards-stats";
import { PERFORMANCE_LEVELS } from "@/lib/standards-rubric";
import { DistributionMeter, ScoreMeter } from "@/components/StandardsStatsMeters";

/**
 * Class statistics for a Grade 9 Standard Level assessment.
 *
 * The standards report next door answers "where is each student"; this page
 * answers "where is the CLASS" -- the average for each question, for each
 * part inside it, and for each strand, plus the handful of parts worth
 * looking at before the next lesson.
 *
 * The scope switcher at the top is the general Standard Level view: 9D on
 * its own is the default (it is the class the paper hangs off), and "All
 * Standard Level" pools every class that sat it, including any whose work
 * was marked without that class being on the paper's track.
 *
 * Everything is from Clev's Marks -- accepted marks only -- and a part
 * nobody has accepted yet is absent from the averages rather than counted
 * as a zero, which is why every figure carries the number of students it is
 * over.
 */

/**
 * A tile's figure, where a whole number reads better bare: "21/42", not
 * "21.0/42".
 */
const num = (v: number, dp = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(dp));
/**
 * A figure inside a COLUMN of figures, where the opposite is true: a bare
 * "1" among 0.80 and 1.20 breaks the decimal point the eye is scanning down.
 */
const dp1 = (v: number) => v.toFixed(1);
const dp2 = (v: number) => v.toFixed(2);
const pct = (v: number) => `${Math.round(v)}%`;

function scopeHref(testId: string, key: string) {
  return key === ALL_CLASSES_SCOPE
    ? `/dashboard/tests/${testId}/standards-stats?scope=${ALL_CLASSES_SCOPE}`
    : `/dashboard/tests/${testId}/standards-stats?scope=${encodeURIComponent(key)}`;
}

/** A headline figure: big number, small caption. Not a chart, on purpose. */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-da-border bg-da-hover/40 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-da-muted">{label}</p>
      <p className="mt-0.5 font-serif text-2xl font-bold tabular-nums text-da-text">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-da-muted">{hint}</p>}
    </div>
  );
}

/** "Q3(b) 24%" as an inline chip, for the highlight lists. */
function PartChip({ part, figure }: { part: PartStat; figure: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-da-border bg-da-hover/60 px-2 py-0.5 text-xs text-da-text"
      title={`${part.label}${part.strandCode ? ` - strand ${part.strandCode}` : ""} - ${part.n} student${
        part.n === 1 ? "" : "s"
      } marked`}
    >
      <span className="font-medium">{part.label}</span>
      <span className="tabular-nums text-da-muted">{figure}</span>
    </span>
  );
}

export default async function StandardsStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const profile = await requireTeacher();
  const { id } = await params;
  const { scope: requestedScope } = await searchParams;

  const supabase = await createClient();
  const showHidden = await getShowHiddenStudents(supabase, profile.id);
  const loaded = await loadStandardsStatsData(supabase, id, {
    showHidden,
    scope: requestedScope ?? null,
  });

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

  const { test, rubric, stats, highlights, scope, scopeOptions, roster } = loaded.data;
  const { paper } = stats;
  const nothingMarked = paper.attempted === 0;

  const th = "px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-da-muted";
  const td = "px-3 py-1.5 text-da-text";

  return (
    <div className="max-w-6xl space-y-6">
      {/* -- Header and scope ------------------------------------------------ */}
      <div>
        <a href={`/dashboard/tests/${test.id}`} className="text-sm text-blue-300 hover:underline">
          ← Back to the assessment
        </a>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          Teacher stats
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">{test.name}</h1>
        <p className="mt-1 text-sm text-da-muted">
          Class averages from ClevMarks, by question and by part.
          {test.testDate ? ` Sat ${test.testDate}.` : ""} {roster.total} student
          {roster.total === 1 ? "" : "s"} in scope · {roster.marked} with marks · {roster.complete} fully
          marked · {roster.absent} absent.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-da-muted">Showing</span>
          {scopeOptions.map((option: StatsScopeOption) => {
            const active = option.key === scope.key;
            return (
              <a
                key={option.key}
                href={scopeHref(test.id, option.key)}
                aria-current={active ? "page" : undefined}
                className={`rounded border px-2.5 py-1 text-xs ${
                  active
                    ? "border-teal-400/50 bg-teal-500/20 font-medium text-teal-200"
                    : "border-da-border bg-da-hover/40 text-da-muted hover:text-da-text"
                }`}
                title={`${option.students} student${option.students === 1 ? "" : "s"}, ${
                  option.marked
                } with marks`}
              >
                {option.label}
                <span className="ml-1.5 tabular-nums opacity-70">{option.marked}</span>
              </a>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/tests/${test.id}/standards-stats/csv?scope=${encodeURIComponent(scope.key)}`}
            className="rounded border border-blue-400/40 bg-blue-500/15 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/25"
          >
            Download CSV
          </a>
          <a
            href={`/dashboard/tests/${test.id}/standards-report`}
            className="rounded border border-teal-400/40 bg-teal-500/15 px-3 py-1.5 text-xs text-teal-300 hover:bg-teal-500/25"
          >
            Per-student standards report →
          </a>
          <a
            href={`/dashboard/tests/${test.id}/ai-grade`}
            className="rounded border border-purple-400/40 bg-purple-500/15 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-500/25"
          >
            Mark Scans →
          </a>
        </div>
      </div>

      {nothingMarked ? (
        <div className="rounded-xl border border-da-border bg-da-surface p-5 text-sm text-da-muted">
          Nobody in this scope has an accepted mark on this paper yet, so there is nothing to average.
          Mark and accept some scans and this page fills in.
        </div>
      ) : (
        <>
          {/* -- The paper ---------------------------------------------------- */}
          <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
            <h2 className="font-bold text-da-text">The paper</h2>
            <p className="mt-1 text-xs text-da-muted">
              Over the {paper.n} student{paper.n === 1 ? "" : "s"} whose every part is marked.
              {paper.attempted > paper.n &&
                ` ${paper.attempted - paper.n} more ${
                  paper.attempted - paper.n === 1 ? "paper is" : "papers are"
                } part-marked and left out of these totals.`}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile
                label="Mean"
                value={`${num(paper.mean)}/${paper.max}`}
                hint={pct(paper.meanPercent)}
              />
              <StatTile label="Median" value={`${num(paper.median)}/${paper.max}`} />
              <StatTile label="Spread (SD)" value={num(paper.sd)} hint="marks either side of the mean" />
              <StatTile label="Range" value={`${paper.lowest}–${paper.highest}`} hint="lowest to highest" />
              <StatTile
                label="Students"
                value={String(paper.n)}
                hint={`of ${roster.total} in scope`}
              />
            </div>
            {rubric && paper.n > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {PERFORMANCE_LEVELS.map((l) => (
                  <span
                    key={l.value}
                    className="rounded border border-da-border bg-da-hover/50 px-2.5 py-1 text-xs text-da-text"
                  >
                    {l.label}
                    <span className="ml-1.5 font-semibold tabular-nums">
                      {paper.levelCounts[l.value]}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* -- Per class, on the general view -------------------------------- */}
          {stats.classes.length > 0 && (
            <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
              <h2 className="font-bold text-da-text">By class</h2>
              <p className="mt-1 text-xs text-da-muted">
                Each class&apos;s mean over its own fully marked papers. Small groups move a long way on
                one paper, so read the student count beside every mean.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Class</th>
                      <th className={th}>Students</th>
                      <th className={th}>Mean</th>
                      <th className={th}>Mean %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.classes.map((c) => (
                      <tr key={c.className ?? "other"} className="border-t border-da-border/50">
                        <td className={`${td} font-medium`}>{c.className ?? "Other"}</td>
                        <td className={`${td} tabular-nums text-da-muted`}>{c.n}</td>
                        <td className={`${td} tabular-nums`}>
                          {dp1(c.mean)}/{c.max}
                        </td>
                        <td className={td}>
                          <span className="mr-2 tabular-nums">{pct(c.meanPercent)}</span>
                          <ScoreMeter
                            percent={c.meanPercent}
                            title={`${c.className ?? "Other"}: ${pct(c.meanPercent)}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* -- Worth a look -------------------------------------------------- */}
          <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
            <h2 className="font-bold text-da-text">Worth a look</h2>
            <p className="mt-1 text-xs text-da-muted">
              Picked out of the tables below. A part needs at least three students marked before it
              appears here.
            </p>
            <dl className="mt-3 space-y-3 text-sm">
              {highlights.weakestQuestion && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                    Weakest question
                  </dt>
                  <dd className="mt-1 text-da-text">
                    {highlights.weakestQuestion.label} at {pct(highlights.weakestQuestion.meanPercent)}
                    <span className="text-da-muted">
                      {" "}
                      ({dp1(highlights.weakestQuestion.mean)}/{highlights.weakestQuestion.max}, over{" "}
                      {highlights.weakestQuestion.n} student
                      {highlights.weakestQuestion.n === 1 ? "" : "s"})
                    </span>
                  </dd>
                </div>
              )}
              {highlights.weakestStrand && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                    Weakest strand
                  </dt>
                  <dd className="mt-1 text-da-text">
                    {highlights.weakestStrand.code} {highlights.weakestStrand.name} at{" "}
                    {pct(highlights.weakestStrand.meanPercent)}
                    <span className="text-da-muted">
                      {" "}
                      ({dp1(highlights.weakestStrand.mean)}/{highlights.weakestStrand.max})
                    </span>
                  </dd>
                </div>
              )}
              {highlights.hardestParts.length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                    Hardest parts
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {highlights.hardestParts.map((p) => (
                      <PartChip key={p.itemId} part={p} figure={pct(p.meanPercent)} />
                    ))}
                  </dd>
                </div>
              )}
              {highlights.wholeClassStuck.length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                    Half the class or more scored nothing
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {highlights.wholeClassStuck.map((p) => (
                      <PartChip key={p.itemId} part={p} figure={`${pct(p.zeroPercent)} at 0`} />
                    ))}
                  </dd>
                </div>
              )}
              {highlights.negativeDiscrimination.length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                    Stronger students did worse here
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {highlights.negativeDiscrimination.map((p) => (
                      <PartChip key={p.itemId} part={p} figure={dp2(p.discrimination ?? 0)} />
                    ))}
                    <span className="w-full text-xs text-da-muted">
                      Usually the part or its mark scheme is asking for something other than what it
                      means. Worth re-reading before the next paper.
                    </span>
                  </dd>
                </div>
              )}
              {highlights.easiestParts.length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                    Best answered
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {highlights.easiestParts.map((p) => (
                      <PartChip key={p.itemId} part={p} figure={pct(p.meanPercent)} />
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* -- By question, with its parts underneath ------------------------ */}
          <section className="rounded-xl border border-da-border bg-da-surface shadow-sm">
            <div className="border-b border-da-border px-5 py-3">
              <h2 className="font-bold text-da-text">By question, and by part</h2>
              <p className="text-xs text-da-muted">
                A question&apos;s mean is over the students with every one of its parts marked; a
                part&apos;s is over everyone marked on that part, so the two counts can differ.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-da-border">
                    <th className={th}>Question / part</th>
                    <th className={th}>Strand</th>
                    <th className={th}>Max</th>
                    <th className={th}>n</th>
                    <th className={th}>Mean</th>
                    <th className={th}>Mean %</th>
                    <th className={th} title="How the marks fell: nothing, some, all">
                      0 / part / full
                    </th>
                    <th className={th}>Full</th>
                    <th className={th}>Zero</th>
                    <th
                      className={th}
                      title="This part's mark against the rest of the paper. High means the students who did well overall did well here; negative means the opposite, and is worth a look."
                    >
                      Sorts the class
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.questions.map((q) => (
                    <Fragment key={q.questionNumber}>
                      <tr className="border-t border-da-border bg-da-hover/30">
                        <td className={`${td} font-semibold`}>
                          {q.label}
                          <span className="ml-2 text-xs font-normal text-da-muted">
                            {q.parts.length} part{q.parts.length === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td className={`${td} text-xs text-da-muted`}>{q.strandCodes.join(", ") || "—"}</td>
                        <td className={`${td} tabular-nums font-semibold`}>{q.max}</td>
                        <td className={`${td} tabular-nums text-da-muted`}>{q.n}</td>
                        <td className={`${td} tabular-nums font-semibold`}>{q.n > 0 ? dp1(q.mean) : "—"}</td>
                        <td className={td}>
                          {q.n > 0 ? (
                            <span className="flex items-center gap-2">
                              <span className="w-9 tabular-nums font-semibold">{pct(q.meanPercent)}</span>
                              <ScoreMeter
                                percent={q.meanPercent}
                                title={`${q.label}: ${dp1(q.mean)} of ${q.max} on average (${pct(
                                  q.meanPercent
                                )}), over ${q.n} student${q.n === 1 ? "" : "s"}`}
                              />
                            </span>
                          ) : (
                            <span className="text-xs text-da-muted">—</span>
                          )}
                        </td>
                        <td className={td} colSpan={4}>
                          <span className="text-xs text-da-muted">
                            {q.n > 0 ? `median ${dp1(q.median)} · SD ${dp1(q.sd)}` : ""}
                          </span>
                        </td>
                      </tr>
                      {q.parts.map((p) => (
                        <tr key={p.itemId} className="border-t border-da-border/40">
                          <td className={`${td} pl-8 text-da-muted`}>{p.label}</td>
                          <td className={`${td} text-xs text-da-muted`}>{p.strandCode ?? "—"}</td>
                          <td className={`${td} tabular-nums text-da-muted`}>{p.max}</td>
                          <td className={`${td} tabular-nums text-da-muted`}>{p.n}</td>
                          <td className={`${td} tabular-nums`}>{p.n > 0 ? dp2(p.mean) : "—"}</td>
                          <td className={td}>
                            {p.n > 0 ? (
                              <span className="flex items-center gap-2">
                                <span className="w-9 tabular-nums">{pct(p.meanPercent)}</span>
                                <ScoreMeter
                                  percent={p.meanPercent}
                                  title={`${p.label}: ${dp2(p.mean)} of ${p.max} on average (${pct(
                                    p.meanPercent
                                  )}), over ${p.n} student${p.n === 1 ? "" : "s"}`}
                                />
                              </span>
                            ) : (
                              <span className="text-xs text-da-muted">—</span>
                            )}
                          </td>
                          <td className={td}>
                            <DistributionMeter
                              zero={p.zeroMarks}
                              partial={p.n - p.zeroMarks - p.fullMarks}
                              full={p.fullMarks}
                              total={p.n}
                              label={`${p.label}: ${p.zeroMarks} scored nothing, ${
                                p.n - p.zeroMarks - p.fullMarks
                              } scored part of the marks, ${p.fullMarks} scored all ${p.max}`}
                            />
                          </td>
                          <td className={`${td} tabular-nums text-da-muted`}>
                            {p.n > 0 ? pct(p.fullPercent) : "—"}
                          </td>
                          <td className={`${td} tabular-nums text-da-muted`}>
                            {p.n > 0 ? pct(p.zeroPercent) : "—"}
                          </td>
                          <td className={`${td} tabular-nums`}>
                            {p.discrimination === null ? (
                              <span
                                className="text-xs text-da-muted"
                                title={
                                  paper.n < MIN_STUDENTS_FOR_DISCRIMINATION
                                    ? `Needs ${MIN_STUDENTS_FOR_DISCRIMINATION} fully marked papers; there ${
                                        paper.n === 1 ? "is" : "are"
                                      } ${paper.n}`
                                    : "Every student scored the same here, so this part cannot sort the class"
                                }
                              >
                                —
                              </span>
                            ) : (
                              <span className={p.discrimination < 0 ? "text-amber-300" : ""}>
                                {dp2(p.discrimination)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* -- By strand ------------------------------------------------------ */}
          {stats.strands.length > 0 ? (
            <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
              <h2 className="font-bold text-da-text">By strand</h2>
              <p className="mt-1 text-xs text-da-muted">
                The rubric&apos;s own grouping. The level counts are the same numbers the standards
                report shows, over the students with every part of that strand marked.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Strand</th>
                      <th className={th}>Max</th>
                      <th className={th}>n</th>
                      <th className={th}>Mean</th>
                      <th className={th}>Mean %</th>
                      {PERFORMANCE_LEVELS.map((l) => (
                        <th key={l.value} className={th} title={l.label}>
                          {l.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.strands.map((s) => (
                      <tr key={s.code} className="border-t border-da-border/50">
                        <td className={td}>
                          <span className="font-semibold">{s.code}</span>
                          <span className="ml-2 text-da-muted">{s.name}</span>
                        </td>
                        <td className={`${td} tabular-nums text-da-muted`}>{s.max}</td>
                        <td className={`${td} tabular-nums text-da-muted`}>{s.n}</td>
                        <td className={`${td} tabular-nums`}>{s.n > 0 ? dp1(s.mean) : "—"}</td>
                        <td className={td}>
                          {s.n > 0 ? (
                            <span className="flex items-center gap-2">
                              <span className="w-9 tabular-nums">{pct(s.meanPercent)}</span>
                              <ScoreMeter
                                percent={s.meanPercent}
                                title={`Strand ${s.code}: ${dp1(s.mean)} of ${s.max} on average (${pct(
                                  s.meanPercent
                                )}), over ${s.n} student${s.n === 1 ? "" : "s"}`}
                              />
                            </span>
                          ) : (
                            <span className="text-xs text-da-muted">—</span>
                          )}
                        </td>
                        {PERFORMANCE_LEVELS.map((l) => (
                          <td key={l.value} className={`${td} tabular-nums text-da-muted`}>
                            {s.levelCounts[l.value]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="text-xs text-da-muted">
              This assessment has no standards rubric, so there are no strands or levels to report --
              the question and part averages above are unaffected.
            </p>
          )}
        </>
      )}
    </div>
  );
}
