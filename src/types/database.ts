export type UserRole = 'teacher' | 'student' | 'parent' | 'admin';

// ── Matches MSA Supabase schema ──

export type Student = {
  id: string;
  email: string;
  name: string;
  accommodation_pct: number | null;
  created_at: string;
}

export type Question = {
  id: string;
  code: string;
  core_code: string;
  year: number;
  session: string;          // "M" or "N"
  paper: number;
  level: string;            // "SL", "HL", "AH", etc.
  timezone: string;         // "TZ0", "TZ1", "TZ2"
  question_number: string;
  parts: string;            // JSON string of parts array
  total_marks: number;
  source_list: string;      // "Bank", "HL list", "SL list"
  created_at: string;
}

export type Exam = {
  id: string;
  exam_code: string;
  date: string | null;
  time: string | null;
  duration_minutes: number | null;
  class_code: string | null;
  created_at: string;
}

export type ExamQuestion = {
  exam_id: string;
  question_code: string;
  position: number;
}

export type Grade = {
  id: string;
  exam_code: string;
  student_email: string;
  question_code: string;
  marks_awarded: number;
  marks_possible: number | null;
  grader_type: 'human' | 'ai';
  created_at: string;
}

export type StudentResponse = {
  id: string;
  exam_code: string;
  student_email: string;
  question_label: string;
  marks_reported: number;
  created_at: string;
}

export type BoxCoordinate = {
  id: string;
  exam_code: string;
  question_code: string;
  position: string | null;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  x_pts: number;
  y_pts: number;
  width_pts: number;
  height_pts: number;
}

// ── CleverPlatform extensions (new tables) ──

export type Profile = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  google_id: string | null;
  avatar_url: string | null;
  created_at: string;
}

export type Course = {
  id: string;
  name: string;           // e.g. "IBDP AAHL"
  code: string;           // e.g. "AAHL"
  year: number;
  description: string | null;
  created_at: string;
}

export type Enrollment = {
  id: string;
  student_id: string;
  course_id: string;
  created_at: string;
}

export type Topic = {
  id: string;
  course_id: string;
  name: string;
  order_index: number;
  created_at: string;
}

export type Lesson = {
  id: string;
  topic_id: string;
  title: string;
  slug: string;
  content_url: string | null;   // URL to the static HTML lesson page
  order_index: number;
  created_at: string;
}

export type Assignment = {
  id: string;
  teacher_id: string;
  course_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  created_at: string;
}

export type Submission = {
  id: string;
  student_id: string;
  assignment_id: string;
  question_id: string | null;
  response_text: string | null;
  file_url: string | null;
  ai_grade: number | null;
  ai_feedback: string | null;
  teacher_grade: number | null;
  teacher_feedback: string | null;
  confirmed: boolean;
  submitted_at: string;
}

export type ParentLink = {
  id: string;
  parent_id: string;
  student_id: string;
  registration_code: string;
  created_at: string;
}

// ── Supabase Database type (for typed client) ──

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & Pick<Profile, 'email'>;
        Update: Partial<Profile>;
        Relationships: [];
      };
      students: {
        Row: Student;
        Insert: Partial<Student> & Pick<Student, 'email'>;
        Update: Partial<Student>;
        Relationships: [];
      };
      questions: {
        Row: Question;
        Insert: Partial<Question> & Pick<Question, 'code'>;
        Update: Partial<Question>;
        Relationships: [];
      };
      exams: {
        Row: Exam;
        Insert: Partial<Exam> & Pick<Exam, 'exam_code'>;
        Update: Partial<Exam>;
        Relationships: [];
      };
      exam_questions: {
        Row: ExamQuestion;
        Insert: ExamQuestion;
        Update: Partial<ExamQuestion>;
        Relationships: [];
      };
      grades: {
        Row: Grade;
        Insert: Partial<Grade> & Pick<Grade, 'exam_code' | 'student_email' | 'question_code'>;
        Update: Partial<Grade>;
        Relationships: [];
      };
      student_responses: {
        Row: StudentResponse;
        Insert: Partial<StudentResponse> & Pick<StudentResponse, 'exam_code' | 'student_email' | 'question_label'>;
        Update: Partial<StudentResponse>;
        Relationships: [];
      };
      box_coordinates: {
        Row: BoxCoordinate;
        Insert: Partial<BoxCoordinate> & Pick<BoxCoordinate, 'exam_code' | 'question_code'>;
        Update: Partial<BoxCoordinate>;
        Relationships: [];
      };
      courses: {
        Row: Course;
        Insert: Partial<Course> & Pick<Course, 'name' | 'code'>;
        Update: Partial<Course>;
        Relationships: [];
      };
      enrollments: {
        Row: Enrollment;
        Insert: Partial<Enrollment> & Pick<Enrollment, 'student_id' | 'course_id'>;
        Update: Partial<Enrollment>;
        Relationships: [];
      };
      topics: {
        Row: Topic;
        Insert: Partial<Topic> & Pick<Topic, 'course_id' | 'name'>;
        Update: Partial<Topic>;
        Relationships: [];
      };
      lessons: {
        Row: Lesson;
        Insert: Partial<Lesson> & Pick<Lesson, 'topic_id' | 'title' | 'slug'>;
        Update: Partial<Lesson>;
        Relationships: [];
      };
      assignments: {
        Row: Assignment;
        Insert: Partial<Assignment> & Pick<Assignment, 'title'>;
        Update: Partial<Assignment>;
        Relationships: [];
      };
      submissions: {
        Row: Submission;
        Insert: Partial<Submission> & Pick<Submission, 'student_id' | 'assignment_id'>;
        Update: Partial<Submission>;
        Relationships: [];
      };
      parent_links: {
        Row: ParentLink;
        Insert: Partial<ParentLink> & Pick<ParentLink, 'parent_id' | 'student_id' | 'registration_code'>;
        Update: Partial<ParentLink>;
        Relationships: [];
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    Views: {};
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    Functions: {};
  };
}
