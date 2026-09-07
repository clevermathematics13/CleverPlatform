"use client";

import React, { useState, useCallback } from "react";
import {
  resolveGrade,
  pctToGradeFallback,
  type GradeBoundary,
} from "@/lib/grade-bands";

export type { GradeBoundary };

// --- Types --------------------------------------------------------------------

export type TestItem = {
  id: string;
  question_number: number;
  part_label: string;
  max_marks: number;
  sort_order: number;
  question_code: string | null;
};

// A single grade threshold row from grade_boundaries table

export type Test = {
  id: string;
  name: string;
  test_date: string | null;
  total_marks: number;
  component: "P1" | "P2" | "P3" | "IA" | null;
  // null when no boundary set has been assigned to this test
  boundary_set_name: string | null;  // e.g. 'A', 'B', 'C', 'D'
  boundaries: GradeBoundary[] | null; // sorted grade 1→7, null if unassigned
  items: TestItem[];
};

export type Student = {
  profile_id: string;
  name: string;
};

type MarksState = Record<string, Record<string, number | null>>;
// marks[testItemId][profileId] = marksAwarded | null

// --- Grade helpers -------------------------------------------------------------

const COMPONENTS = ["P1", "P2", "P3", "IA"] as const;

function gradeColor(grade: number | null): string {
  if (grade === null) return "text-da-muted";
  if (grade === 7) return "text-emerald-400";
  if (grade === 6) return "text-green-400";
  if (grade === 5) return "text-lime-400";
  if (grade === 4) return "text-yellow-400";
  if (grade === 3) return "text-orange-400";
  if (grade === 2) return "text-red-400";
  return "text-red-300";
}

function gradeBg(grade: number | null): string {
  if (grade === null) return "";
  if (grade === 7) return "bg-emerald-950/30";
  if (grade === 6) return "bg-green-950/30";
  if (grade === 5) return "bg-lime-950/30";
  if (grade === 4) return "bg-yellow-950/30";
  if (grade === 3) return "bg-orange-950/30";
  if (grade === 2) return "bg-red-950/30";
  return "bg-red-950/50";
}

/** Stronger tint than gradeBg(), for the distribution bars where the fill is
 *  carrying the meaning rather than just shading a cell. */
function gradeBarBg(grade: number): string {
  if (grade === 7) return "bg-emerald-500/30";
  if (grade === 6) return "bg-green-500/30";
  if (grade === 5) return "bg-lime-500/30";
  if (grade === 4) return "bg-yellow-500/30";
  if (grade === 3) return "bg-orange-500/30";
  if (grade === 2) return "bg-red-500/30";
  return "bg-red-400/30";
}

const LEVELS = [7, 6, 5, 4, 3, 2, 1] as const;

/** How many students sit at each level in one column of grades. Ungraded
 *  students are counted in `total` but not in any level, so the bars read as a
 *  share of the work actually marked. */
function tallyLevels(grades: (number | null)[]): {
  counts: Record<number, number>;
  graded: number;
  total: number;
} {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  let graded = 0;
  for (const g of grades) {
    if (g === null) continue;
    counts[g] = (counts[g] ?? 0) + 1;
    graded++;
  }
  return { counts, graded, total: grades.length };
}

function computeTestScore(
  profileId: string,
  test: Test,
  marks: MarksState
): { grade: number | null; earned: number; pct: number | null } {
  let earned = 0;
  let hasAny = false;
  for (const item of test.items) {
    const m = marks[item.id]?.[profileId];
    if (m !== null && m !== undefined) {
      earned += m;
      hasAny = true;
    }
  }
  if (!hasAny || test.total_marks <= 0) {
    return { grade: null, earned: 0, pct: null };
  }
  const pct = (earned / test.total_marks) * 100;
  return { grade: resolveGrade(pct, test.boundaries), earned, pct };
}

function computeComponentGrade(
  profileId: string,
  component: "P1" | "P2" | "P3" | "IA",
  tests: Test[],
  marks: MarksState
): number | null {
  const compTests = tests.filter((t) => t.component === component);
  if (compTests.length === 0) return null;
  let totalEarned = 0;
  let totalPossible = 0;
  let hasAny = false;
  for (const test of compTests) {
    const { earned, pct } = computeTestScore(profileId, test, marks);
    if (pct !== null) {
      totalEarned += earned;
      totalPossible += test.total_marks;
      hasAny = true;
    }
  }
  if (!hasAny || totalPossible === 0) return null;
  // For component aggregates we use fallback (no single boundary set applies)
  return pctToGradeFallback((totalEarned / totalPossible) * 100);
}

// IB standard: Section A = Q1–8, Section B = Q9+
const SECTION_A_MAX_Q = 8;

/** Columns an expanded test occupies: one per item, plus the Sec A and Sec B
 *  pairs when those sections exist. Shared by the "Abs" cell and the footer so
 *  the two cannot drift out of alignment with the header. */
function expandedTestSpan(test: Test): number {
  return (
    Math.max(1, test.items.length) +
    (test.items.some((i) => i.question_number <= SECTION_A_MAX_Q) ? 2 : 0) +
    (test.items.some((i) => i.question_number > SECTION_A_MAX_Q) ? 2 : 0)
  );
}

interface SectionScore {
  earned: number;
  max: number;
  pct: number | null;
}

function computeSectionScores(
  profileId: string,
  test: Test,
  marks: MarksState
): { secA: SectionScore | null; secB: SectionScore | null } {
  const score = (items: TestItem[]): SectionScore | null => {
    if (items.length === 0) return null;
    let earned = 0;
    let max = 0;
    let hasAny = false;
    for (const item of items) {
      max += item.max_marks;
      const m = marks[item.id]?.[profileId];
      if (m !== null && m !== undefined) {
        earned += m;
        hasAny = true;
      }
    }
    return { earned, max, pct: hasAny && max > 0 ? (earned / max) * 100 : null };
  };
  return {
    secA: score(test.items.filter((i) => i.question_number <= SECTION_A_MAX_Q)),
    secB: score(test.items.filter((i) => i.question_number > SECTION_A_MAX_Q)),
  };
}

function computeOverallGrade(
  profileId: string,
  tests: Test[],
  marks: MarksState
): { grade: number | null; pct: number | null } {
  let totalEarned = 0;
  let totalPossible = 0;
  let hasAny = false;
  for (const test of tests) {
    const { earned, pct } = computeTestScore(profileId, test, marks);
    if (pct !== null) {
      totalEarned += earned;
      totalPossible += test.total_marks;
      hasAny = true;
    }
  }
  if (!hasAny || totalPossible === 0) return { grade: null, pct: null };
  const pct = (totalEarned / totalPossible) * 100;
  // Overall uses fallback — no single set applies across all tests
  return { grade: pctToGradeFallback(pct), pct };
}

// --- Boundary set badge -------------------------------------------------------

/** Small pill shown in collapsed test column headers and grade cells. */
function SetBadge({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span
        className="inline-block text-[9px] font-mono text-da-muted/60 leading-none"
        title="No boundary set assigned — using approximate 10-point bands"
      >
        ~
      </span>
    );
  }
  return (
    <span
      className="inline-block text-[9px] font-mono font-bold px-1 py-px rounded bg-da-accent/15 text-da-accent leading-none"
      title={`Grade boundaries: Set ${name}`}
    >
      {name}
    </span>
  );
}

// --- Component ----------------------------------------------------------------

interface Props {
  tests: Test[];
  students: Student[];
  initialMarks: Record<string, Record<string, number>>;
  /** testId -> subject ids recorded as absent (table test_absences); shown as "Abs". */
  absences?: Record<string, string[]>;
}

export function GradebookGrid({ tests, students, initialMarks, absences = {} }: Props) {
  const [expandedOverall, setExpandedOverall] = useState(false);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [showDistribution, setShowDistribution] = useState(false);

  // Build mutable marks state from server-provided initial data
  const [marks, setMarks] = useState<MarksState>(() => {
    const state: MarksState = {};
    for (const [itemId, studentMarks] of Object.entries(initialMarks)) {
      state[itemId] = {};
      for (const [profileId, m] of Object.entries(studentMarks)) {
        state[itemId][profileId] = m;
      }
    }
    return state;
  });

  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  // Deliberately NOT a cellError: the mark saved, only its history did not.
  // Marking the cell red would tell the teacher to re-enter a mark that is
  // already stored.
  const [auditWarning, setAuditWarning] = useState<string | null>(null);

  // -- Handlers ----------------------------------------------------------------

  const toggleTest = useCallback((testId: string) => {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  }, []);

  const handleChange = useCallback(
    (itemId: string, profileId: string, raw: string) => {
      const parsed = raw === "" ? null : parseInt(raw, 10);
      setMarks((prev) => ({
        ...prev,
        [itemId]: {
          ...(prev[itemId] ?? {}),
          [profileId]: Number.isNaN(parsed as number) ? null : parsed,
        },
      }));
    },
    []
  );

  const saveCell = useCallback(
    async (itemId: string, profileId: string, value: number | null, maxMarks: number) => {
      const key = `${itemId}:${profileId}`;
      if (value !== null && (value < 0 || value > maxMarks)) {
        setCellErrors((prev) => ({ ...prev, [key]: `0–${maxMarks}` }));
        return;
      }
      setCellErrors((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
      setSaving((prev) => new Set(prev).add(key));
      try {
        const res = await fetch("/api/gradebook/marks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testItemId: itemId, studentId: profileId, marksAwarded: value }),
        });
        const d = (await res.json().catch(() => ({}))) as {
          error?: string;
          auditWarning?: string;
        };
        if (!res.ok) {
          setCellErrors((prev) => ({ ...prev, [key]: "Save failed" }));
          console.error("Mark save error:", d.error);
        } else if (d.auditWarning) {
          setAuditWarning(d.auditWarning);
        }
      } catch {
        setCellErrors((prev) => ({ ...prev, [key]: "Network error" }));
      } finally {
        setSaving((prev) => {
          const n = new Set(prev);
          n.delete(key);
          return n;
        });
      }
    },
    []
  );

  const handleBlur = useCallback(
    async (itemId: string, profileId: string, maxMarks: number) => {
      const value = marks[itemId]?.[profileId] ?? null;
      await saveCell(itemId, profileId, value, maxMarks);
    },
    [marks, saveCell]
  );

  const handleCellPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>, anchorRow: number, anchorCol: number) => {
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;

      const pastedRows = text.split(/\r?\n|\r/);
      if (pastedRows[pastedRows.length - 1] === "") pastedRows.pop();
      const grid = pastedRows.map((row) => row.split("\t"));

      if (grid.length === 1 && grid[0].length === 1) return;
      e.preventDefault();

      const visibleItems: { itemId: string; maxMarks: number }[] = [];
      for (const test of tests) {
        if (expandedTests.has(test.id)) {
          for (const item of test.items) {
            visibleItems.push({ itemId: item.id, maxMarks: item.max_marks });
          }
        }
      }

      const updates: { itemId: string; profileId: string; value: number | null; maxMarks: number }[] = [];
      for (let r = 0; r < grid.length; r++) {
        const studentIdx = anchorRow + r;
        if (studentIdx >= students.length) break;
        const student = students[studentIdx];
        for (let c = 0; c < grid[r].length; c++) {
          const colIdx = anchorCol + c;
          if (colIdx >= visibleItems.length) break;
          const { itemId, maxMarks } = visibleItems[colIdx];
          const raw = grid[r][c].trim();
          const parsed = raw === "" ? null : parseInt(raw, 10);
          const value =
            parsed !== null && !isNaN(parsed)
              ? Math.max(0, Math.min(parsed, maxMarks))
              : null;
          updates.push({ itemId, profileId: student.profile_id, value, maxMarks });
        }
      }

      if (updates.length === 0) return;

      setMarks((prev) => {
        const next = { ...prev };
        for (const { itemId, profileId, value } of updates) {
          next[itemId] = { ...(next[itemId] ?? {}), [profileId]: value };
        }
        return next;
      });

      setCellErrors((prev) => {
        const next = { ...prev };
        for (const { itemId, profileId } of updates) delete next[`${itemId}:${profileId}`];
        return next;
      });
      setSaving((prev) => {
        const next = new Set(prev);
        for (const { itemId, profileId } of updates) next.add(`${itemId}:${profileId}`);
        return next;
      });

      fetch("/api/gradebook/marks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marks: updates.map(({ itemId, profileId, value }) => ({
            testItemId: itemId,
            studentId: profileId,
            marksAwarded: value,
          })),
        }),
      })
        .then(async (res) => {
          const d = (await res.json().catch(() => ({}))) as {
            error?: string;
            auditWarning?: string;
          };
          if (!res.ok) {
            console.error("Mark paste error:", d.error);
            setCellErrors((prev) => {
              const next = { ...prev };
              for (const { itemId, profileId } of updates)
                next[`${itemId}:${profileId}`] = "Paste save failed";
              return next;
            });
          } else if (d.auditWarning) {
            setAuditWarning(d.auditWarning);
          }
        })
        .catch(() => {
          setCellErrors((prev) => {
            const next = { ...prev };
            for (const { itemId, profileId } of updates)
              next[`${itemId}:${profileId}`] = "Network error";
            return next;
          });
        })
        .finally(() => {
          setSaving((prev) => {
            const next = new Set(prev);
            for (const { itemId, profileId } of updates) next.delete(`${itemId}:${profileId}`);
            return next;
          });
        });
    },
    [tests, expandedTests, students, saveCell]
  );

  // -- Styles -------------------------------------------------------------------

  const thBase =
    "px-2 py-2 text-center text-xs font-medium text-da-muted bg-da-surface border-b border-da-border whitespace-nowrap select-none";
  const thBtn = `${thBase} cursor-pointer hover:bg-da-hover hover:text-da-accent transition-colors`;
  const tdBase = "px-2 py-2 text-center text-sm border-b border-da-border/50";
  // Footer cells deliberately do not reuse thBase/tdBase: those carry a bottom
  // border, and Tailwind resolves a border-b / border-b-0 clash by stylesheet
  // order rather than class order, so overriding it would be a coin flip.
  const tdFoot = "px-2 py-1 text-center align-middle";
  const thFoot =
    "px-4 py-1 text-left text-xs font-medium text-da-muted whitespace-nowrap select-none sticky left-0 z-20 bg-da-surface border-r border-da-border";

  // -- Render -------------------------------------------------------------------

  const itemColMap = new Map<string, number>();
  {
    let col = 0;
    for (const test of tests) {
      if (expandedTests.has(test.id)) {
        for (const item of test.items) {
          itemColMap.set(item.id, col++);
        }
      }
    }
  }

  // -- Footer columns -----------------------------------------------------------
  // One descriptor per column right of the name, in header order, so the footer
  // stays aligned however the grid is expanded. Only columns that actually show
  // a level get a tally; an expanded test shows per-question marks, so its block
  // is spanned blank rather than being summarised as something it is not.
  type FooterColumn =
    | { kind: "levels"; key: string; label: string; grades: (number | null)[] }
    | { kind: "blank"; key: string; span: number };

  const footerColumns: FooterColumn[] = [];
  if (expandedOverall) {
    for (const comp of COMPONENTS) {
      footerColumns.push({
        kind: "levels",
        key: `comp:${comp}`,
        label: comp,
        grades: students.map((s) => computeComponentGrade(s.profile_id, comp, tests, marks)),
      });
    }
  } else {
    footerColumns.push({
      kind: "levels",
      key: "overall",
      label: "Overall",
      grades: students.map((s) => computeOverallGrade(s.profile_id, tests, marks).grade),
    });
  }
  for (const test of tests) {
    if (expandedTests.has(test.id)) {
      footerColumns.push({ kind: "blank", key: test.id, span: expandedTestSpan(test) });
      continue;
    }
    footerColumns.push({
      kind: "levels",
      key: test.id,
      label: test.name,
      // A student recorded absent reads "Abs" in the grid, not a level, so they
      // are not part of this test's cohort at all -- counting them as ungraded
      // would understate how much of the class has actually been marked.
      grades: students
        .filter((s) => !absences[test.id]?.includes(s.profile_id))
        .map((s) => computeTestScore(s.profile_id, test, marks).grade),
    });
  }
  const footerTallies = new Map(
    footerColumns
      .filter((c): c is Extract<FooterColumn, { kind: "levels" }> => c.kind === "levels")
      .map((c) => [c.key, tallyLevels(c.grades)])
  );

  return (
    <div className="overflow-hidden rounded-xl border border-da-border bg-da-surface/85 shadow-sm shadow-black/25">
      {auditWarning && (
        <div
          role="status"
          className="flex items-start gap-3 border-b border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
        >
          <span aria-hidden="true">&#9888;</span>
          <p className="flex-1">{auditWarning}</p>
          <button
            type="button"
            onClick={() => setAuditWarning(null)}
            className="shrink-0 font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse min-w-full text-da-text text-sm">
          {/* -- Header --------------------------------------------------- */}
          <thead>
            <tr>
              {/* Student name */}
              <th
                className={`${thBase} text-left sticky left-0 z-20 min-w-40 bg-da-surface border-r border-da-border px-4`}
              >
                Student
              </th>

              {/* Overall ← or P1/P2/P3/IA columns */}
              {expandedOverall ? (
                COMPONENTS.map((comp, i) => (
                  <th
                    key={comp}
                    className={thBtn}
                    title="Click any to collapse"
                    onClick={() => setExpandedOverall(false)}
                  >
                    {i === 0 && (
                      <span className="block text-[10px] text-da-accent/70">
                        ◂ Overall
                      </span>
                    )}
                    {comp}
                  </th>
                ))
              ) : (
                <th
                  className={`${thBtn} min-w-20`}
                  title="Click to expand into P1, P2, P3, IA"
                  onClick={() => setExpandedOverall(true)}
                >
                  Overall
                  <span className="block text-[10px] text-da-accent">▸</span>
                </th>
              )}

              {/* Test columns */}
              {tests.map((test) => {
                const isExp = expandedTests.has(test.id);

                if (isExp) {
                  if (test.items.length === 0) {
                    return (
                      <th
                        key={test.id}
                        className={thBtn}
                        onClick={() => toggleTest(test.id)}
                      >
                        {test.name}
                        <span className="block text-[10px] text-da-accent">◂</span>
                      </th>
                    );
                  }
                  const aMax = test.items
                    .filter((i) => i.question_number <= SECTION_A_MAX_Q)
                    .reduce((s, i) => s + i.max_marks, 0);
                  const bMax = test.items
                    .filter((i) => i.question_number > SECTION_A_MAX_Q)
                    .reduce((s, i) => s + i.max_marks, 0);
                  const hasA = aMax > 0;
                  const hasB = bMax > 0;

                  return (
                    <React.Fragment key={test.id}>
                      {test.items.map((item, idx) => (
                        <th
                          key={item.id}
                          className={`${thBtn} min-w-13`}
                          title={idx === 0 ? "Click to collapse" : item.question_code ? `Open ${item.question_code} in question editor` : undefined}
                        >
                          {idx === 0 && (
                            <span
                              className="block text-[10px] text-da-accent/70 max-w-25 truncate cursor-pointer"
                              onClick={() => toggleTest(test.id)}
                              title="Click to collapse"
                            >
                              ◂ {test.name}
                            </span>
                          )}
                          <span
                            className={item.question_code ? "cursor-pointer hover:underline" : ""}
                            onClick={() => {
                              if (item.question_code) {
                                window.open(`/dashboard/questions?search=${encodeURIComponent(item.question_code)}`, "_blank");
                              } else {
                                toggleTest(test.id);
                              }
                            }}
                          >
                            Q{item.question_number}
                            {item.part_label ? item.part_label : ""}
                          </span>
                          <span className="block text-[10px] text-da-muted">
                            /{item.max_marks}
                          </span>
                        </th>
                      ))}
                      {hasA && (
                        <>
                          <th className={`${thBase} min-w-16 bg-indigo-950/40 border-l border-indigo-800/40`}>
                            <span className="block text-[10px] text-indigo-300/70">Sec A</span>
                            <span className="text-indigo-300">/{aMax}</span>
                          </th>
                          <th className={`${thBase} min-w-14 bg-indigo-950/40`}>
                            <span className="block text-[10px] text-indigo-300/70">Sec A</span>
                            <span className="text-indigo-300">%</span>
                          </th>
                        </>
                      )}
                      {hasB && (
                        <>
                          <th className={`${thBase} min-w-16 bg-violet-950/40 border-l border-violet-800/40`}>
                            <span className="block text-[10px] text-violet-300/70">Sec B</span>
                            <span className="text-violet-300">/{bMax}</span>
                          </th>
                          <th className={`${thBase} min-w-14 bg-violet-950/40 border-r border-violet-800/40`}>
                            <span className="block text-[10px] text-violet-300/70">Sec B</span>
                            <span className="text-violet-300">%</span>
                          </th>
                        </>
                      )}
                    </React.Fragment>
                  );
                }

                // -- Collapsed test header — show name + date + set badge --
                return (
                  <th
                    key={test.id}
                    className={`${thBtn} min-w-22.5 max-w-32.5`}
                    onClick={() => toggleTest(test.id)}
                    title={`${test.name}${test.test_date ? " · " + test.test_date : ""}\nBoundary set: ${
                      test.boundary_set_name ? "Set " + test.boundary_set_name : "unassigned (approx.)"
                    }\nClick to expand`}
                  >
                    <span className="block truncate">{test.name}</span>
                    {test.test_date && (
                      <span className="block text-[10px] text-da-muted">
                        {new Date(test.test_date + "T00:00:00").toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" }
                        )}
                      </span>
                    )}
                    <span className="flex items-center justify-center gap-1 mt-0.5">
                      <SetBadge name={test.boundary_set_name} />
                      <span className="text-[10px] text-da-accent">▸</span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* -- Body ----------------------------------------------------- */}
          <tbody>
            {students.length === 0 && (
              <tr>
                <td
                  colSpan={999}
                  className="px-6 py-10 text-center text-da-muted"
                >
                  No students enrolled in this course.
                </td>
              </tr>
            )}

            {students.map((student, rowIdx) => {
              const evenRow = rowIdx % 2 === 0;
              const rowBg = evenRow ? "bg-da-surface" : "bg-da-bg/50";
              const stickyBg = evenRow ? "bg-da-surface" : "bg-da-bg/65";
              const { grade: overallGrade, pct: overallPct } =
                computeOverallGrade(student.profile_id, tests, marks);

              return (
                <tr key={student.profile_id} className={rowBg}>
                  {/* Name */}
                  <td
                    className={`${tdBase} text-left sticky left-0 z-10 border-r border-da-border px-4 font-medium ${stickyBg}`}
                  >
                    {student.name}
                  </td>

                  {/* Overall / Components */}
                  {expandedOverall ? (
                    COMPONENTS.map((comp) => {
                      const g = computeComponentGrade(
                        student.profile_id,
                        comp as "P1" | "P2" | "P3" | "IA",
                        tests,
                        marks
                      );
                      return (
                        <td
                          key={comp}
                          className={`${tdBase} font-bold text-base ${gradeColor(g)} ${gradeBg(g)}`}
                        >
                          {g ?? "—"}
                        </td>
                      );
                    })
                  ) : (
                    <td
                      className={`${tdBase} font-bold text-lg ${gradeColor(overallGrade)} ${gradeBg(overallGrade)}`}
                      title={
                        overallPct !== null
                          ? `${overallPct.toFixed(1)}%`
                          : undefined
                      }
                    >
                      {overallGrade ?? "—"}
                    </td>
                  )}

                  {/* Test cells */}
                  {tests.map((test) => {
                    const isExp = expandedTests.has(test.id);

                    // Recorded absent: one "Abs" cell in place of the marks,
                    // so an empty row no longer reads as "not graded yet".
                    if (absences[test.id]?.includes(student.profile_id)) {
                      const span = isExp ? expandedTestSpan(test) : 1;
                      return (
                        <td
                          key={test.id}
                          colSpan={span}
                          className={`${tdBase} text-xs font-medium uppercase tracking-wide text-amber-300 bg-amber-950/30`}
                          title="Recorded as absent for this test"
                        >
                          Abs
                        </td>
                      );
                    }

                    if (isExp) {
                      if (test.items.length === 0) {
                        return (
                          <td key={test.id} className={`${tdBase} text-da-muted`}>
                            —
                          </td>
                        );
                      }
                      const { secA, secB } = computeSectionScores(
                        student.profile_id,
                        test,
                        marks
                      );
                      return (
                        <React.Fragment key={test.id}>
                          {test.items.map((item) => {
                            const cellKey = `${item.id}:${student.profile_id}`;
                            const val =
                              marks[item.id]?.[student.profile_id] ??
                              null;
                            const isSaving = saving.has(cellKey);
                            const err = cellErrors[cellKey];

                            return (
                              <td key={item.id} className={`${tdBase} p-1`}>
                                <input
                                  type="number"
                                  min={0}
                                  max={item.max_marks}
                                  value={val === null ? "" : val}
                                  onChange={(e) =>
                                    handleChange(
                                      item.id,
                                      student.profile_id,
                                      e.target.value
                                    )
                                  }
                                  onBlur={() =>
                                    handleBlur(
                                      item.id,
                                      student.profile_id,
                                      item.max_marks
                                    )
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      (e.target as HTMLInputElement).blur();
                                  }}
                                  onPaste={(e) =>
                                    handleCellPaste(
                                      e,
                                      rowIdx,
                                      itemColMap.get(item.id) ?? 0
                                    )
                                  }
                                  className={[
                                    "w-12 rounded text-center text-sm py-1 bg-da-bg",
                                    "border focus:outline-none focus:ring-1 transition-colors",
                                    err
                                      ? "border-red-500 focus:ring-red-500"
                                      : isSaving
                                      ? "border-da-accent/60 focus:ring-da-accent/40"
                                      : "border-da-border focus:ring-da-accent/50 focus:border-da-accent",
                                    "text-da-text",
                                  ].join(" ")}
                                  title={err ? `⚠ ${err}` : `Max: ${item.max_marks}`}
                                />
                              </td>
                            );
                          })}
                          {secA && (
                            <>
                              <td className={`${tdBase} font-semibold text-indigo-300 bg-indigo-950/30 border-l border-indigo-800/40`}>
                                {secA.pct !== null ? secA.earned : "—"}
                              </td>
                              <td className={`${tdBase} text-indigo-200 bg-indigo-950/30`}
                                title={secA.pct !== null ? `${secA.earned}/${secA.max}` : undefined}>
                                {secA.pct !== null ? `${secA.pct.toFixed(0)}%` : "—"}
                              </td>
                            </>
                          )}
                          {secB && (
                            <>
                              <td className={`${tdBase} font-semibold text-violet-300 bg-violet-950/30 border-l border-violet-800/40`}>
                                {secB.pct !== null ? secB.earned : "—"}
                              </td>
                              <td className={`${tdBase} text-violet-200 bg-violet-950/30 border-r border-violet-800/40`}
                                title={secB.pct !== null ? `${secB.earned}/${secB.max}` : undefined}>
                                {secB.pct !== null ? `${secB.pct.toFixed(0)}%` : "—"}
                              </td>
                            </>
                          )}
                        </React.Fragment>
                      );
                    }

                    // Collapsed test: show IB grade + set badge
                    const { grade, pct } = computeTestScore(
                      student.profile_id,
                      test,
                      marks
                    );
                    return (
                      <td
                        key={test.id}
                        className={`${tdBase} font-semibold text-base ${gradeColor(grade)} ${gradeBg(grade)}`}
                        title={
                          pct !== null
                            ? `${pct.toFixed(1)}% · Set ${
                                test.boundary_set_name ?? "unassigned"
                              }`
                            : undefined
                        }
                      >
                        {grade ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          {/* -- Footer: level distribution ------------------------------- */}
          {students.length > 0 && (
            <tfoot className="bg-da-surface">
              <tr className="border-t-2 border-da-border">
                <th
                  className={`${thFoot} cursor-pointer hover:text-da-accent transition-colors`}
                  onClick={() => setShowDistribution((v) => !v)}
                  title={
                    showDistribution
                      ? "Hide the level distribution"
                      : "Show how many students sit at each level"
                  }
                >
                  Level distribution
                  <span className="ml-1 text-da-accent">
                    {showDistribution ? "▾" : "▸"}
                  </span>
                </th>
                {footerColumns.map((col) => {
                  if (col.kind === "blank") {
                    return <td key={col.key} colSpan={col.span} className={tdFoot} />;
                  }
                  const t = footerTallies.get(col.key)!;
                  return (
                    <td
                      key={col.key}
                      className={`${tdFoot} text-[11px] tabular-nums ${
                        t.graded === 0 ? "text-da-muted/40" : "text-da-muted"
                      }`}
                      title={`${col.label} — ${t.graded} of ${t.total} graded`}
                    >
                      {t.graded}/{t.total}
                    </td>
                  );
                })}
              </tr>

              {showDistribution &&
                LEVELS.map((level) => (
                  <tr key={level}>
                    <th className={`${thFoot} font-normal`}>
                      <span className={`font-bold ${gradeColor(level)}`}>{level}</span>
                    </th>
                    {footerColumns.map((col) => {
                      if (col.kind === "blank") {
                        return <td key={col.key} colSpan={col.span} className={tdFoot} />;
                      }
                      const t = footerTallies.get(col.key)!;
                      const n = t.counts[level] ?? 0;
                      const share = t.graded > 0 ? (n / t.graded) * 100 : 0;
                      return (
                        <td
                          key={col.key}
                          className={`${tdFoot} px-1`}
                          title={
                            t.graded === 0
                              ? `${col.label} — nothing graded yet`
                              : `${col.label} — level ${level}: ${n} of ${t.graded} graded (${share.toFixed(0)}%)`
                          }
                        >
                          <div
                            className={`relative mx-auto h-5 w-full max-w-24 overflow-hidden rounded-sm ${
                              t.graded > 0 ? "bg-da-bg/60" : ""
                            }`}
                          >
                            <div
                              className={`absolute inset-y-0 left-0 ${gradeBarBg(level)}`}
                              style={{ width: `${share}%` }}
                              aria-hidden="true"
                            />
                            <span
                              className={`absolute inset-0 flex items-center justify-center text-xs tabular-nums ${
                                n > 0 ? "font-semibold text-da-text" : "text-da-muted/40"
                              }`}
                            >
                              {n > 0 ? n : "·"}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tfoot>
          )}
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-da-border flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-da-muted">
        <span>Click column headers to expand / collapse.</span>
        <span className="text-da-border">|</span>
        <span>IB bands:</span>
        {([7, 6, 5, 4, 3, 2, 1] as const).map((g) => (
          <span key={g} className={`font-bold ${gradeColor(g)}`}>
            {g}
          </span>
        ))}
        <span className="text-da-border">|</span>
        <span>
          <span className="inline-block text-[9px] font-mono font-bold px-1 py-px rounded bg-da-accent/15 text-da-accent mr-1">B</span>
          = boundary set assigned
        </span>
        <span className="font-mono text-da-muted/60">~</span>
        <span>= approximate (no set assigned)</span>
        <span className="text-da-border">|</span>
        <span>Hover grade cells for % and set. Enter marks and press Tab/Enter to save.</span>
        <span className="text-da-border">|</span>
        <span>
          <span className="text-da-text">Level distribution</span> at the foot of each
          grade column counts students per level; bars are a share of what is graded.
        </span>
        <span className="text-da-border">|</span>
        <span>Expand a test, copy scores from a spreadsheet, click the first cell and paste to fill the grid.</span>
      </div>
    </div>
  );
}
