"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import EvidenceBoxEditor from "@/components/EvidenceBoxEditor";
import { BatchGradeTab } from "./batch-grade-tab";
import { fetchJson, SESSION_EXPIRED_MESSAGE } from "./fetch-json";
import {
  runsForStudent,
  rowsForRun,
  sortReviewRows,
  partitionByConfidence,
  partWarningLabel,
  warningsForPart,
  capCauseForPart,
  CAP_CAUSE_SHORT,
} from "@/lib/ai-grade-review";
import type { AssessmentKind } from "@/lib/assessment-kind";
import { formatQuestionLabel } from "@/lib/assignments";
import { buildStandardsReport, parseStandardsRubric } from "@/lib/standards-rubric";
import { StandardsReportTable } from "@/components/StandardsReportTable";

type MarkschemeSource = "part_latex" | "part_text" | "whole_question" | "draft" | "custom" | "none";
type Confidence = "high" | "medium" | "low";
/** "submitted" is an overnight run: with Anthropic's batch API, no result written yet. */
type RunStatus = "submitted" | "running" | "complete" | "failed";

interface TestItem {
  id: string;
  question_number: number;
  part_label: string | null;
  max_marks: number;
  /**
   * Insertion order within the test (test_items.sort_order) -- the join key
   * back to tests.custom_content.sections for a Formative-Assessment-sourced
   * test, since buildTestItemsFromSections (lib/formative-assessment-bridge.ts)
   * assigns both in the same single walk of section -> question -> subpart.
   * Used to print the part the way the paper itself numbers it ("2.3(b)")
   * instead of the flat, section-blind question_number ("Q5(b)") that
   * numbering collapses into -- see paperQuestionPrefixes below.
   */
  sort_order: number;
  /**
   * The question as the teacher authored it (test_items.question_text), for a
   * test built in the Formative Assessment creator -- null on a test whose
   * parts come from the PPQ bank, where the question is a scanned IMAGE in
   * question_images instead. The marking row shows whichever of the two this
   * part actually has; a Grade 9 paper has only the text, an IB paper only
   * the image.
   */
  question_text: string | null;
  /**
   * The shared lead-in the parts of this question hang off
   * (test_items.stem_text), repeated on every part row in the database. Often
   * the whole of what a part means -- "Write the coefficient of k^2" cannot be
   * marked without "Look at this expression: -9k^2 + 5k - sqrt(7)" -- which is
   * why composeQuestionText gives it to the grader too.
   */
  stem_text: string | null;
  /**
   * The teacher's marking notes for this part (test_items.marking_notes):
   * rulings the marker reads after the mark scheme on every later mark of
   * this paper. Null when there are none. Edited from the Why? panel.
   */
  marking_notes?: string | null;
}

interface TestDetail {
  id: string;
  name: string;
  course_id: string;
  test_items: TestItem[];
  /**
   * The strand rubric of a Grade 9 Standard Level paper (tests.standards_rubric,
   * see lib/standards-rubric.ts), or null. When present the review panel
   * shows the student's strand levels alongside the marks being edited.
   */
  standards_rubric?: unknown;
  /**
   * The full authored draft for a Formative-Assessment-creator test
   * (tests.custom_content) -- the same sections/questions/subparts structure
   * the printed paper is rendered from. Null for an IB-bank/external test,
   * whose question_number already is the paper's own number.
   */
  custom_content?: unknown;
}

interface StudentOption {
  /**
   * The opaque subject id every AI-grade endpoint expects as studentId --
   * usually a real profiles.id, but "invited-<invited_students.id>" for a
   * roster entry imported (e.g. via Google Classroom) that has never logged
   * in and so has no profiles row yet. See parseGradingSubject in
   * lib/ai-grading.ts; this component never needs to tell the two apart.
   */
  profile_id: string;
  display_name: string;
  /**
   * The real class the student is in ("9A"). A Grade 9 test sits on one
   * class but its roster pools every class in the track, so the UI groups
   * by this. Null when the API could not name the class.
   */
  class_name: string | null;
}

interface RunRow {
  id: string;
  test_id: string;
  student_id: string;
  status: RunStatus;
  model: string | null;
  source_storage_path: string | null;
  coverage: {
    partsInAssessment?: number;
    partsGraded?: number;
    partsWithoutMarkscheme?: number;
    suggestedTotal?: number;
    maxTotal?: number;
    testTotalMarks?: number;
    needsReview?: string[];
    /** Parts whose suggestion matched the previous run's and so kept their accepted status. */
    acceptedCarriedForward?: number;
    warnings?: string[];
  } | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  /**
   * The Anthropic message batch this run is still tied to, null once it is
   * settled. A "running" run that still has one is a rescued run: its results
   * were written but its own status update was lost, so the collect route left
   * it deliberately for a later sweep to promote. See outstandingCollectCount.
   */
  pending_message_batch_id: string | null;
}

interface MarkBreakdownEntry {
  token: string;
  awarded: boolean;
  note: string;
  /** Which of this unit's own labeled sub-parts this token belongs to, e.g. "a)(i)" -- only present when a single graded unit covers more than one. */
  part?: string;
}

/**
 * Clusters consecutive markBreakdown entries sharing the same `part` label
 * (e.g. "a)(i)", "a)(ii)", "b)") so the review UI can show which marks
 * belong to which sub-part instead of one undifferentiated row of chips.
 * Entries with no `part` (the common case: a unit with no internal
 * sub-part structure) all land in one unlabeled group, so older graded
 * results without this field render exactly as before.
 */
function groupMarkBreakdownByPart(
  entries: MarkBreakdownEntry[]
): { part: string | null; entries: MarkBreakdownEntry[] }[] {
  const groups: { part: string | null; entries: MarkBreakdownEntry[] }[] = [];
  for (const entry of entries) {
    const part = entry.part ?? null;
    const last = groups[groups.length - 1];
    if (last && last.part === part) {
      last.entries.push(entry);
    } else {
      groups.push({ part, entries: [entry] });
    }
  }
  return groups;
}

interface ResultRow {
  id: string;
  run_id: string;
  test_item_id: string;
  suggested_marks: number;
  max_marks: number;
  confidence: Confidence;
  markscheme_source: MarkschemeSource;
  work_found: boolean;
  reasoning: string | null;
  evidence: string | null;
  /** Cropped scan region the model used to produce `evidence`, if it could localise the work. */
  evidence_image_url: string | null;
  /** The fractional-page box `evidence_image_url` was cropped from, if any -- lets the UI fetch the full page for context. */
  evidence_box: { page: number; x0: number; y0: number; x1: number; y1: number } | null;
  /**
   * Where that box came from: "anchor" (this paper's locked layout), "teacher"
   * (redrawn by hand on one student's scan), "model" (located by the grader,
   * and wrong far more often than it looks), or null for rows graded before the
   * column existed. Badged so a reliable region is not mistaken for a guessed
   * one.
   */
  evidence_box_source: string | null;
  /** Question source image(s) from the PPQ bank, if any are on file for this part. */
  question_image_urls: string[];
  /** Mark scheme source image(s) from the PPQ bank, if any are on file for this part. */
  markscheme_image_urls: string[];
  mark_breakdown: MarkBreakdownEntry[];
  accepted: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
  /**
   * What is actually in Clev's Marks (student_marks.marks_awarded) for this
   * part right now, or null if nothing has been written yet. `suggested_marks`
   * never changes once the model has spoken -- it is the audit trail's record
   * of what the model said, and the "was N" comparison between runs depends on
   * that staying put -- so an accepted row's true value lives here instead.
   */
  marks_awarded: number | null;
}

const SOURCE_LABEL: Record<MarkschemeSource, string> = {
  part_latex: "Part mark scheme",
  part_text: "Part mark scheme (plain text)",
  whole_question: "Whole-question fallback",
  draft: "Draft mark scheme",
  // A Formative Assessment, Standard Level or activity part: the scheme the
  // teacher wrote on the item itself. It rendered as a blank cell until this
  // entry existed, on every Grade 9 row.
  custom: "Teacher's mark scheme",
  none: "No mark scheme",
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-green-500/15 text-green-300 border-green-400/40",
  medium: "bg-amber-500/15 text-amber-300 border-amber-400/40",
  low: "bg-red-500/15 text-red-300 border-red-400/40",
};

/**
 * How often an open page asks for finished overnight batches. There is no
 * worker and no cron: this page load IS the collector, so the tick has to be
 * frequent enough to feel live while a teacher watches, and cheap enough to
 * leave running all day (the route only reads the batches this test has open).
 */
const COLLECT_POLL_MS = 30_000;

/**
 * Ceiling on collect calls in one pass. The route writes up to
 * MAX_RESULTS_PER_CALL results (5) and reports `more`, so 40 passes drains
 * 200 results -- more than any real class -- and a route that always
 * answered `more: true` still cannot keep one page load posting for ever.
 */
const MAX_COLLECT_PASSES = 40;

/**
 * Maps each test_items.sort_order to the "<section>.<question>" prefix the
 * printed paper itself uses (e.g. "2.3"), read from tests.custom_content --
 * the same authored sections/questions/subparts draft the PDF is rendered
 * from (formatQuestionLabel, lib/assignments.ts) and buildTestItemsFromSections
 * (lib/formative-assessment-bridge.ts) walks in the same order to assign
 * sort_order in the first place, so the two line up. A part_label ("b") is
 * still read off the row itself; this only replaces the flat "Q5" stem that
 * discards which Level/section a part belongs to. Empty for an IB-bank test,
 * whose custom_content is null and whose question_number already is the
 * paper's own number.
 */
function paperQuestionPrefixes(customContent: unknown): Map<number, string> {
  const prefixes = new Map<number, string>();
  const sections = (
    customContent as { sections?: { questions?: { subparts?: unknown[] }[] }[] } | null | undefined
  )?.sections;
  if (!Array.isArray(sections)) return prefixes;
  let sortOrder = 0;
  sections.forEach((section, sIdx) => {
    (section.questions ?? []).forEach((question, qIdx) => {
      const prefix = formatQuestionLabel(sIdx, qIdx, "numeric");
      const partCount = Array.isArray(question.subparts) && question.subparts.length > 0 ? question.subparts.length : 1;
      for (let i = 0; i < partCount; i++) prefixes.set(sortOrder++, prefix);
    });
  });
  return prefixes;
}

function itemLabel(item: TestItem | undefined, paperPrefixes: Map<number, string>): string {
  if (!item) return "—";
  const prefix = paperPrefixes.get(item.sort_order) ?? `Q${item.question_number}`;
  return item.part_label ? `${prefix}(${item.part_label})` : prefix;
}

export function AiGradeClient({
  testId,
  assessmentKind = "formative",
}: {
  testId: string;
  /** Decides what "Accept all" actually covers -- see lib/summative-grading-gate.ts. */
  assessmentKind?: AssessmentKind;
}) {
  const [tab, setTab] = useState<"individual" | "batch">("individual");
  /** Result of GET /api/health/anthropic: null until checked; error string when the key cannot complete a call. */
  const [apiHealthError, setApiHealthError] = useState<string | null>(null);

  const [test, setTest] = useState<TestDetail | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);
  /** Newest COMPLETE run per student -- the one whose results are reviewable. */
  const [runsByStudent, setRunsByStudent] = useState<Record<string, RunRow>>({});
  /** Newest run of any status per student, when it is NOT the complete one (a failed or still-running attempt). */
  const [newerAttemptByStudent, setNewerAttemptByStudent] = useState<Record<string, RunRow>>({});
  /** Subject ids recorded as absent for this test (table test_absences). */
  const [absentStudents, setAbsentStudents] = useState<Set<string>>(new Set());
  const [absenceBusy, setAbsenceBusy] = useState<string | null>(null);
  /** Previous complete run's suggested marks for the student under review, keyed by test_item_id. */
  const [previousMarks, setPreviousMarks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const [focusStudent, setFocusStudent] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  /**
   * Which student the rows currently in `results` were loaded for. The review
   * panel refuses to render unless this matches `focusStudent`, so one
   * student's marks can never appear under another student's heading -- see
   * lib/ai-grade-review.ts for the incident this guards against.
   */
  const [resultsStudent, setResultsStudent] = useState<string | null>(null);
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({}); // keyed by result.id
  /** A reason typed beside an overridden mark, sent with the accept as its audit note. Keyed by result.id. */
  const [overrideNotes, setOverrideNotes] = useState<Record<string, string>>({});
  /** Marking-note text being edited per test item, present only while the editor is open. */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteFor, setSavingNoteFor] = useState<string | null>(null);
  /** Test item whose class-wide one-part re-mark is being queued. */
  const [remarkingPartFor, setRemarkingPartFor] = useState<string | null>(null);
  /** Feedback to the grader being typed per test item. */
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [draftingFor, setDraftingFor] = useState<string | null>(null);
  /** The last proposal the drafting model returned per item, shown until the note is saved or dismissed. */
  const [proposals, setProposals] = useState<
    Record<string, { feedbackId: string; summary: string; caseMarks: number | null; cannotApply: string | null }>
  >({});
  const [selected, setSelected] = useState<Set<string>>(new Set()); // result ids
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * Whether the review panel's high-confidence parts are shown. They sit
   * behind one summary row, which starts OPEN: the panel still leads with the
   * parts that need a human, but a confident mark is a mark going into Clev's
   * Marks, so it is on screen unless the teacher folds it away. Reset to open
   * for every student -- a fold applies to the paper in front of you, not to
   * the next one.
   */
  const [highConfidenceOpen, setHighConfidenceOpen] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  /** Result id currently fetching its full source page (see openBoxEditor). */
  const [pageImageLoadingId, setPageImageLoadingId] = useState<string | null>(null);
  /**
   * The part whose evidence region is being redrawn on the scanned page, if
   * any. `page` is 1-indexed to match evidence_box.page.
   */
  const [boxEditor, setBoxEditor] = useState<{
    result: ResultRow;
    label: string;
    page: number;
    pageCount: number;
    imageSrc: string | null;
  } | null>(null);
  const [boxEditorLoading, setBoxEditorLoading] = useState(false);
  const [boxEditorSaving, setBoxEditorSaving] = useState(false);
  const [boxEditorError, setBoxEditorError] = useState<string | null>(null);
  /** Which rows have their question image un-minimized — collapsed by default, keyed by result.id. */
  const [questionImageShown, setQuestionImageShown] = useState<Set<string>>(new Set());
  /** Same, for the student's-work scan crop. */
  const [evidenceImageShown, setEvidenceImageShown] = useState<Set<string>>(new Set());
  /** Same, for the mark scheme source image(s). */
  const [markschemeImageShown, setMarkschemeImageShown] = useState<Set<string>>(new Set());

  /** True while a collect pass is in flight -- disables the "Check for results" button. */
  const [collecting, setCollecting] = useState(false);
  /**
   * Runs still with Anthropic (status "submitted"), counted over the whole run
   * list in loadOverview. NOT derived from newerAttemptByStudent: that map
   * holds one run per student, so a student queued overnight and then marked in
   * the browser has a newer complete run, their pending overnight run stops
   * being their newest, and both the banner and the 30s poll that collects it
   * would silently stay off.
   */
  const [submittedStudentCount, setSubmittedStudentCount] = useState(0);
  /**
   * Runs this page still owes a collect call for: the "submitted" ones above,
   * plus any "running" run that still carries a pending_message_batch_id.
   *
   * Deliberately a second count rather than a wider submittedStudentCount,
   * because the two answer different questions. That one is what the teacher
   * is TOLD -- students still waiting at Anthropic -- and a rescued run is not
   * one of those: its marks are already written and paid for, and saying it is
   * still being marked would be a lie. This one is what the page still has
   * WORK to do about. Gating the poll on the banner's count stranded exactly
   * the run the collect route was careful to leave recoverable: if it was the
   * last outstanding run on the test, the poll stopped, no collect call was
   * ever made again, and the student's marks sat in ai_grade_results while the
   * roster showed them as never graded.
   */
  const [outstandingCollectCount, setOutstandingCollectCount] = useState(0);
  /**
   * Why the last collect pass stopped, verbatim from the route (its 422 names
   * the fix: extract the mark scheme LaTeX in the PPQ Bank). Deliberately not
   * setError -- that box replaces the roster, and a failed collect leaves
   * everything else on this page usable.
   */
  const [collectError, setCollectError] = useState<string | null>(null);

  const [busyStudent, setBusyStudent] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptingRowId, setAcceptingRowId] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  /** How many of a run's results are accepted, keyed by run id — drives the roster's status dot. */
  const [acceptanceByRun, setAcceptanceByRun] = useState<Record<string, { accepted: number; total: number }>>(
    {}
  );

  // -- Manually correcting a misread transcription (evidence) and re-grading it --
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<Record<string, string>>({});
  const [regradingId, setRegradingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadStudent = useRef<string | null>(null);
  /** Incremented per review load; a response from an older load is discarded. */
  const reviewRequestSeq = useRef(0);

  const itemById = new Map((test?.test_items ?? []).map((i) => [i.id, i]));
  const paperPrefixes = paperQuestionPrefixes(test?.custom_content);

  // A Standard Level paper's rubric, parsed once per test load. An
  // unreadable one is treated as none here: the test detail page is where
  // it gets fixed, and a review panel with no strand table is better than
  // one that refuses to render.
  const standardsRubric = useMemo(() => {
    const parsed = parseStandardsRubric(test?.standards_rubric ?? null);
    return parsed.ok ? parsed.rubric : null;
  }, [test?.standards_rubric]);
  const classCount = new Set(students.map((s) => s.class_name ?? "")).size;

  // -- Absence: a student who did not sit the test ------------------------------
  // Recorded in test_absences so the roster here and the gradebook show
  // "Absent" instead of an empty row that reads like "not graded yet".
  const setAbsent = async (studentId: string, absent: boolean) => {
    setAbsenceBusy(studentId);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/absences`, {
        method: absent ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not update the absence.");
        return;
      }
      setAbsentStudents((prev) => {
        const next = new Set(prev);
        if (absent) next.add(studentId);
        else next.delete(studentId);
        return next;
      });
    } finally {
      setAbsenceBusy(null);
    }
  };

  // -- Initial load: test detail (for items + course), roster, latest runs --
  const loadOverview = useCallback(async () => {
    setError(null);
    try {
      const test1 = await fetchJson(`/api/tests/${testId}`);
      if (!test1.ok) {
        setError((test1.data.error as string) ?? "Could not load this assessment.");
        return;
      }
      const testData = test1.data as unknown as TestDetail;
      setTest(testData);

      // includeTrackSiblings: a Grade 9 test is attached to one class (9G)
      // but the scanned pile mixes every class in its track (9A, 9C, 9G),
      // so the roster pools them all -- signed in or not.
      const students1 = await fetchJson(
        `/api/students?courseId=${testData.course_id}&includeInvited=true&includeTrackSiblings=true`
      );
      if (!students1.ok) {
        setError((students1.data.error as string) ?? "Could not load the class roster.");
        return;
      }
      type RosterRow = {
        profile_id?: string;
        profiles: { display_name: string; nickname: string | null };
        course_id?: string;
        course_name?: string | null;
      };
      const rawRows = (students1.data.students as RosterRow[]) ?? [];
      // Class order: the test's own class first, then the pooled sibling
      // classes alphabetically, then students whose class is unknown.
      const ownClass = rawRows.find((s) => s.course_id === testData.course_id)?.course_name ?? null;
      const classRank = (name: string | null) => (name === ownClass ? 0 : name ? 1 : 2);
      const roster: StudentOption[] = rawRows
        .filter((s): s is RosterRow & { profile_id: string } => !!s.profile_id)
        .map((s) => {
          const fullName = s.profiles?.display_name;
          const nickname = s.profiles?.nickname;
          // Full name first — the batch-upload dropdown needs it to tell
          // apart students who share a first name or nickname. Nickname
          // shown alongside when it differs, since that's often what a
          // teacher recognises a cover-page name against.
          const label =
            fullName && nickname && nickname !== fullName
              ? `${fullName} (${nickname})`
              : fullName || nickname || "Unknown";
          return { profile_id: s.profile_id, display_name: label, class_name: s.course_name ?? null };
        })
        .sort(
          (a: StudentOption, b: StudentOption) =>
            classRank(a.class_name) - classRank(b.class_name) ||
            (a.class_name ?? "").localeCompare(b.class_name ?? "") ||
            a.display_name.localeCompare(b.display_name)
        );
      setStudents(roster);

      const runs1 = await fetchJson(`/api/tests/${testId}/ai-grade`);
      if (!runs1.ok) {
        setError((runs1.data.error as string) ?? "Could not load grading runs.");
        return;
      }
      // Runs come back newest-first. The reviewable run is the newest COMPLETE
      // one: a failed or half-finished attempt has no results, and treating it
      // as "the" run used to hide a student's real graded work behind an
      // empty run (seen when a re-mark failed on API credits). The newer
      // attempt is kept separately so its error still shows in the roster.
      const allRuns = (runs1.data.runs as RunRow[]) ?? [];
      const latestComplete: Record<string, RunRow> = {};
      const newestAny: Record<string, RunRow> = {};
      for (const r of allRuns) {
        if (!newestAny[r.student_id]) newestAny[r.student_id] = r;
        if (r.status === "complete" && !latestComplete[r.student_id]) latestComplete[r.student_id] = r;
      }
      const newerAttempt: Record<string, RunRow> = {};
      for (const [studentId, r] of Object.entries(newestAny)) {
        if (latestComplete[studentId]?.id !== r.id) newerAttempt[studentId] = r;
      }
      setRunsByStudent(latestComplete);
      setNewerAttemptByStudent(newerAttempt);
      // Counted off the raw run list, not the newest-run-per-student map: a
      // student marked in the browser after being queued overnight has a
      // newer complete run, which would hide their still-pending one and stop
      // the poll from ever starting. Distinct students, because the banner
      // counts people -- two submissions for one student before either
      // collects is one student waiting, not two.
      setSubmittedStudentCount(
        new Set(allRuns.filter((r) => r.status === "submitted").map((r) => r.student_id)).size
      );
      // Runs, not distinct students: nothing renders this, it only has to be
      // zero exactly when there is nothing left for a collect pass to do. A
      // "running" run without a batch pointer is an ordinary interactive
      // grade in flight, which collect has no business with.
      setOutstandingCollectCount(
        allRuns.filter(
          (r) => r.status === "submitted" || (r.status === "running" && r.pending_message_batch_id !== null)
        ).length
      );

      // Absences are loaded best-effort: a failure here should not hide
      // the roster, it just means nobody shows as absent.
      const absences1 = await fetchJson(`/api/tests/${testId}/absences`);
      if (absences1.ok) {
        const ids = ((absences1.data.absences as { studentId: string }[]) ?? []).map((a) => a.studentId);
        setAbsentStudents(new Set(ids));
      }

      const counts: Record<string, { accepted: number; total: number }> = {};
      for (const r of ((runs1.data.results as { run_id: string; accepted: boolean }[]) ?? [])) {
        const c = counts[r.run_id] ?? { accepted: 0, total: 0 };
        c.total += 1;
        if (r.accepted) c.accepted += 1;
        counts[r.run_id] = c;
      }
      setAcceptanceByRun(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this assessment.");
    }
  }, [testId]);

  useEffect(() => {
    loadOverview().finally(() => setLoading(false));
  }, [loadOverview]);

  // -- Collecting overnight results --------------------------------------------
  // Nothing on the server goes looking for a finished batch: no worker, no
  // cron. This page is the collector -- once on load, every COLLECT_POLL_MS
  // while any run is still outstanding (see outstandingCollectCount), and
  // whenever the teacher asks. A pass
  // that throws (offline, route mid-deploy) changes nothing -- Anthropic holds
  // results for 29 days -- so it is swallowed and retried on the next tick
  // rather than surfaced over the roster. A pass the route REFUSES is not
  // self-healing (its 422 wants a mark scheme extracting), so that message is
  // shown beside the overnight banner instead of being retried in silence.
  const collectingRef = useRef(false);
  const runCollect = useCallback(async () => {
    if (collectingRef.current) return; // a tick must not overlap the button
    collectingRef.current = true;
    setCollecting(true);
    try {
      let written = 0;
      // Null once every pass has answered ok, so a later good pass clears a
      // stale message; set and kept when one refuses, since nothing this page
      // does on its own will fix a 422 (no mark scheme stored) and the teacher
      // would otherwise watch the banner poll for ever.
      let failure: string | null = null;
      for (let pass = 0; pass < MAX_COLLECT_PASSES; pass++) {
        const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/collect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!ok) {
          failure = (data.error as string) ?? "Could not check for overnight results.";
          break;
        }
        written += ((data.completed as number) ?? 0) + ((data.failed as number) ?? 0);
        if (data.more !== true) break;
      }
      setCollectError(failure);
      // Only when a run actually changed: an empty pass is the common case
      // (a batch still running) and must not reload the roster every 30s.
      if (written > 0) await loadOverview();
    } catch {
      // Offline, or the route is mid-deploy. The batch is still with
      // Anthropic; the next tick collects it.
    } finally {
      collectingRef.current = false;
      setCollecting(false);
    }
  }, [testId, loadOverview]);

  useEffect(() => {
    // Nothing outstanding means nothing to collect. Firing on every mount
    // instead would post to the route from every test's marking page,
    // including tests that have never been sent overnight, and any 500 it
    // returned (a missing API key, say) would paint an alert there. A test
    // that has never used overnight marking has neither kind of outstanding
    // run, so this count is 0 and it still never posts.
    if (outstandingCollectCount === 0) return;
    // The first pass is deferred by a tick rather than run in the effect
    // body: the pass flips its own "checking" flag, and a synchronous
    // setState here cascades a render.
    const first = setTimeout(() => void runCollect(), 0);
    const timer = setInterval(() => void runCollect(), COLLECT_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [outstandingCollectCount, runCollect]);

  /** Drops whatever is in the review panel. Called before every load, so a
   * failed or superseded fetch leaves the panel empty rather than showing the
   * previously reviewed student's rows under the new student's name. The
   * "was N" hints go too -- a previous run's marks belong to the student
   * they were loaded for, same as the rows themselves. */
  const clearReview = useCallback(() => {
    setResults([]);
    setResultsStudent(null);
    setFocusRunId(null);
    setDrafts({});
    setSelected(new Set());
    setExpanded(null);
    setHighConfidenceOpen(true);
    setEditingEvidenceId(null);
    setPreviousMarks({});
  }, []);

  // Is the deployed Anthropic key able to complete a call at all? When the
  // account is out of credit every marking action on this page fails with
  // the same error, one student at a time -- say so once, up front, instead.
  useEffect(() => {
    let cancelled = false;
    fetchJson("/api/health/anthropic")
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) return; // the health route itself failing is not a key problem
        setApiHealthError(data.ok === false ? ((data.error as string) ?? "Anthropic API check failed") : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // -- Load one student's results for review --
  const loadResultsFor = useCallback(
    async (studentId: string, opts?: { afterWrite?: boolean }) => {
      const requestId = ++reviewRequestSeq.current;
      // A teacher clicking down the roster has several of these in flight at
      // once; responses can arrive out of order. Only the newest may write.
      const superseded = () => requestId !== reviewRequestSeq.current;
      // When this refresh follows a write that already succeeded, its failure
      // must not read as the write having failed. The accept call sets the
      // blue confirmation and this runs straight after it, so a bare error
      // above that line said "41 mark(s) written" and "Not authenticated" at
      // once and left the teacher unable to tell which to believe. The marks
      // are in Clev's Marks; only the list on screen is behind.
      const describe = (reason: string) =>
        opts?.afterWrite
          ? `The marks were written to Clev's Marks and are safe. The list below could not be refreshed: ${reason}`
          : reason;
      try {
        const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade?studentId=${studentId}`);
        if (superseded()) return;
        if (!ok) {
          setError(describe((data.error as string) ?? "Could not load results for this student."));
          return;
        }
        const runs = (data.runs ?? []) as RunRow[];
        // Only this student's runs, newest first -- a response for anyone
        // else yields nothing rather than their marks under this heading.
        const mine = runsForStudent(studentId, runs);
        // Newest COMPLETE run is what gets reviewed (see loadOverview); the
        // one before it supplies "was N" hints for parts whose suggestion
        // moved between runs.
        const completeRuns = mine.filter((r) => r.status === "complete");
        const latestRun = completeRuns[0] ?? null;
        const previousRun = completeRuns[1] ?? null;
        const rows = (data.results ?? []) as ResultRow[];
        const rowsForLatest = rowsForRun(latestRun?.id ?? null, rows);
        const prev: Record<string, number> = {};
        for (const r of rowsForRun(previousRun?.id ?? null, rows)) {
          prev[r.test_item_id] = r.suggested_marks;
        }
        setPreviousMarks(prev);

        const newest = mine[0] ?? null;
        setNewerAttemptByStudent((current) => {
          const next = { ...current };
          if (newest && newest.id !== latestRun?.id) next[studentId] = newest;
          else delete next[studentId];
          return next;
        });

        setFocusRunId(latestRun?.id ?? null);
        setResults(rowsForLatest);
        setResultsStudent(studentId);
        // An accepted row's draft starts from what is actually in Clev's
        // Marks, not the model's original suggestion -- suggested_marks
        // never moves once the model has spoken, so seeding the draft from
        // it here reset every accepted override back to the AI's first call
        // on the next load (e.g. right after accepting it). See marks_awarded
        // on ResultRow.
        setDrafts(
          Object.fromEntries(
            rowsForLatest.map((r) => [
              r.id,
              r.accepted && r.marks_awarded !== null ? r.marks_awarded : r.suggested_marks,
            ])
          )
        );
        setSelected(
          new Set(rowsForLatest.filter((r) => !r.accepted && r.work_found).map((r) => r.id))
        );
        if (latestRun) {
          setRunsByStudent((prev) => ({ ...prev, [studentId]: latestRun }));
          setAcceptanceByRun((prev) => ({
            ...prev,
            [latestRun.id]: {
              accepted: rowsForLatest.filter((r) => r.accepted).length,
              total: rowsForLatest.length,
            },
          }));
        }
      } catch (e) {
        if (superseded()) return;
        setError(describe(e instanceof Error ? e.message : "Could not load results for this student."));
      }
    },
    [testId]
  );

  const openReview = async (studentId: string) => {
    clearReview();
    setFocusStudent(studentId);
    setStatusLine(null);
    setError(null);
    await loadResultsFor(studentId);
  };

  /**
   * Collapses the review panel under a student's row. The panel is rendered
   * inside the roster now, so "Review" has to be a toggle -- there is no
   * scrolling away from a section that sits between two students.
   */
  const closeReview = () => {
    clearReview();
    setFocusStudent(null);
  };

  // -- Run grading (fresh upload or re-use stored scan) --
  // -- Re-mark a stored scan overnight: the same request as runGrading sends,
  // through the Message Batches API at half price, collected by this page
  // when the result lands (usually within the hour). The default for a
  // re-mark since 20 Sep 2026, because nobody waits on one: half of all
  // marking runs were re-marks, at full price, with a tab open. -------------
  const queueRemark = async (studentId: string) => {
    const currentRun = runsByStudent[studentId];
    const storagePath = currentRun?.source_storage_path ?? newerAttemptByStudent[studentId]?.source_storage_path;
    if (!storagePath) {
      setError("No stored scan to re-mark for this student.");
      return;
    }
    const acceptedCount = currentRun ? acceptanceByRun[currentRun.id]?.accepted ?? 0 : 0;
    if (acceptedCount > 0) {
      const ok = window.confirm(
        `${acceptedCount} part(s) for this student are already accepted into Clev's Marks.\n\n` +
          "Re-marking runs the model again. Parts whose new suggestion matches the current one stay accepted; " +
          "any part whose suggestion changes will need to be reviewed and accepted again. Clev's Marks themselves are not changed.\n\n" +
          "Continue?"
      );
      if (!ok) return;
    }
    setBusyStudent(studentId);
    setError(null);
    setStatusLine("Sending the stored scan to Anthropic for overnight marking…");
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: [{ studentId, storagePath }] }),
      });
      if (!ok) {
        setStatusLine(null);
        setError((data.error as string) ?? "Could not send this scan for overnight marking.");
        return;
      }
      setStatusLine(
        "Sent for overnight marking at half price. The result appears here when it arrives, usually within the hour; this page checks every 30 seconds. Use 'Mark now' if you need it this minute."
      );
      await loadOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send this scan for overnight marking.");
      setStatusLine(null);
    } finally {
      setBusyStudent(null);
    }
  };

  const runGrading = async (studentId: string, file: File | null) => {
    // A new run replaces the reviewable one. Parts whose new suggestion
    // matches the current one keep their accepted status (the server carries
    // it forward); anything that moves needs review again -- say so before
    // spending the call, since the teacher may have already signed this off.
    const currentRun = runsByStudent[studentId];
    const acceptedCount = currentRun ? acceptanceByRun[currentRun.id]?.accepted ?? 0 : 0;
    if (acceptedCount > 0) {
      const ok = window.confirm(
        `${acceptedCount} part(s) for this student are already accepted into Clev's Marks.\n\n` +
          "Re-marking runs the model again. Parts whose new suggestion matches the current one stay accepted; " +
          "any part whose suggestion changes will need to be reviewed and accepted again. Clev's Marks themselves are not changed.\n\n" +
          "Continue?"
      );
      if (!ok) return;
    }
    setBusyStudent(studentId);
    setError(null);
    setStatusLine(file ? "Uploading scan…" : "Marking the stored scan against the mark scheme…");
    try {
      const body: Record<string, unknown> = { studentId };
      if (file) {
        // Scanned PDFs can exceed Vercel's serverless request-body limit, so
        // upload straight to Storage from the browser (same as the batch
        // upload tab) and send only the path through JSON, never the file.
        const supaModule = await import("@/lib/supabase/client");
        const supabase = supaModule.createClient();
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        const storagePath = `${testId}/${studentId}/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage
          .from("exam-scans")
          .upload(storagePath, file, { contentType: "application/pdf", upsert: true });
        if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
        body.storagePath = storagePath;
        setStatusLine("Marking it against the mark scheme…");
      } else {
        body.reuseExistingScan = true;
      }

      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!ok) {
        setStatusLine(null);
        setError((data.error as string) ?? "Marking failed.");
        return;
      }

      const parts: string[] = [];
      if (typeof data.partsGraded === "number") {
        parts.push(`Marked ${data.partsGraded} of ${data.partsInAssessment ?? data.partsGraded} part(s)`);
      }
      if (data.suggestedTotal !== undefined && data.maxTotal !== undefined) {
        const gradeableSuffix =
          typeof data.testTotalMarks === "number" && data.testTotalMarks !== data.maxTotal
            ? ` of ${data.testTotalMarks} total`
            : "";
        parts.push(`suggested total ${data.suggestedTotal}/${data.maxTotal}${gradeableSuffix}`);
      }
      if (Array.isArray(data.needsReview) && data.needsReview.length > 0) {
        parts.push(`${data.needsReview.length} part(s) flagged for review`);
      }
      if (typeof data.acceptedCarriedForward === "number" && data.acceptedCarriedForward > 0) {
        parts.push(`${data.acceptedCarriedForward} previously accepted part(s) unchanged and still accepted`);
      }
      setStatusLine(parts.length > 0 ? parts.join(", ") + "." : "Marking complete.");

      clearReview();
      setFocusStudent(studentId);
      await loadResultsFor(studentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Marking failed.");
      setStatusLine(null);
    } finally {
      setBusyStudent(null);
    }
  };

  const handleFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    const studentId = pendingUploadStudent.current;
    e.target.value = "";
    pendingUploadStudent.current = null;
    if (file && studentId) await runGrading(studentId, file);
  };

  // -- Accept selected results into Clev's Marks --
  // -- A marking note on a part: the teacher's ruling, read by the marker on
  // every later mark of this paper. Saved on the test item, not the result,
  // because it is about the part, not this one student. --------------------
  const saveMarkingNote = async (itemId: string) => {
    const notes = noteDrafts[itemId] ?? "";
    setSavingNoteFor(itemId);
    setError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/items/${itemId}/marking-notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes.trim() === "" ? null : notes,
          feedbackId: proposals[itemId]?.feedbackId,
        }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not save the marking note.");
        return;
      }
      setProposals((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      const saved = (data.marking_notes as string | null) ?? null;
      setTest((prev) =>
        prev
          ? { ...prev, test_items: prev.test_items.map((it) => (it.id === itemId ? { ...it, marking_notes: saved } : it)) }
          : prev
      );
      setNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setStatusLine(
        saved
          ? "Marking note saved. Clev reads it on every mark of this paper started from now on -- re-mark a student to apply it."
          : "Marking note removed."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the marking note.");
    } finally {
      setSavingNoteFor(null);
    }
  };

  // -- Feedback to the grader, in the teacher's own words, turned into a
  // draft ruling by a model (lib/grader-feedback.ts). The draft lands in the
  // note editor for the teacher to read and save; nothing is written to what
  // the marker reads until they do. --------------------------------------
  const draftFromFeedback = async (itemId: string, resultId: string | null) => {
    const feedback = (feedbackDrafts[itemId] ?? "").trim();
    if (!feedback) return;
    setDraftingFor(itemId);
    setError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/items/${itemId}/grader-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback, resultId }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not draft a ruling from that feedback.");
        return;
      }
      const proposal = data.proposal as { markingNotes: string | null; summary: string; caseMarks: number | null; cannotApply: string | null };
      setProposals((prev) => ({
        ...prev,
        [itemId]: { feedbackId: data.feedbackId as string, summary: proposal.summary, caseMarks: proposal.caseMarks, cannotApply: proposal.cannotApply },
      }));
      if (!proposal.cannotApply && proposal.markingNotes) {
        setNoteDrafts((prev) => ({ ...prev, [itemId]: proposal.markingNotes ?? "" }));
        setFeedbackDrafts((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft a ruling from that feedback.");
    } finally {
      setDraftingFor(null);
    }
  };

  // -- Re-mark ONE part for every student with a stored scan, overnight. The
  // follow-through to a marking note: the ruling was written once, and the
  // class is marked to it without paying for the rest of the paper again.
  // Each request sends the scan and the one part; the collect step carries
  // every other part forward from the student's previous run. ---------------
  const remarkPartForClass = async (itemId: string, label: string) => {
    const targets = students
      .map((st) => ({ studentId: st.profile_id, storagePath: runsByStudent[st.profile_id]?.source_storage_path ?? null }))
      .filter((t): t is { studentId: string; storagePath: string } => !!t.storagePath);
    if (targets.length === 0) {
      setError("No student has a stored scan to re-mark.");
      return;
    }
    const ok = window.confirm(
      `Re-mark ${label} for ${targets.length} student(s) overnight, at half price, using the marking note as it is saved now?\n\n` +
        "Every other part keeps its current mark and acceptance. A student whose suggestion for this part changes will show it for review; one whose suggestion stays the same keeps their acceptance."
    );
    if (!ok) return;
    setRemarkingPartFor(itemId);
    setError(null);
    try {
      // The queue route takes at most 20 students a call and may hand some
      // back as `remaining` when their scans overflow its byte ceiling, so
      // this loops until every target has been submitted or reported failed.
      let sent = 0;
      let failedCount = 0;
      const pending = [...targets];
      let guard = 0;
      while (pending.length > 0 && guard++ < 50) {
        const chunk = pending.splice(0, 20);
        const { ok: okChunk, data } = await fetchJson(`/api/tests/${testId}/ai-grade/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ students: chunk, testItemIds: [itemId] }),
        });
        if (!okChunk) throw new Error((data.error as string) ?? "Could not queue the re-mark.");
        sent += Array.isArray(data.submitted) ? data.submitted.length : 0;
        failedCount += Array.isArray(data.failed) ? data.failed.length : 0;
        const remaining = Array.isArray(data.remaining) ? (data.remaining as { studentId: string; storagePath: string }[]) : [];
        if (remaining.length === chunk.length) throw new Error("The queue accepted none of the remaining students.");
        pending.unshift(...remaining);
      }
      setStatusLine(
        `Sent ${label} for ${sent} student(s) for overnight re-marking${failedCount > 0 ? ` (${failedCount} could not be sent)` : ""}. Results appear as they arrive, usually within the hour; this page checks every 30 seconds.`
      );
      await loadOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue the re-mark.");
    } finally {
      setRemarkingPartFor(null);
    }
  };

  const acceptSelected = async () => {
    if (!focusRunId || selected.size === 0) return;
    setAccepting(true);
    setError(null);
    try {
      const selections = [...selected].map((resultId) => ({
        resultId,
        marks: drafts[resultId],
        note: overrideNotes[resultId]?.trim() || undefined,
      }));
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: focusRunId, selections }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not accept these marks.");
        return;
      }
      setStatusLine(`${data.appliedCount} mark(s) written to Clev's Marks.`);
      if (focusStudent) await loadResultsFor(focusStudent, { afterWrite: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept these marks.");
    } finally {
      setAccepting(false);
    }
  };

  // -- Accept a single result into Clev's Marks (per-row, from the Status column) --
  const acceptOne = async (resultId: string) => {
    if (!focusRunId) return;
    setAcceptingRowId(resultId);
    setError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: focusRunId,
          selections: [{ resultId, marks: drafts[resultId], note: overrideNotes[resultId]?.trim() || undefined }],
        }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not accept this mark.");
        return;
      }
      setStatusLine(`${data.appliedCount} mark(s) written to Clev's Marks.`);
      if (focusStudent) await loadResultsFor(focusStudent, { afterWrite: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept this mark.");
    } finally {
      setAcceptingRowId(null);
    }
  };

  // -- Accept every not-yet-accepted suggested mark, every question, every
  // student's latest completed run -- skips the per-student review entirely,
  // so it asks for confirmation up front rather than after the fact.
  const acceptAllForTest = async () => {
    const ok = window.confirm(
      assessmentKind === "summative"
        ? "This is a summative. It writes only the suggestions Clev was fully confident about, straight into " +
            "Clev's Marks without opening each student's review. Anything less confident, and anything marked " +
            "with no working found, is left for you to check and accept yourself. Continue?"
        : "This writes every suggested mark, for every question, for every student's latest completed run straight into " +
            "Clev's Marks -- without opening each student's review first. Already-accepted marks are left as they are. " +
            "Continue?"
    );
    if (!ok) return;
    setAcceptingAll(true);
    setError(null);
    try {
      const { ok: reqOk, data } = await fetchJson(`/api/tests/${testId}/ai-grade/accept-all`, {
        method: "POST",
      });
      if (!reqOk) {
        setError((data.error as string) ?? "Could not accept all marks.");
        return;
      }
      // On a summative the route holds back every suggestion Clev was not
      // fully confident about and says so in `message`. Appended rather than
      // swapped in: the count that WAS written still matters, and a batch that
      // silently covered less than "accept all" says it does is the failure
      // this exists to prevent.
      const held = (data.message as string | undefined) ?? "";
      setStatusLine(
        `Accepted ${data.appliedCount ?? 0} mark(s) across ${data.studentsProcessed ?? 0} student(s) into Clev's Marks.` +
          (held ? ` ${held}` : "")
      );
      await loadOverview();
      if (focusStudent) await loadResultsFor(focusStudent, { afterWrite: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept all marks.");
    } finally {
      setAcceptingAll(false);
    }
  };

  // -- Manually correct a misread transcription, then re-grade just this part --
  const startEditEvidence = (r: ResultRow) => {
    setEvidenceDraft((prev) => ({ ...prev, [r.id]: r.evidence ?? "" }));
    setEditingEvidenceId(r.id);
  };

  const cancelEditEvidence = () => setEditingEvidenceId(null);

  const saveEvidence = async (r: ResultRow) => {
    const corrected = (evidenceDraft[r.id] ?? "").trim();
    if (corrected === (r.evidence ?? "").trim()) {
      // Nothing actually changed -- just close the editor, no need to re-grade.
      setEditingEvidenceId(null);
      return;
    }
    setRegradingId(r.id);
    setError(null);
    try {
      const { ok, data } = await fetchJson(
        `/api/tests/${testId}/ai-grade/results/${r.id}/regrade`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evidence: corrected }),
        }
      );
      if (!ok) {
        setError((data.error as string) ?? "Could not re-grade this part.");
        return;
      }
      setStatusLine("Transcription corrected and this part re-graded.");
      setEditingEvidenceId(null);
      if (focusStudent) await loadResultsFor(focusStudent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not re-grade this part.");
    } finally {
      setRegradingId(null);
    }
  };

  // Loads one full scanned page for the box editor, with the part's current
  // region already outlined in red by the CV service.
  const loadEditorPage = async (r: ResultRow, page: number) => {
    setBoxEditorLoading(true);
    setBoxEditorError(null);
    try {
      const { ok, data } = await fetchJson(
        `/api/tests/${testId}/ai-grade/results/${r.id}/page-image?page=${page}`
      );
      if (!ok || typeof data.imageBase64 !== "string") {
        setBoxEditorError((data.error as string) ?? "Could not load that page.");
        return;
      }
      setBoxEditor((prev) =>
        prev && prev.result.id === r.id
          ? {
              ...prev,
              page: typeof data.page === "number" ? data.page : page,
              pageCount: typeof data.pageCount === "number" ? data.pageCount : prev.pageCount,
              imageSrc: `data:${
                typeof data.imageMediaType === "string" ? data.imageMediaType : "image/png"
              };base64,${data.imageBase64}`,
            }
          : prev
      );
    } catch (e) {
      setBoxEditorError(e instanceof Error ? e.message : "Could not load that page.");
    } finally {
      setBoxEditorLoading(false);
    }
  };

  // Opens the scanned page a part's crop came from, so a teacher can check it
  // against its surrounding context and, when the region is wrong, drag a
  // correct one. Parts with no crop at all open on page 1 -- they are the ones
  // most in need of this, since the model either mislocated the work or
  // reported none.
  const openBoxEditor = async (r: ResultRow, label: string) => {
    const startPage = r.evidence_box?.page ?? 1;
    setPageImageLoadingId(r.id);
    setBoxEditor({ result: r, label, page: startPage, pageCount: 0, imageSrc: null });
    try {
      await loadEditorPage(r, startPage);
    } finally {
      setPageImageLoadingId(null);
    }
  };

  // Re-cuts this part's crop from the region the teacher drew. Marks are not
  // touched -- see the evidence-box route for why that separation matters.
  const saveEvidenceBox = async (drawn: { x0: number; y0: number; x1: number; y1: number }) => {
    if (!boxEditor) return;
    const { result: r, page } = boxEditor;
    setBoxEditorSaving(true);
    setBoxEditorError(null);
    try {
      const { ok, data } = await fetchJson(
        `/api/tests/${testId}/ai-grade/results/${r.id}/evidence-box`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, ...drawn }),
        }
      );
      if (!ok) {
        setBoxEditorError((data.error as string) ?? "Could not re-cut this crop.");
        return;
      }
      const nextUrl = typeof data.evidence_image_url === "string" ? data.evidence_image_url : null;
      const nextBox = data.evidence_box as ResultRow["evidence_box"];
      setResults((prev) =>
        prev.map((row) =>
          row.id === r.id
            ? {
                ...row,
                evidence_image_url: nextUrl,
                evidence_box: nextBox,
                evidence_box_source:
                  typeof data.evidence_box_source === "string" ? data.evidence_box_source : "teacher",
              }
            : row
        )
      );
      // Make sure the corrected crop is actually visible behind the editor.
      setEvidenceImageShown((prev) => new Set(prev).add(r.id));
      setBoxEditor(null);
      setStatusLine("Evidence region updated and the crop re-cut. The mark is unchanged.");
    } catch (e) {
      setBoxEditorError(e instanceof Error ? e.message : "Could not re-cut this crop.");
    } finally {
      setBoxEditorSaving(false);
    }
  };

  const toggle = (resultId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  /** Re-cutting this student's marker-located crops lower (widen-crops route). */
  const [wideningCrops, setWideningCrops] = useState(false);

  // How many crops on screen the MARKER placed. Those are the biased ones -- a
  // teacher-drawn or layout-cut region is not this button's business -- so this
  // is also whether the button is worth showing at all.
  const modelCropCount = results.filter(
    (r) => (r.evidence_box_source ?? "model") === "model" && r.evidence_image_url
  ).length;

  /**
   * Re-cut every marker-located crop on this student lower, so each reaches the
   * handwriting instead of stopping at the printed prompt above it. Costs no
   * model call and cannot change a mark -- see the widen-crops route.
   */
  const widenCrops = async () => {
    if (!focusRunId || !focusStudent) return;
    setWideningCrops(true);
    setStatusLine("Re-cutting this student's crops lower…");
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/widen-crops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: focusRunId }),
      });
      if (!ok) {
        setStatusLine((data?.error as string) ?? "Could not re-cut this student's crops.");
        return;
      }
      const widened = Number(data?.widened ?? 0);
      // Reloaded rather than patched: every widened row has a new image path
      // whose signed URL is minted server-side.
      await loadResultsFor(focusStudent);
      setStatusLine(
        widened > 0
          ? `${widened} crop(s) re-cut lower. The marks are unchanged.`
          : ((data?.message as string) ?? "Nothing needed re-cutting on this student.")
      );
    } finally {
      setWideningCrops(false);
    }
  };

  /**
   * Selects, or clears, every confident part the summary row is hiding, so a
   * teacher can accept the lot without expanding it. Only parts not already in
   * Clev's Marks are touched -- an accepted one is done with.
   */
  const toggleAllHighConfidence = (rows: ResultRow[]) => {
    if (rows.length === 0) return;
    const allSelected = rows.every((r) => selected.has(r.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (allSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  };

  const toggleQuestionImage = (resultId: string) =>
    setQuestionImageShown((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  const toggleEvidenceImage = (resultId: string) =>
    setEvidenceImageShown((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  const toggleMarkschemeImage = (resultId: string) =>
    setMarkschemeImageShown((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  if (loading) {
    return <p className="text-sm text-da-muted">Loading this assessment…</p>;
  }

  if (!test) {
    return (
      <div className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-300">
        {error ?? "This assessment could not be loaded."}
      </div>
    );
  }

  const totalItems = test.test_items.length;
  const maxTotal = test.test_items.reduce((s, i) => s + i.max_marks, 0);
  const suggestedTotal = results.reduce((s, r) => s + (drafts[r.id] ?? 0), 0);
  const focusRun = focusStudent ? runsByStudent[focusStudent] : null;
  // The strand levels the marks on screen would give, recomputed as the
  // teacher edits them -- so a change to one part shows what it does to the
  // strand before it is accepted. Suggestions, not Clev's Marks: the
  // standards report page is the one that reads accepted marks.
  const liveStandardsReport =
    standardsRubric && results.length > 0
      ? buildStandardsReport(
          standardsRubric,
          test.test_items.map((i) => ({ id: i.id, question_number: i.question_number, part_label: i.part_label, max_marks: i.max_marks })),
          Object.fromEntries(results.map((r) => [r.test_item_id, drafts[r.id] ?? 0]))
        )
      : null;

  // -- One review row, plus its "Why?" panel -------------------------------
  // Rendered from two lists -- the parts needing a look, and the confident
  // ones behind the summary row -- so the caller passes the row that precedes
  // it in ITS OWN list: that is what decides whether this row prints its
  // question's shared stem.
  const renderResultRow = (r: ResultRow, prevRow: ResultRow | undefined) => {
    const meta = itemById.get(r.test_item_id);
    const label = itemLabel(meta, paperPrefixes);
    const isOpen = expanded === r.id;
    // What Clev's Marks actually holds for this part right now, so an edit
    // after acceptance can tell "nothing changed" from "needs writing".
    const currentlyAccepted = r.accepted ? (r.marks_awarded ?? r.suggested_marks) : null;
    const draftDiffersFromAccepted = (drafts[r.id] ?? r.suggested_marks) !== currentlyAccepted;
    // The stem is stored on every part row, so printing it per row would
    // repeat "Look at this expression..." four times down Q1. Print it on the
    // first part of each question only, the way the paper itself reads.
    const prevMeta = prevRow ? itemById.get(prevRow.test_item_id) : undefined;
    const stem =
      meta?.stem_text?.trim() && meta.question_number !== prevMeta?.question_number
        ? meta.stem_text.trim()
        : null;
    // Why this row is not "high", if it is not. The validator records every
    // reason it touched a part in the run's warnings, keyed by the part's
    // label; a non-high row with none of its own is the marker's own call.
    // Shown on the badge so a teacher can tell a wording flag ("careful
    // wording") from a mark in doubt ("breakdown disagreed with the total")
    // without opening the row.
    const rowLabel = meta ? partWarningLabel(meta) : null;
    const rowWarnings = rowLabel ? warningsForPart(rowLabel, focusRun?.coverage?.warnings) : [];
    const rowCause = rowLabel ? capCauseForPart(rowLabel, focusRun?.coverage?.warnings) : "none";
    const confidenceTitle =
      r.confidence === "high"
        ? undefined
        : rowWarnings.length > 0
          ? rowWarnings.join("\n")
          : "The marker's own call: it judged this part a judgement call. Open Why? for its reasoning.";
    return (
      <Fragment key={r.id}>
        <tr className="border-b border-da-border">
          <td className="px-4 py-2">
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
              aria-label={`Accept ${label}`}
            />
          </td>
          <td className="px-2 py-2 font-medium text-da-text">
            <div className="flex items-center gap-2">
              <span>{label}</span>
              {meta?.marking_notes?.trim() && (
                <span
                  title={`Marking note on this part: ${meta.marking_notes.trim()}`}
                  className="rounded border border-teal-400/40 bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-300"
                >
                  note
                </span>
              )}
              {/* The question itself, at a glance. It was already in
                  the expanded panel below, but two clicks deep (Why?,
                  then the collapsed Question toggle) -- so marking a
                  row meant remembering what the question asked.
                  Click enlarges it in the same lightbox the panel
                  uses. Rows whose part has no image on file in the
                  PPQ bank simply show the label, as before. */}
              {r.question_image_urls.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setLightboxUrl(r.question_image_urls[0])}
                  title={`Enlarge the question for ${label}`}
                  className="relative shrink-0 rounded border border-da-border hover:border-blue-400"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.question_image_urls[0]}
                    alt={`Question ${label}`}
                    // object-CONTAIN, not cover: a cropped thumbnail showed
                    // the top-left corner of the question and hid the rest,
                    // which is worse than useless on a question whose figure
                    // sits at the bottom. Whole question, scaled down.
                    className="h-40 w-96 cursor-zoom-in rounded bg-white/5 object-contain"
                  />
                  {r.question_image_urls.length > 1 && (
                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px] leading-4 text-white">
                      +{r.question_image_urls.length - 1}
                    </span>
                  )}
                </button>
              ) : (
                (stem || meta?.question_text?.trim()) && (
                  // A teacher-authored part has no image anywhere -- not in
                  // the PPQ bank, and a Grade 9 paper has no locked layout to
                  // cut one from -- so the question itself is the text.
                  // Clamped to two lines, with the full wording on hover, so
                  // a long stem cannot stretch the row.
                  <span className="max-w-md text-xs font-normal">
                    {stem && (
                      <span
                        title={stem}
                        className="line-clamp-2 text-da-text/80"
                      >
                        <LatexRenderer latex={stem} />
                      </span>
                    )}
                    {meta?.question_text?.trim() && (
                      <span
                        title={meta.question_text}
                        className="line-clamp-2 text-da-muted"
                      >
                        <LatexRenderer latex={meta.question_text} />
                      </span>
                    )}
                  </span>
                )
              )}
            </div>
          </td>
          <td className="px-2 py-2">
            <input
              type="number"
              min={0}
              max={r.max_marks}
              value={drafts[r.id] ?? 0}
              onChange={(e) =>
                setDrafts((prev) => ({
                  ...prev,
                  [r.id]: Math.max(
                    0,
                    Math.min(r.max_marks, Number(e.target.value))
                  ),
                }))
              }
              className="w-16 rounded border border-da-border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400"
            />
            {(drafts[r.id] ?? r.suggested_marks) !== r.suggested_marks && (!r.accepted || draftDiffersFromAccepted) && (
              <input
                type="text"
                value={overrideNotes[r.id] ?? ""}
                onChange={(e) => setOverrideNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                placeholder={`Why ${drafts[r.id]} not ${r.suggested_marks}? (optional, kept with the mark)`}
                title="Written into the audit trail with this mark. A ruling that should change how this part is marked from now on goes in the marking note under Why?."
                className="mt-1 block w-56 rounded border border-amber-400/40 bg-transparent px-2 py-0.5 text-xs focus:ring-2 focus:ring-blue-400"
              />
            )}
            {previousMarks[r.test_item_id] !== undefined &&
              previousMarks[r.test_item_id] !== r.suggested_marks && (
                <span
                  className="ml-2 whitespace-nowrap rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300"
                  title="The previous completed run suggested a different mark for this part -- the model is not certain here, so it is worth a look."
                >
                  was {previousMarks[r.test_item_id]}
                </span>
              )}
          </td>
          <td className="px-2 py-2 text-da-muted">{r.max_marks}</td>
          <td className="px-2 py-2">
            <span
              title={confidenceTitle}
              className={`rounded border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[r.confidence]}`}
            >
              {r.confidence}
            </span>
            {!r.work_found && (
              <span className="ml-2 text-xs text-da-muted">no attempt found</span>
            )}
            {r.confidence !== "high" && r.work_found && (
              <div className="mt-1 max-w-[12rem] text-[11px] leading-tight text-da-muted" title={confidenceTitle}>
                {CAP_CAUSE_SHORT[rowCause]}
              </div>
            )}
          </td>
          <td className="px-2 py-2 text-xs text-da-muted">
            {SOURCE_LABEL[r.markscheme_source]}
          </td>
          <td className="px-2 py-2">
            <div className="flex flex-col items-start gap-1">
              {r.accepted && <span className="text-xs text-green-300">accepted</span>}
              {(!r.accepted || draftDiffersFromAccepted) && (
                <button
                  type="button"
                  onClick={() => acceptOne(r.id)}
                  disabled={acceptingRowId === r.id}
                  title={r.accepted ? "Write this edited mark into Clev's Marks" : undefined}
                  className="rounded border border-blue-400/40 px-2 py-0.5 text-xs font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                >
                  {acceptingRowId === r.id ? (r.accepted ? "Updating…" : "Accepting…") : r.accepted ? "Update" : "Accept"}
                </button>
              )}
            </div>
          </td>
          <td className="px-2 py-2">
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : r.id)}
              className="text-xs text-blue-300 hover:underline"
            >
              {isOpen ? "Hide" : "Why?"}
            </button>
          </td>
        </tr>

        {isOpen && (
          <tr className="bg-da-hover">
            <td colSpan={8} className="px-6 py-4">
              <div className="space-y-3">
                {r.mark_breakdown.length > 0 && (
                  <div className="space-y-1.5">
                    {groupMarkBreakdownByPart(r.mark_breakdown).map((group, gi) => (
                      <div key={gi} className="flex flex-wrap items-center gap-2">
                        {group.part && (
                          <span className="text-xs font-semibold text-da-muted">{group.part}</span>
                        )}
                        {group.entries.map((b, i) => (
                          <span
                            key={i}
                            className={`rounded border px-2 py-0.5 text-xs ${
                              b.awarded
                                ? "border-green-400/40 bg-green-500/15 text-green-300"
                                : "border-da-border bg-da-surface text-da-muted line-through"
                            }`}
                            title={b.note}
                          >
                            {b.token}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {r.question_image_urls.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => toggleQuestionImage(r.id)}
                      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-da-muted hover:text-da-text"
                    >
                      <span>{questionImageShown.has(r.id) ? "▾" : "▸"}</span>
                      Question
                    </button>
                    {questionImageShown.has(r.id) && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {r.question_image_urls.map((url, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={url}
                            alt="Question source image"
                            title="Click to enlarge"
                            onClick={() => setLightboxUrl(url)}
                            className="max-h-64 cursor-zoom-in rounded border border-da-border hover:border-blue-400"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2">
                    {r.evidence_image_url ? (
                      <button
                        type="button"
                        onClick={() => toggleEvidenceImage(r.id)}
                        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-da-muted hover:text-da-text"
                      >
                        <span>{evidenceImageShown.has(r.id) ? "▾" : "▸"}</span>
                        Student&apos;s work
                      </button>
                    ) : (
                      <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                        Student&apos;s work
                      </p>
                    )}
                    {r.evidence_box_source === "teacher" && (
                      <span
                        title="You drew this region by hand; the crop was re-cut from it."
                        className="rounded border border-green-400/40 bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-300"
                      >
                        Region set by you
                      </span>
                    )}
                    {r.evidence_box_source === "anchor" && (
                      <span
                        title="Cut from this paper's locked layout, not located by the marker."
                        className="rounded border border-blue-400/40 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300"
                      >
                        Paper layout
                      </span>
                    )}
                    {/* A model-located region is an estimate, and a biased one --
                        it reads high, so the crop can show the part above this
                        one. Badging it is the difference between a teacher
                        spotting that and trusting it: the mark is argued from
                        the transcription below, which stays right even when the
                        picture is wrong. Only shown when there IS a crop; a row
                        with none already says so with "Locate on page". */}
                    {(r.evidence_box_source === "model" || !r.evidence_box_source) &&
                      r.evidence_image_url && (
                        <span
                          title="The marker estimated this region rather than cutting it from a locked paper layout, and its estimates read high. Check the crop shows THIS part's answer; if it does not, use the ⤢ button to redraw it, or Fix crops above to re-cut every one lower."
                          className="rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
                        >
                          Located by marker
                        </span>
                      )}
                    {!r.evidence_image_url && (
                      <button
                        type="button"
                        onClick={() => openBoxEditor(r, label)}
                        disabled={pageImageLoadingId === r.id}
                        title="Open the scanned page and draw where this part's work is"
                        className="text-xs text-blue-400 underline underline-offset-2 hover:text-blue-300 disabled:opacity-50"
                      >
                        {pageImageLoadingId === r.id ? "Opening…" : "Locate on page"}
                      </button>
                    )}
                  </div>
                  <div className="mt-1 space-y-2">
                    {evidenceImageShown.has(r.id) && r.evidence_image_url && (
                      <div className="relative inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.evidence_image_url}
                          alt="Cropped scan region the model read this part's work from"
                          title="Click to enlarge"
                          onClick={() => setLightboxUrl(r.evidence_image_url)}
                          className="max-h-64 cursor-zoom-in rounded border border-da-border hover:border-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => openBoxEditor(r, label)}
                          disabled={pageImageLoadingId === r.id}
                          title="Show the full page this crop came from, and redraw the region if it is wrong"
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded bg-black/60 text-xs text-white hover:bg-black/80 disabled:opacity-50"
                        >
                          {pageImageLoadingId === r.id ? "…" : "⤢"}
                        </button>
                      </div>
                    )}
                    {editingEvidenceId === r.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={evidenceDraft[r.id] ?? ""}
                          onChange={(e) =>
                            setEvidenceDraft((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                          rows={3}
                          placeholder="Correct the transcription of the student's work for this part -- checked against the scan above -- then save to re-grade it."
                          className="w-full rounded border border-da-border p-2 font-mono text-xs focus:ring-2 focus:ring-blue-400"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEvidence(r)}
                            disabled={regradingId === r.id}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {regradingId === r.id ? "Re-grading…" : "Save & re-grade"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditEvidence}
                            disabled={regradingId === r.id}
                            className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => startEditEvidence(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            startEditEvidence(r);
                          }
                        }}
                        title="Click to fix transcription"
                        className="cursor-text rounded border border-da-border bg-da-surface p-3 hover:border-blue-400 hover:bg-blue-500/30"
                      >
                        {r.evidence ? (
                          <LatexRenderer latex={r.evidence} />
                        ) : (
                          <p className="text-xs text-da-muted">
                            No transcription on file -- click to add one.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {r.markscheme_image_urls.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => toggleMarkschemeImage(r.id)}
                      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-da-muted hover:text-da-text"
                    >
                      <span>{markschemeImageShown.has(r.id) ? "▾" : "▸"}</span>
                      Mark scheme
                    </button>
                    {markschemeImageShown.has(r.id) && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {r.markscheme_image_urls.map((url, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={url}
                            alt="Mark scheme source image"
                            title="Click to enlarge"
                            onClick={() => setLightboxUrl(url)}
                            className="max-h-64 cursor-zoom-in rounded border border-da-border hover:border-blue-400"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {r.reasoning && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                      Examiner reasoning
                    </p>
                    <div className="mt-1 rounded border border-da-border bg-da-surface p-3">
                      <LatexRenderer latex={r.reasoning} />
                    </div>
                  </div>
                )}

                {r.confidence !== "high" && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                      Confidence: {r.confidence}
                    </p>
                    {rowWarnings.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-xs text-amber-300">
                        {rowWarnings.map((w, i) => (
                          <li key={i}>⚠ {w}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-da-muted">
                        The marker&apos;s own call: nothing was corrected after the fact, it judged this
                        part a judgement call. Its reasoning above says why.
                      </p>
                    )}
                  </div>
                )}

                {meta && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                      Marking note for {label} (every student on this paper)
                    </p>
                    <p className="mt-1 text-xs text-da-muted">
                      Clev reads this after the mark scheme on every mark of this paper started from now on:
                      a re-mark, the overnight queue, the eval. Use it to settle a judgement call once, e.g.
                      &ldquo;M1 is for visible substitution into both expressions; 48(4)+30(6)=192+180 alone
                      earns it.&rdquo; Where it conflicts with the scheme, the note wins.
                    </p>

                    {/* Feedback in the teacher's own words. A model turns it into the
                        ruling above, with this student's result as the worked case; the
                        draft is only saved once the teacher has read it. */}
                    <div className="mt-2 rounded border border-da-border bg-da-bg/60 p-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-da-muted">
                        Feedback to the grader
                      </p>
                      <p className="mt-0.5 text-xs text-da-muted">
                        Say what the grader got wrong or should do differently on this part, in your own
                        words. It is turned into a precise ruling for the note above, using this
                        student&apos;s result as the example, for you to check before it is saved.
                      </p>
                      <textarea
                        value={feedbackDrafts[meta.id] ?? ""}
                        onChange={(e) => setFeedbackDrafts((prev) => ({ ...prev, [meta.id]: e.target.value }))}
                        rows={2}
                        maxLength={4000}
                        placeholder="e.g. A substitution shown but not finished still earns the M mark here."
                        className="mt-1 w-full rounded border border-da-border p-2 text-xs focus:ring-2 focus:ring-blue-400"
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => draftFromFeedback(meta.id, r.id)}
                          disabled={draftingFor === meta.id || !(feedbackDrafts[meta.id] ?? "").trim()}
                          className="rounded border border-teal-400/40 px-3 py-1 text-xs font-medium text-teal-300 hover:bg-teal-500/15 disabled:opacity-50"
                        >
                          {draftingFor === meta.id ? "Drafting a ruling…" : "Turn into a marking rule"}
                        </button>
                        {proposals[meta.id] && (
                          <span className="text-xs text-da-muted">
                            {proposals[meta.id].cannotApply
                              ? `Not applied: ${proposals[meta.id].cannotApply}`
                              : `${proposals[meta.id].summary}${
                                  proposals[meta.id].caseMarks !== null
                                    ? ` This student would score ${proposals[meta.id].caseMarks}/${r.max_marks}.`
                                    : ""
                                } Read the draft below, then Save note.`}
                          </span>
                        )}
                      </div>
                    </div>
                    {noteDrafts[meta.id] !== undefined ? (
                      <div className="mt-1 space-y-2">
                        <textarea
                          value={noteDrafts[meta.id]}
                          onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [meta.id]: e.target.value }))}
                          rows={3}
                          maxLength={4000}
                          placeholder="A ruling for this part, in the words you would give a second marker."
                          className="w-full rounded border border-da-border p-2 text-xs focus:ring-2 focus:ring-blue-400"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveMarkingNote(meta.id)}
                            disabled={savingNoteFor === meta.id}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingNoteFor === meta.id ? "Saving…" : "Save note"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setNoteDrafts((prev) => {
                                const next = { ...prev };
                                delete next[meta.id];
                                return next;
                              })
                            }
                            disabled={savingNoteFor === meta.id}
                            className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setNoteDrafts((prev) => ({ ...prev, [meta.id]: meta.marking_notes ?? "" }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setNoteDrafts((prev) => ({ ...prev, [meta.id]: meta.marking_notes ?? "" }));
                          }
                        }}
                        title="Click to edit the marking note"
                        className="mt-1 cursor-text rounded border border-da-border bg-da-surface p-3 hover:border-blue-400 hover:bg-blue-500/30"
                      >
                        {meta.marking_notes?.trim() ? (
                          <p className="whitespace-pre-wrap text-xs text-da-text">{meta.marking_notes}</p>
                        ) : (
                          <p className="text-xs text-da-muted">No marking note on this part -- click to add one.</p>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => remarkPartForClass(meta.id, label)}
                        disabled={remarkingPartFor === meta.id}
                        title="Sends only this part, for every student with a stored scan, to Anthropic's batch tier. Every other part keeps its current mark and acceptance."
                        className="rounded border border-teal-400/40 px-3 py-1 text-xs font-medium text-teal-300 hover:bg-teal-500/15 disabled:opacity-50"
                      >
                        {remarkingPartFor === meta.id ? "Queuing…" : `Re-mark ${label} for the whole class (overnight)`}
                      </button>
                      <span className="text-[11px] text-da-muted">
                        About a third of a full re-mark per student; the rest of each paper is carried forward.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  // -- One student's review table, rendered inline under their roster row --
  // Its rows are split in two: the parts that still need a human first, then
  // every high-confidence part under one summary row that folds them away.
  const renderReviewPanel = () => {
    const ordered = sortReviewRows(results, (r) => itemById.get(r.test_item_id));
    const { high, needsLook } = partitionByConfidence(ordered);
    // What the summary row has to answer without being expanded: how many
    // parts, what they add up to, and whether any of them is the kind of
    // "confident" a teacher would still want to see -- no working found, or a
    // mark that moved since the previous run.
    const highSuggested = high.reduce((sum, r) => sum + (drafts[r.id] ?? 0), 0);
    const highMax = high.reduce((sum, r) => sum + r.max_marks, 0);
    const highNoWork = high.filter((r) => !r.work_found).length;
    const highChanged = high.filter(
      (r) =>
        previousMarks[r.test_item_id] !== undefined &&
        previousMarks[r.test_item_id] !== r.suggested_marks
    ).length;
    const highAccepted = high.filter((r) => r.accepted).length;
    // The summary row's own checkbox covers the confident parts not yet in
    // Clev's Marks -- the ones it is hiding that an accept would still act on.
    const highPending = high.filter((r) => !r.accepted);
    const highPendingSelected = highPending.filter((r) => selected.has(r.id)).length;
    return (
      <div className="rounded-lg border border-da-border bg-da-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-da-text">
              Review — {students.find((s) => s.profile_id === focusStudent)?.display_name}
            </h3>
            <p className="text-xs text-da-muted">
              Suggested total {suggestedTotal} / {maxTotal}. Edit any value before accepting.
              {needsLook.length === 0 &&
                high.length > 0 &&
                " Every part came back high confidence — nothing is flagged for a look."}
            </p>
            {focusStudent && newerAttemptByStudent[focusStudent] && (
              <p className="mt-1 text-xs text-amber-300">
                {newerAttemptByStudent[focusStudent].status === "submitted" ? (
                  <>⚠ Being marked overnight — results appear here when they arrive. Showing the last completed run.</>
                ) : (
                  <>
                    ⚠ A newer re-mark {newerAttemptByStudent[focusStudent].status === "failed" ? "failed" : "is still running"}
                    {newerAttemptByStudent[focusStudent].error ? ` — ${newerAttemptByStudent[focusStudent].error}` : ""}. Showing the last completed run.
                  </>
                )}
              </p>
            )}
            {focusRun?.coverage?.warnings && focusRun.coverage.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-300">
                {focusRun.coverage.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            {liveStandardsReport && (
              <div className="mt-3 rounded-lg border border-da-border bg-da-bg/60 p-2">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-da-muted">
                  Strand levels from the marks above (suggested, not yet Clev&apos;s Marks)
                </p>
                <StandardsReportTable report={liveStandardsReport} compact />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Only offered when there is something biased to fix. A paper with
                a locked layout has measured regions and never shows this. */}
            {modelCropCount > 0 && (
              <button
                type="button"
                onClick={widenCrops}
                disabled={wideningCrops}
                title={`Re-cut the ${modelCropCount} crop(s) the marker located on this student, reaching further down the page so each one shows the answer rather than the question above it. No mark changes.`}
                className="rounded-lg border border-amber-400/40 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/15 disabled:opacity-50"
              >
                {wideningCrops ? "Re-cutting…" : "Fix crops"}
              </button>
            )}
            <button
              type="button"
              onClick={acceptSelected}
              disabled={accepting || selected.size === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {accepting ? "Writing…" : `Accept ${selected.size} into Clev's Marks`}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                <th className="px-4 py-2 font-semibold">
                  <span className="sr-only">Accept</span>
                </th>
                <th className="px-2 py-2 font-semibold">Question</th>
                <th className="px-2 py-2 font-semibold">Suggested</th>
                <th className="px-2 py-2 font-semibold">Max</th>
                <th className="px-2 py-2 font-semibold">Confidence</th>
                <th className="px-2 py-2 font-semibold">Mark scheme</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {needsLook.map((r, i) => renderResultRow(r, needsLook[i - 1]))}

              {high.length > 0 && (
                <>
                  <tr className="border-b border-da-border bg-da-hover/60">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={highPending.length > 0 && highPendingSelected === highPending.length}
                        // Some-but-not-all shows as the mixed state rather
                        // than unchecked, so the box never claims none of the
                        // hidden parts is selected when some of them are.
                        ref={(el) => {
                          if (el) {
                            el.indeterminate =
                              highPendingSelected > 0 && highPendingSelected < highPending.length;
                          }
                        }}
                        disabled={highPending.length === 0}
                        onChange={() => toggleAllHighConfidence(highPending)}
                        title={
                          highPending.length === 0
                            ? "Every high-confidence part is already in Clev's Marks"
                            : `Accept all ${highPending.length} high-confidence part(s) not yet in Clev's Marks`
                        }
                        aria-label="Accept every high-confidence part not yet in Clev's Marks"
                      />
                    </td>
                    <td colSpan={7} className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setHighConfidenceOpen((open) => !open)}
                          aria-expanded={highConfidenceOpen}
                          title="Clev was confident about these parts — expand to check any of them"
                          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-da-muted hover:text-da-text"
                        >
                          <span>{highConfidenceOpen ? "▾" : "▸"}</span>
                          {high.length} high-confidence part{high.length === 1 ? "" : "s"}
                        </button>
                        <span
                          className={`rounded border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE.high}`}
                        >
                          high
                        </span>
                        <span className="text-xs text-da-muted">
                          {highSuggested}/{highMax} suggested
                          {highAccepted > 0 && ` · ${highAccepted} accepted`}
                        </span>
                        {highNoWork > 0 && (
                          <span
                            className="text-xs text-amber-300"
                            title="Clev was confident there is no attempt to mark for these parts. Expand to check them against the scan."
                          >
                            · {highNoWork} with no attempt found
                          </span>
                        )}
                        {highChanged > 0 && (
                          <span
                            className="text-xs text-amber-300"
                            title="The previous completed run suggested a different mark for these parts. Expand to see which."
                          >
                            · {highChanged} changed since the last run
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {highConfidenceOpen && high.map((r, i) => renderResultRow(r, high[i - 1]))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {apiHealthError && (
        <div
          role="alert"
          className="rounded-lg border border-red-400/60 bg-red-500/15 px-4 py-3 text-sm text-red-200"
        >
          <p className="font-semibold">AI marking is currently unavailable.</p>
          <p className="mt-1">
            The Anthropic API refused a test call from this deployment&apos;s key, so every marking action on
            this page (and every other AI feature in the app) will fail the same way until it is fixed. The
            usual cause is the account running out of credit:{" "}
            <a
              href="https://console.anthropic.com/settings/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline hover:text-red-100"
            >
              Anthropic Console → Plans &amp; Billing
            </a>
            .
          </p>
          <p className="mt-1 break-words font-mono text-xs text-red-300/90">{apiHealthError}</p>
        </div>
      )}

      {/* -- Tabs ---------------------------------------------------------- */}
      <div className="flex gap-1 rounded-lg border border-da-border bg-da-hover p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab("individual")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "individual" ? "bg-da-surface text-da-text shadow-sm" : "text-da-muted hover:text-da-text"
          }`}
        >
          Individual
        </button>
        <button
          type="button"
          onClick={() => setTab("batch")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "batch" ? "bg-da-surface text-da-text shadow-sm" : "text-da-muted hover:text-da-text"
          }`}
        >
          Batch upload
        </button>
      </div>

      {submittedStudentCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 py-3 text-sm text-blue-300">
          <p>
            {submittedStudentCount} student{submittedStudentCount === 1 ? " is" : "s are"} being marked
            overnight. Results appear here as they arrive — this page checks every 30 seconds while
            it is open, and Anthropic keeps them for 29 days, so closing the tab loses nothing.
          </p>
          <button
            type="button"
            onClick={() => void runCollect()}
            disabled={collecting}
            title="Ask Anthropic for any batch that has finished since this page last looked"
            className="rounded border border-blue-400/40 bg-da-surface px-3 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
          >
            {collecting ? "Checking…" : "Check for results"}
          </button>
        </div>
      )}

      {collectError && submittedStudentCount > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-300"
        >
          <p>Checking for overnight results stopped: {collectError}</p>
          <button
            type="button"
            onClick={() => setCollectError(null)}
            className="rounded border border-amber-400/40 bg-da-surface px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Kept mounted (not conditionally rendered) so switching to Individual
          and back doesn't wipe BatchGradeTab's own state — its matched rows
          and grading progress live in that component, not here, and a
          conditional render would unmount and reset it on every tab switch. */}
      <div className={tab === "batch" ? undefined : "hidden"}>
        <BatchGradeTab testId={testId} students={students} />
      </div>

      {tab === "individual" && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFilePicked}
            className="hidden"
          />

          {error && (
            <div className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-300">
              {error}
              {/* An expired sign-in is the one error with a one-click fix, and
               *  the teacher lands back on this same screen. Signing in does
               *  not recover the review selections held in memory, so the
               *  link is offered, never followed automatically -- a redirect
               *  fired from under a half-finished review would discard it. */}
              {error.includes(SESSION_EXPIRED_MESSAGE) && (
                <>
                  {" "}
                  <a
                    className="font-medium underline underline-offset-2 hover:text-red-200"
                    href={`/login?redirectTo=${encodeURIComponent(
                      `/dashboard/tests/${testId}/ai-grade`
                    )}`}
                  >
                    Sign in again
                  </a>
                </>
              )}
            </div>
          )}

          {statusLine && (
            <div className="rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 py-3 text-sm text-blue-300">
              {statusLine}
            </div>
          )}

          {/* -- Assessment summary ------------------------------------------ */}
          <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
            <h2 className="text-lg font-bold text-da-text">{test.name}</h2>
            <p className="mt-1 text-sm text-da-muted">
              {totalItems} part{totalItems === 1 ? "" : "s"} · {maxTotal} marks total. Upload a
              scanned PDF per student — the model marks it against the mark scheme stored in the
              PPQ bank. Nothing reaches Clev&apos;s Marks until you review and accept it below.
            </p>
            {standardsRubric && (
              <p className="mt-2 text-sm text-da-muted">
                <span className="rounded border border-teal-400/40 bg-teal-500/15 px-1.5 py-0.5 text-xs font-medium text-teal-300">
                  Standard Level
                </span>{" "}
                Marked under the Grade 9 Standard Level policy: {standardsRubric.strands.length} strands
                ({standardsRubric.strands.map((s) => s.code).join(", ")}), reported as Exceeding / Meeting /
                Approaching / Beginning.{" "}
                <a href={`/dashboard/tests/${testId}/standards-report`} className="text-blue-300 hover:underline">
                  Standards report →
                </a>
              </p>
            )}
          </section>

          {/* -- Students ----------------------------------------------------- */}
          <section className="rounded-xl border border-da-border bg-da-surface shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
              <h2 className="text-lg font-bold text-da-text">Students</h2>
              {Object.keys(runsByStudent).length > 0 && (
                <button
                  type="button"
                  onClick={acceptAllForTest}
                  disabled={acceptingAll}
                  title="Accepts every suggested mark for every student's latest completed run, without opening each review individually"
                  className="rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                >
                  {acceptingAll ? "Accepting all…" : "Accept all into Clev's Marks"}
                </button>
              )}
            </div>

            {students.length === 0 && (
              <p className="px-5 py-4 text-sm text-da-muted">
                No students are enrolled in this assessment&apos;s class.
              </p>
            )}

            <ul className="divide-y divide-da-border">
              {students.map((s, i) => {
                // Class heading above the first student of each class, only
                // when the roster spans more than one (a pooled Grade 9 track).
                const classHeading =
                  classCount > 1 && (i === 0 || students[i - 1].class_name !== s.class_name)
                    ? (s.class_name ?? "Other")
                    : null;
                const busy = busyStudent === s.profile_id;
                const reviewOpen = focusStudent === s.profile_id;
                const absent = absentStudents.has(s.profile_id);
                const run = runsByStudent[s.profile_id];
                const newerAttempt = newerAttemptByStudent[s.profile_id];
                const acceptance = run ? acceptanceByRun[run.id] : undefined;
                const dot =
                  run?.status === "complete" && acceptance && acceptance.total > 0
                    ? acceptance.accepted === acceptance.total
                      ? { color: "bg-green-500", title: "All suggested marks accepted into Clev's Marks" }
                      : acceptance.accepted === 0
                        ? { color: "bg-red-500", title: "No suggested marks accepted yet" }
                        : {
                            color: "bg-amber-500",
                            title: `${acceptance.accepted} of ${acceptance.total} suggested marks accepted`,
                          }
                    : null;
                return (
                  <Fragment key={s.profile_id}>
                    {classHeading && (
                      <li className="bg-da-hover/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-da-muted">
                        {classHeading}
                      </li>
                    )}
                    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="flex items-center gap-2 font-semibold text-da-text">
                          {dot && (
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${dot.color}`}
                              role="img"
                              aria-label={dot.title}
                              title={dot.title}
                            />
                          )}
                          {s.display_name}
                          {absent && (
                            <span className="rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                              Absent
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-da-muted">
                          {absent && !run ? (
                            "Recorded as absent — no script to mark"
                          ) : run ? (
                            <>
                              Last run: {run.status}
                              {run.coverage?.suggestedTotal !== undefined &&
                                run.coverage?.maxTotal !== undefined &&
                                ` · ${run.coverage.suggestedTotal}/${run.coverage.maxTotal}${
                                  typeof run.coverage.testTotalMarks === "number" &&
                                  run.coverage.testTotalMarks !== run.coverage.maxTotal
                                    ? ` of ${run.coverage.testTotalMarks} total`
                                    : ""
                                } suggested`}
                              {run.error && ` — ${run.error}`}
                            </>
                          ) : newerAttempt ? (
                            "No completed run yet"
                          ) : (
                            "No scan graded yet"
                          )}
                        </p>
                        {newerAttempt && (
                          <p className="text-xs text-amber-300">
                            {newerAttempt.status === "failed"
                              ? `A newer re-mark failed${newerAttempt.error ? ` — ${newerAttempt.error}` : ""}. ${
                                  run ? "The last completed run is still shown." : ""
                                }`
                              : newerAttempt.status === "submitted"
                                ? "Being marked overnight — results appear here when they arrive."
                                : "A newer re-mark is still running."}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            pendingUploadStudent.current = s.profile_id;
                            fileInputRef.current?.click();
                          }}
                          className="rounded border border-blue-400/40 bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                        >
                          {busy ? "Working…" : "Upload scan & mark"}
                        </button>

                        {(run?.source_storage_path || newerAttempt?.source_storage_path) && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => queueRemark(s.profile_id)}
                              title="Sends the stored scan to Anthropic's batch tier: the same marking at half price, result usually within the hour, collected by this page."
                              className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                            >
                              Re-mark stored scan (overnight, half price)
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => runGrading(s.profile_id, null)}
                              title="Marks the stored scan right now at full price, with this tab open."
                              className="rounded border border-da-border px-2 py-1 text-[11px] text-da-muted/80 hover:bg-da-hover disabled:opacity-50"
                            >
                              Mark now
                            </button>
                          </>
                        )}

                        {run?.status === "complete" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (reviewOpen) closeReview();
                              else void openReview(s.profile_id);
                            }}
                            aria-expanded={reviewOpen}
                            title={
                              reviewOpen
                                ? "Collapse this student's marks"
                                : "Show this student's marks below this row"
                            }
                            className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
                          >
                            {reviewOpen ? "Hide review ▴" : "Review ▾"}
                          </button>
                        )}

                        {absent ? (
                          <button
                            type="button"
                            disabled={absenceBusy === s.profile_id}
                            onClick={() => setAbsent(s.profile_id, false)}
                            title="Remove the absence record for this test"
                            className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                          >
                            Not absent
                          </button>
                        ) : (
                          !run &&
                          !newerAttempt && (
                            <button
                              type="button"
                              disabled={absenceBusy === s.profile_id}
                              onClick={() => setAbsent(s.profile_id, true)}
                              title="Record that this student did not sit the test — shows as Absent here and in the gradebook"
                              className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                            >
                              Mark absent
                            </button>
                          )
                        )}
                      </div>
                    </li>
                    {/* This student's marks, inline under their own row. It
                        used to be one section at the foot of the page, which
                        meant scrolling away from the roster -- and away from
                        the name -- to read them. */}
                    {reviewOpen && (
                      <li className="bg-da-hover/30 px-5 py-4">
                        {resultsStudent === s.profile_id ? (
                          results.length > 0 ? (
                            renderReviewPanel()
                          ) : (
                            <p className="text-xs text-da-muted">
                              This run has no marked parts to review.
                            </p>
                          )
                        ) : (
                          <p className="text-xs text-da-muted">Loading this student&apos;s marks…</p>
                        )}
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {lightboxUrl && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close enlarged image"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") setLightboxUrl(null);
          }}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-6 top-6 rounded-full bg-da-surface/10 px-3 py-1 text-sm text-white hover:bg-da-surface/20"
          >
            Close ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Enlarged view"
            className="max-h-[90vh] max-w-[90vw] cursor-default rounded object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {boxEditor && (
        <EvidenceBoxEditor
          title={boxEditor.label}
          imageSrc={boxEditor.imageSrc}
          page={boxEditor.page}
          pageCount={boxEditor.pageCount}
          loading={boxEditorLoading}
          saving={boxEditorSaving}
          error={boxEditorError}
          onPageChange={(page) => {
            setBoxEditor((prev) => (prev ? { ...prev, page, imageSrc: null } : prev));
            void loadEditorPage(boxEditor.result, page);
          }}
          onSave={saveEvidenceBox}
          onClose={() => {
            setBoxEditor(null);
            setBoxEditorError(null);
          }}
        />
      )}
    </div>
  );
}
