/** Types for the CleverReflection portal */

/** A test item with its marks data for reflection */
export interface ReflectionItem {
  id: string;
  test_item_id: string;
  question_number: number;
  part_label: string;
  max_marks: number;
  subtopic_codes: string[];
  marks_awarded: number | null; // teacher mark from student_marks
  self_marks: number | null;    // student self-assessment
}

/** A test in the reflection context */
export interface ReflectionTest {
  id: string;
  name: string;
  test_date: string | null;
  total_marks: number | null;
  course_id: string | null;
}

/** Student self-score record */
export interface SelfScore {
  test_item_id: string;
  self_marks: number;
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
