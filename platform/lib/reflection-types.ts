/** Types for the CleverReflection portal */

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
}

/**
 * One part's student mark scheme, rendered on the server by
 * renderStudentMarkSchemePart (lib/student-mark-scheme.ts): escaped, marking
 * codes stripped, maths typeset -- the same renderer as the full
 * mark-scheme page. Either half may be null, never both.
 */
export interface ReflectionMarkScheme {
  answer_html: string | null;
  how_marked_html: string | null;
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
