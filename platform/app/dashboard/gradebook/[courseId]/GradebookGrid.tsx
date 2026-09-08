"use client";

import React, { useState, useCallback, useRef } from "react";
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

/**
 * A band of question numbers to sub-total inside an expanded test.
 *
 * An IB paper gets the standard Section A (Q1-8) / Section B (Q9+) split, which
 * is real: those sections are short-response and extended-response, and the two
 * percentages say whether marks are going on breadth or on sustained problems.
 *
 * A Formative Assessment gets its own LEVEL headings instead. Applying the Q8
 * cut to one of those papers was actively misleading -- on Formative Assessment
 * 1 it landed in the middle of LEVEL 3, so neither subtotal corresponded to
 * anything the paper was built to measure. page.tsx derives these ranges.
 */
export type TestSection = {
  /** Short column label, e.g. 'Sec A' or 'L1'. */
  label: string;
  /** Full name for the tooltip, e.g. 'LEVEL 3 -- CONNECT THE ALGEBRA'. */
  title: string;
  fromQ: number;
  /** Inclusive upper bound; null means open-ended (the last section). */
  toQ: number | null;
};

export type Test = {
  id: string;
  name: string;
  test_date: string | null;
  total_marks: number;
  component: "P1" | "P2" | "P3" | "IA" | null;
  // null when no boundary set has been assigned to this test
  boundary_set_id: string | null;
  boundary_set_name: string | null;  // e.g. 'A', 'B', 'C', 'D'
  boundaries: GradeBoundary[] | null; // sorted grade 1→7, null if unassigned
  /** Subtotal bands for the expanded view, in display order. */
  sections: TestSection[];
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

/**
 * Band an aggregate percentage over several tests.
 *
 * The rule used to be "an aggregate always uses the generic fallback, because
 * no single boundary set applies across tests". That is only true when the
 * tests actually disagree. When every test a student sat carries the same set
 * -- and with one assessment in a course, that is the common case -- the set
 * plainly does apply, and ignoring it made the Overall column contradict the
 * test column beside it: on 9G's Formative Assessment 1, 43 of 50 students
 * read one level higher in Overall than in the column the marks came from,
 * purely because Overall was banding 90%-for-a-7 marks against 80%-for-a-7.
 *
 * `contributing` is the tests the student actually has marks for, so a student
 * who has only sat Grade 9 papers is banded as Grade 9 even if the course also
 * holds a paper on some other set that they have not sat yet.
 */
function bandAggregate(
  pct: number,
  contributing: Test[]
): { grade: number; approximate: boolean } {
  const setIds = new Set(contributing.map((t) => t.boundary_set_id));
  const [only] = [...setIds];
  if (setIds.size === 1 && only !== null) {
    const boundaries = contributing[0].boundaries;
    if (boundaries && boundaries.length > 0) {
      return { grade: resolveGrade(pct, boundaries), approximate: false };
    }
  }
  return { grade: pctToGradeFallback(pct), approximate: true };
}

function computeComponentGrade(
  profileId: string,
  component: "P1" | "P2" | "P3" | "IA",
  tests: Test[],
  marks: MarksState
): { grade: number | null; pct: number | null; approximate: boolean } {
  const compTests = tests.filter((t) => t.component === component);
  if (compTests.length === 0) return { grade: null, pct: null, approximate: false };
  let totalEarned = 0;
  let totalPossible = 0;
  const contributing: Test[] = [];
  for (const test of compTests) {
    const { earned, pct } = computeTestScore(profileId, test, marks);
    if (pct !== null) {
      totalEarned += earned;
      totalPossible += test.total_marks;
      contributing.push(test);
    }
  }
  if (contributing.length === 0 || totalPossible === 0) {
    return { grade: null, pct: null, approximate: false };
  }
  const pct = (totalEarned / totalPossible) * 100;
  const { grade, approximate } = bandAggregate(pct, contributing);
  return { grade, pct, approximate };
}

/** Tints for the section subtotal columns, cycled in order. The first two keep
 *  the indigo/violet the Sec A / Sec B columns have always used. */
const SECTION_TINTS = [
  { bg: "bg-indigo-950/40", cellBg: "bg-indigo-950/30", edge: "border-indigo-800/40", head: "text-indigo-300/70", text: "text-indigo-300", soft: "text-indigo-200" },
  { bg: "bg-violet-950/40", cellBg: "bg-violet-950/30", edge: "border-violet-800/40", head: "text-violet-300/70", text: "text-violet-300", soft: "text-violet-200" },
  { bg: "bg-cyan-950/40", cellBg: "bg-cyan-950/30", edge: "border-cyan-800/40", head: "text-cyan-300/70", text: "text-cyan-300", soft: "text-cyan-200" },
  { bg: "bg-fuchsia-950/40", cellBg: "bg-fuchsia-950/30", edge: "border-fuchsia-800/40", head: "text-fuchsia-300/70", text: "text-fuchsia-300", soft: "text-fuchsia-200" },
];

function inSection(questionNumber: number, section: TestSection): boolean {
  return (
    questionNumber >= section.fromQ &&
    (section.toQ === null || questionNumber <= section.toQ)
  );
}

/** The test's sections that actually contain marks, so an empty band (a paper
 *  that stops at Q6 has no Section B) contributes no columns. */
function presentSections(test: Test): TestSection[] {
  return test.sections.filter((s) =>
    test.items.some((i) => inSection(i.question_number, s))
  );
}

/** How an opened test column is showing itself. */
export type TestView = "levels" | "marks";

/** Columns an opened test occupies: a marks/% pair per present section, plus
 *  one per question in the "marks" view. Shared by the header, the "Abs" cell
 *  and the footer so the three cannot drift out of alignment. */
function expandedTestSpan(test: Test, view: TestView): number {
  const sectionCols = 2 * presentSections(test).length;
  if (view === "levels") return Math.max(1, sectionCols);
  return Math.max(1, test.items.length) + sectionCols;
}

/** Which views are worth offering. A paper with no items cannot be opened at
 *  all, and one whose sections hold no items has no subtotals to show. */
function availableViews(test: Test): TestView[] {
  if (test.items.length === 0) return [];
  return presentSections(test).length > 0 ? ["levels", "marks"] : ["marks"];
}

interface SectionScore {
  earned: number;
  max: number;
  pct: number | null;
}

/** Earned / max / % for each of the test's present sections, in display order. */
function computeSectionScores(
  profileId: string,
  test: Test,
  marks: MarksState
): SectionScore[] {
  return presentSections(test).map((section) => {
    let earned = 0;
    let max = 0;
    let hasAny = false;
    for (const item of test.items) {
      if (!inSection(item.question_number, section)) continue;
      max += item.max_marks;
      const m = marks[item.id]?.[profileId];
      if (m !== null && m !== undefined) {
        earned += m;
        hasAny = true;
      }
    }
    return { earned, max, pct: hasAny && max > 0 ? (earned / max) * 100 : null };
  });
}

function computeOverallGrade(
  profileId: string,
  tests: Test[],
  marks: MarksState
): { grade: number | null; pct: number | null; approximate: boolean } {
  let totalEarned = 0;
  let totalPossible = 0;
  const contributing: Test[] = [];
  for (const test of tests) {
    const { earned, pct } = computeTestScore(profileId, test, marks);
    if (pct !== null) {
      totalEarned += earned;
      totalPossible += test.total_marks;
      contributing.push(test);
    }
  }
  if (contributing.length === 0 || totalPossible === 0) {
    return { grade: null, pct: null, approximate: false };
  }
  const pct = (totalEarned / totalPossible) * 100;
  const { grade, approximate } = bandAggregate(pct, contributing);
  return { grade, pct, approximate };
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
      title={`Grade boundaries: ${name}`}
    >
      {name}
    </span>
  );
}

// --- View switcher ------------------------------------------------------------

const VIEW_LABEL: Record<TestView, string> = { levels: "Levels", marks: "Marks" };
const VIEW_TITLE: Record<TestView, string> = {
  levels: "Open this test as section subtotals only",
  marks: "Open this test as per-question marks",
};

/** The Levels / Marks pills. Shown in a collapsed test header to choose how to
 *  open it, and in an opened one to switch between the two. */
function ViewPills({
  test,
  view,
  onSet,
  onExport,
  exporting,
}: {
  test: Test;
  view: TestView | null;
  onSet: (view: TestView | null) => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const views = availableViews(test);
  if (views.length === 0) return null;
  return (
    <span className="mt-0.5 flex items-center justify-center gap-1">
      <button
        type="button"
        disabled={exporting}
        title="Download achievement levels as a PowerSchool import CSV"
        onClick={(e) => {
          e.stopPropagation();
          onExport();
        }}
        className="rounded bg-da-bg/60 px-1 py-px text-[9px] font-medium leading-none text-da-muted transition-colors hover:bg-da-hover hover:text-da-accent disabled:opacity-50"
      >
        {exporting ? "…" : "CSV"}
      </button>
      {views.map((v) => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            title={active ? "Click to collapse" : VIEW_TITLE[v]}
            onClick={(e) => {
              e.stopPropagation();
              onSet(active ? null : v);
            }}
            className={`rounded px-1 py-px text-[9px] font-medium leading-none transition-colors ${
              active
                ? "bg-da-accent/25 text-da-accent"
                : "bg-da-bg/60 text-da-muted hover:bg-da-hover hover:text-da-accent"
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        );
      })}
    </span>
  );
}

// --- Component ----------------------------------------------------------------

interface Props {
  /** The gradebook's own course, for the PowerSchool export. */
  courseId: string;
  tests: Test[];
  students: Student[];
  initialMarks: Record<string, Record<string, number>>;
  /** testId -> subject ids recorded as absent (table test_absences); shown as "Abs". */
  absences?: Record<string, string[]>;
}

export function GradebookGrid({ courseId, tests, students, initialMarks, absences = {} }: Props) {
  const [expandedOverall, setExpandedOverall] = useState(false);
  // A test opens two ways. "levels" is the section subtotals alone -- on a
  // 14-question paper that is 8 columns instead of 22, so the level profile is
  // readable without scrolling past every question. "marks" is the per-question
  // inputs, with those same subtotals kept alongside so they move as you type.
  // Absent from the record means collapsed.
  const [testViews, setTestViews] = useState<Record<string, TestView>>({});
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

  const [exportingTestId, setExportingTestId] = useState<string | null>(null);
  // Which students a CSV export covers. Defaults to the narrower set: a file
  // that wrongly omits a student is noticed, one that wrongly includes them
  // lands a level in PowerSchool for work the student never reviewed.
  const [exportScope, setExportScope] = useState<"self" | "all">("self");

  /**
   * Download one test's levels as a PowerSchool import CSV. The response's
   * X-Missing-Student-Numbers header says how many rows PowerSchool will not be
   * able to match; that is worth saying here rather than letting the teacher
   * discover it inside PowerTeacher Pro, so it is surfaced in the same banner
   * the mark audit uses.
   */
  /**
   * Fill in a PowerTeacher Scores Template.
   *
   * The teacher exports the blank template from the assignment in PowerTeacher
   * Pro; we write the Score column and hand it straight back. Matching is on
   * Student Num, so PowerSchool's "Roberto GAMIO" never has to be reconciled
   * with this platform's "Roberto Aurelio Gamio", and the assignment metadata
   * PowerSchool wrote stays exactly as it wrote it.
   */
  const fillTemplate = useCallback(
    async (file: File, testId: string, testName: string) => {
      setExportingTestId(testId);
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("testId", testId);
        body.append("courseId", courseId);
        body.append("scope", exportScope);
        const res = await fetch("/api/gradebook/powerschool-export", { method: "POST", body });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setAuditWarning(`Could not fill the template for ${testName}: ${d.error ?? res.statusText}`);
          return;
        }
        const filled = Number(res.headers.get("X-Filled") ?? "0");
        const unfilled = Number(res.headers.get("X-Unfilled") ?? "0");
        const notInTemplate = Number(res.headers.get("X-Not-In-Template") ?? "0");
        const notSelfAssessed = Number(res.headers.get("X-Not-Self-Assessed") ?? "0");
        const scope = res.headers.get("X-Scope") ?? exportScope;
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const named = /filename="([^"]+)"/.exec(disposition)?.[1];

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = named ?? "scores-filled.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        // Every row the template listed but we could not score is a row that
        // will import as blank, so say so rather than leaving it to be noticed
        // in PowerSchool.
        const notes: string[] = [];
        if (unfilled > 0) {
          notes.push(
            `${unfilled} row${unfilled === 1 ? "" : "s"} left blank` +
              (notSelfAssessed > 0 && scope === "self"
                ? ` (${notSelfAssessed} student${notSelfAssessed === 1 ? " has" : "s have"} not completed the self-assessment; students who have never signed in cannot).`
                : " — no mark, no student number, or not in this course.")
          );
        }
        if (notInTemplate > 0) {
          notes.push(
            `${notInTemplate} scored student${notInTemplate === 1 ? " is" : "s are"} not in this template, so they were not written anywhere.`
          );
        }
        setAuditWarning(
          `${testName}: filled ${filled} score${filled === 1 ? "" : "s"}.` +
            (notes.length > 0 ? ` ${notes.join(" ")}` : "")
        );
      } catch {
        setAuditWarning(`Could not fill the template for ${testName}: network error.`);
      } finally {
        setExportingTestId(null);
      }
    },
    [courseId, exportScope]
  );

  // One input, retargeted per test: a file picker per column would be dozens of
  // hidden inputs for a control only ever used one at a time.
  const templateInputRef = useRef<HTMLInputElement>(null);
  const pendingTemplateTest = useRef<{ id: string; name: string } | null>(null);

  const chooseTemplate = useCallback((testId: string, testName: string) => {
    pendingTemplateTest.current = { id: testId, name: testName };
    templateInputRef.current?.click();
  }, []);

  /** Open a test in a view, or pass null to collapse it. */
  const setTestView = useCallback((testId: string, view: TestView | null) => {
    setTestViews((prev) => {
      const next = { ...prev };
      if (view === null) delete next[testId];
      else next[testId] = view;
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
        // Only the "marks" view has cells to paste into; a test showing section
        // subtotals contributes no columns to the paste target.
        if (testViews[test.id] === "marks") {
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
    [tests, testViews, students, saveCell]
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

  // P1/P2/P3/IA are DP paper components, inferred from test names. A Grade 9
  // course has none of them, and expanding Overall into four permanently empty
  // columns invented a DP structure the course does not have. Only offer the
  // components this course's tests actually carry, and when there are none,
  // Overall is not expandable at all.
  const presentComponents = COMPONENTS.filter((c) => tests.some((t) => t.component === c));
  const showComponents = expandedOverall && presentComponents.length > 0;

  const itemColMap = new Map<string, number>();
  {
    let col = 0;
    for (const test of tests) {
      if (testViews[test.id] === "marks") {
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
  if (showComponents) {
    for (const comp of presentComponents) {
      footerColumns.push({
        kind: "levels",
        key: `comp:${comp}`,
        label: comp,
        grades: students.map(
          (s) => computeComponentGrade(s.profile_id, comp, tests, marks).grade
        ),
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
    const view = testViews[test.id];
    if (view) {
      footerColumns.push({ kind: "blank", key: test.id, span: expandedTestSpan(test, view) });
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
      {/* PowerSchool export scope. Lives above the scroll container so it is
          visible whatever the grid is scrolled to, and so the choice is made
          before the CSV button rather than being buried in the file. */}
      <input
        ref={templateInputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = pendingTemplateTest.current;
          // Reset first, so choosing the same file twice still fires onChange.
          e.target.value = "";
          pendingTemplateTest.current = null;
          if (file && target) void fillTemplate(file, target.id, target.name);
        }}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-da-border px-4 py-2 text-xs">
        <span className="text-da-muted">CSV export covers:</span>
        <div className="inline-flex overflow-hidden rounded-md border border-da-border">
          {([
            ["self", "Self-assessed only"],
            ["all", "All students"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={exportScope === value}
              onClick={() => setExportScope(value)}
              title={
                value === "self"
                  ? "Only students who completed the self-assessment. Students who have never signed in cannot, so they are never included."
                  : "Every student on the roster, whether or not they reviewed their marks."
              }
              className={`px-2.5 py-1 font-medium transition-colors ${
                exportScope === value
                  ? "bg-da-accent/20 text-da-accent"
                  : "text-da-muted hover:bg-da-hover hover:text-da-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-da-border">|</span>
        <span className="text-da-muted">
          <span className="text-da-text">CSV</span> on a test asks for the scores
          template you exported from that assignment in PowerTeacher Pro, and fills
          in its Score column.
        </span>
      </div>

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

              {/* Overall ← or the DP component columns this course actually has */}
              {showComponents ? (
                presentComponents.map((comp, i) => (
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
              ) : presentComponents.length > 0 ? (
                <th
                  className={`${thBtn} min-w-20`}
                  title={`Click to expand into ${presentComponents.join(", ")}`}
                  onClick={() => setExpandedOverall(true)}
                >
                  Overall
                  <span className="block text-[10px] text-da-accent">▸</span>
                </th>
              ) : (
                <th
                  className={`${thBase} min-w-20`}
                  title="Every assessment across this course"
                >
                  Overall
                </th>
              )}

              {/* Test columns */}
              {tests.map((test) => {
                const view = testViews[test.id] ?? null;

                if (view) {
                  const sections = presentSections(test);
                  // Whichever block comes first carries the name, the way back
                  // out, and the switch to the other view.
                  const control = (
                    <>
                      <span
                        className="block max-w-25 cursor-pointer truncate text-[10px] text-da-accent/70 hover:text-da-accent"
                        onClick={() => setTestView(test.id, null)}
                        title="Click to collapse"
                      >
                        ◂ {test.name}
                      </span>
                      <ViewPills
                        test={test}
                        view={view}
                        onSet={(v) => setTestView(test.id, v)}
                        onExport={() => chooseTemplate(test.id, test.name)}
                        exporting={exportingTestId === test.id}
                      />
                    </>
                  );

                  return (
                    <React.Fragment key={test.id}>
                      {view === "marks" &&
                        test.items.map((item, idx) => (
                          <th
                            key={item.id}
                            className={`${thBase} min-w-13`}
                            title={item.question_code ? `Open ${item.question_code} in question editor` : undefined}
                          >
                            {idx === 0 && control}
                            <span
                              className={item.question_code ? "cursor-pointer hover:underline" : ""}
                              onClick={() => {
                                if (item.question_code) {
                                  window.open(`/dashboard/questions?search=${encodeURIComponent(item.question_code)}`, "_blank");
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
                      {sections.map((section, sIdx) => {
                        const tint = SECTION_TINTS[sIdx % SECTION_TINTS.length];
                        const max = test.items
                          .filter((i) => inSection(i.question_number, section))
                          .reduce((s, i) => s + i.max_marks, 0);
                        const isLast = sIdx === sections.length - 1;
                        return (
                          <React.Fragment key={section.label}>
                            <th
                              className={`${thBase} min-w-16 ${tint.bg} border-l ${tint.edge}`}
                              title={section.title}
                            >
                              {view === "levels" && sIdx === 0 && control}
                              <span className={`block text-[10px] ${tint.head}`}>{section.label}</span>
                              <span className={tint.text}>/{max}</span>
                            </th>
                            <th
                              className={`${thBase} min-w-14 ${tint.bg} ${isLast ? `border-r ${tint.edge}` : ""}`}
                              title={section.title}
                            >
                              <span className={`block text-[10px] ${tint.head}`}>{section.label}</span>
                              <span className={tint.text}>%</span>
                            </th>
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                }

                // -- Collapsed test header — name, date, set badge, and the two
                //    ways in. The cell itself is no longer one big toggle: with
                //    two destinations, "click somewhere" would have to guess.
                return (
                  <th
                    key={test.id}
                    className={`${thBase} min-w-22.5 max-w-32.5`}
                    title={`${test.name}${test.test_date ? " · " + test.test_date : ""}\nBoundary set: ${
                      test.boundary_set_name ?? "unassigned (approx.)"
                    }`}
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
                    <span className="mt-0.5 flex items-center justify-center gap-1">
                      <SetBadge name={test.boundary_set_name} />
                    </span>
                    <ViewPills
                      test={test}
                      view={null}
                      onSet={(v) => setTestView(test.id, v)}
                      onExport={() => chooseTemplate(test.id, test.name)}
                      exporting={exportingTestId === test.id}
                    />
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
              const {
                grade: overallGrade,
                pct: overallPct,
                approximate: overallApprox,
              } = computeOverallGrade(student.profile_id, tests, marks);

              return (
                <tr key={student.profile_id} className={rowBg}>
                  {/* Name */}
                  <td
                    className={`${tdBase} text-left sticky left-0 z-10 border-r border-da-border px-4 font-medium ${stickyBg}`}
                  >
                    {student.name}
                  </td>

                  {/* Overall / Components */}
                  {showComponents ? (
                    presentComponents.map((comp) => {
                      const { grade: g, pct, approximate } = computeComponentGrade(
                        student.profile_id,
                        comp as "P1" | "P2" | "P3" | "IA",
                        tests,
                        marks
                      );
                      return (
                        <td
                          key={comp}
                          className={`${tdBase} font-bold text-base ${gradeColor(g)} ${gradeBg(g)}`}
                          title={
                            pct !== null
                              ? `${pct.toFixed(1)}% · ${approximate ? "approximate bands" : "test's own boundaries"}`
                              : undefined
                          }
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
                          ? `${overallPct.toFixed(1)}% · ${
                              overallApprox
                                ? "approximate bands (tests use different boundary sets)"
                                : "the boundaries of the tests it covers"
                            }`
                          : undefined
                      }
                    >
                      {overallGrade ?? "—"}
                    </td>
                  )}

                  {/* Test cells */}
                  {tests.map((test) => {
                    const view = testViews[test.id] ?? null;

                    // Recorded absent: one "Abs" cell in place of the marks,
                    // so an empty row no longer reads as "not graded yet".
                    if (absences[test.id]?.includes(student.profile_id)) {
                      const span = view ? expandedTestSpan(test, view) : 1;
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

                    if (view) {
                      const sections = presentSections(test);
                      const sectionScores = computeSectionScores(
                        student.profile_id,
                        test,
                        marks
                      );
                      return (
                        <React.Fragment key={test.id}>
                          {view === "marks" &&
                            test.items.map((item) => {
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
                          {sections.map((section, sIdx) => {
                            const tint = SECTION_TINTS[sIdx % SECTION_TINTS.length];
                            const score = sectionScores[sIdx];
                            const isLast = sIdx === sections.length - 1;
                            return (
                              <React.Fragment key={section.label}>
                                <td className={`${tdBase} font-semibold ${tint.text} ${tint.cellBg} border-l ${tint.edge}`}>
                                  {score.pct !== null ? score.earned : "—"}
                                </td>
                                <td
                                  className={`${tdBase} ${tint.soft} ${tint.cellBg} ${isLast ? `border-r ${tint.edge}` : ""}`}
                                  title={
                                    score.pct !== null
                                      ? `${section.title}: ${score.earned}/${score.max}`
                                      : section.title
                                  }
                                >
                                  {score.pct !== null ? `${score.pct.toFixed(0)}%` : "—"}
                                </td>
                              </React.Fragment>
                            );
                          })}
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
                            ? `${pct.toFixed(1)}% · ${
                                test.boundary_set_name ?? "no boundary set"
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
        <span>
          Open a test as <span className="text-da-text">Levels</span> (section
          subtotals) or <span className="text-da-text">Marks</span> (per-question);
          click the active one again to collapse.
        </span>
        <span className="text-da-border">|</span>
        <span>Levels:</span>
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
        <span>Open a test as Marks, copy scores from a spreadsheet, click the first cell and paste to fill the grid.</span>
      </div>
    </div>
  );
}
