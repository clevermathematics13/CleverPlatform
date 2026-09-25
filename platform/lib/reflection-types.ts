/** Types for the CleverReflection portal */

import type { ExplanationStep } from "./mark-scheme-explanation";

/** A test item with its marks data for reflection */
export interface ReflectionItem {
  id: string;
  test_item_id: string;
  question_number: number;
  part_label: string;
  /**
   * The "<section>.<question>" prefix the printed paper itself uses (e.g.
   * "2.3"), from lib/assignments.ts's paperQuestionPrefixes -- null for an
   * IB-bank test, where question_number already is the paper's own number.
   * A display-only stand-in for `Q${question_number}` wherever this item's
   * label is shown; question_number itself is unchanged and still what
   * everything else (sorting, matching) keys on.
   */
  paper_label: string | null;
  max_marks: number;
  subtopic_codes: string[];
  subtopic_labels: string[];
  marks_awarded: number | null; // teacher mark from student_marks
  self_marks: number | null;    // student self-assessment
  /**
   * This part's mark scheme, shown under its label on the self-grade form
   * and the comparison table so a student can read it and enter the mark in
   * the same place. Set only when the test's released mark scheme is the
   * platform's own student page (attachStudentMarkScheme in
   * lib/exam-service.ts); absent everywhere else.
   */
  mark_scheme?: ReflectionMarkScheme | null;
  /**
   * The student's request that this part be re-marked, when they have made
   * one. Attached by attachRemarkRequests (lib/exam-service.ts) only where
   * the part's ClevMarks are visible to the viewer: a request carries marks
   * (the ClevMark it disputes, and the teacher's answer), so attaching it to
   * items the self-assessment gate has blanked would hand those marks out
   * anyway.
   */
  remark_request?: ReflectionRemark | null;
}

export type RemarkStatus = "pending" | "changed" | "stands";

/**
 * A request to re-mark one part, in the shape a student may see: their own
 * words, the marks as they stood when they asked, and the teacher's answer.
 * Built from remark_requests by lib/remark-requests.ts; nothing about who
 * resolved it or how the mark was recorded is exposed here.
 */
export interface ReflectionRemark {
  id: string;
  test_item_id: string;
  explanation: string;
  status: RemarkStatus;
  /** The ClevMark the student disputed, as it was when they asked. */
  marks_at_request: number;
  /** Their saved self mark when they asked; null for a blank. */
  self_marks_at_request: number | null;
  /** The ClevMark once the teacher answered; null while pending. */
  resolved_marks: number | null;
  teacher_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/**
 * One part's student mark scheme, rendered on the server by
 * renderStudentMarkSchemePart (lib/student-mark-scheme.ts): escaped, marking
 * codes stripped, maths typeset -- the same renderer as the full
 * mark-scheme page. `answer_html` and `how_marked_html` are the teacher's own
 * answer and note; at least one of the three fields is set.
 */
export interface ReflectionMarkScheme {
  answer_html: string | null;
  how_marked_html: string | null;
  /** The written explanation of the part, when one is current for it
   *  (lib/mark-scheme-explanation.ts). Leads the card when present; the
   *  teacher's own text then sits behind "Full mark scheme (exact wording)". */
  guide?: ReflectionMarkGuide | null;
}

/**
 * A part's written explanation as the card shows it. What is always visible
 * -- the answer, how the marks work, the watch-out notes -- is typeset on the
 * server. The "Explain more" steps travel as their LaTeX source and are
 * typeset in the browser only when a student opens them
 * (components/reflection/ExplainMore.tsx), which keeps KaTeX out of the
 * self-grade form's first download and a 36-part paper's page small.
 */
export interface ReflectionMarkGuide {
  answer_html: string;
  marks: { marks: number; html: string }[];
  watch_html: string[];
  steps: ExplanationStep[];
}

/** A test in the reflection context */
export interface ReflectionTest {
  id: string;
  name: string;
  test_date: string | null;
  exam_time: string | null;
  release_at: string | null;
  total_marks: number | null;
  course_id: string | null;
  paper_url: string | null;
  mark_scheme_url: string | null;
  hidden: boolean;
  /** When false, a student sees Clev's Marks/feedback for this test without submitting a self-assessment first. */
  require_self_assessment: boolean;
}

/** Student self-score record */
export interface SelfScore {
  test_item_id: string;
  self_marks: number | null; // null = question not attempted
}

/** PDF upload record */
export interface PdfUpload {
  id: string;
  student_id: string;
  test_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  uploaded_at: string;
}

/** Override token */
export interface OverrideToken {
  id: string;
  token: string;
  teacher_id: string;
  student_id: string;
  test_id: string;
  used: boolean;
  created_at: string;
  expires_at: string;
}

/** Mastery stat for a subtopic */
export interface SubtopicMastery {
  code: string;
  descriptor: string;
  /** IB section number (1–5). 0 = unknown. */
  section: number;
  total_marks: number;
  marks_awarded: number;
  self_marks: number;
  percentage: number;
  self_percentage: number;
}

/** Row in the teacher dashboard grid */
export interface StudentReflectionRow {
  student_id: string;
  display_name: string;
  items: {
    test_item_id: string;
    marks_awarded: number | null;
    self_marks: number | null;
  }[];
  has_upload: boolean;
  pdf_url: string | null;
  disagreement: number | null;
  hidden: boolean;
  /** Parts with a re-mark request still waiting for the teacher. They are
   *  left out of `disagreement`, exactly as they are on the student's own
   *  page, so the two never disagree about whether the upload is open. */
  pending_remark_item_ids: string[];
}

/** Step in the reflection workflow */
export type ReflectionStep = 1 | 2 | 3 | 4;

/** Heatmap cell data */
export interface HeatmapCell {
  student_id: string;
  display_name: string;
  subtopic_code: string;
  percentage: number;
  hidden: boolean;
}
