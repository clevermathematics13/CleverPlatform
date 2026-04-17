-- CleverPlatform Database Schema
-- Run this in your Supabase SQL editor to create all tables.
--
-- Tables marked [MSA] already exist if you've been using the MSA Grader project.
-- Tables marked [NEW] are new for CleverPlatform.
-- This migration is idempotent (uses IF NOT EXISTS).

-- ══════════════════════════════════════════════════════════════
-- [MSA] Existing tables from MSA_Grader-API_Backend
-- ══════════════════════════════════════════════════════════════

-- Questions: IB past paper questions synced from Google Sheets
CREATE TABLE IF NOT EXISTS questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,         -- e.g. "22M.1.SL.TZ1.5"
  core_code   text,                         -- e.g. "22M.1.SL.TZ1"
  year        integer,
  session     text,                         -- "M" (May) or "N" (Nov)
  paper       integer,
  level       text,                         -- "SL", "HL", "AH", etc.
  timezone    text,                         -- "TZ0", "TZ1", "TZ2"
  question_number text,
  parts       jsonb,                        -- JSON array of parts with marks
  total_marks integer,
  source_list text,                         -- "Bank", "HL list", "SL list"
  created_at  timestamptz DEFAULT now()
);

-- Students: synced from Names sheet
CREATE TABLE IF NOT EXISTS students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text UNIQUE NOT NULL,
  name              text NOT NULL DEFAULT '',
  accommodation_pct real,                   -- e.g. 0.25 = 25%
  created_at        timestamptz DEFAULT now()
);

-- Exams: created via PPQselector or archived
CREATE TABLE IF NOT EXISTS exams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_code        text UNIQUE NOT NULL,     -- e.g. "27AH K05 [SL] P2"
  date             text,
  time             text,
  duration_minutes integer,
  class_code       text,                     -- e.g. "27AH"
  created_at       timestamptz DEFAULT now()
);

-- Exam-Question junction: which questions are on which exam
CREATE TABLE IF NOT EXISTS exam_questions (
  exam_id       uuid REFERENCES exams(id) ON DELETE CASCADE,
  question_code text NOT NULL,
  position      integer,
  PRIMARY KEY (exam_id, question_code)
);

-- Grades: teacher-confirmed marks per student per question per exam
CREATE TABLE IF NOT EXISTS grades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_code       text NOT NULL,
  student_email   text NOT NULL,
  question_code   text NOT NULL,
  marks_awarded   real NOT NULL DEFAULT 0,
  marks_possible  real,
  grader_type     text DEFAULT 'human',     -- 'human' or 'ai'
  created_at      timestamptz DEFAULT now(),
  UNIQUE (exam_code, student_email, question_code)
);

-- Student self-reported marks (replaces Google Forms)
CREATE TABLE IF NOT EXISTS student_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_code       text NOT NULL,
  student_email   text NOT NULL,
  question_label  text NOT NULL,
  marks_reported  real NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

-- Box coordinates for exam question cropping
CREATE TABLE IF NOT EXISTS box_coordinates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_code     text NOT NULL,
  question_code text NOT NULL,
  position      text,
  x_pct         real DEFAULT 0,
  y_pct         real DEFAULT 0,
  width_pct     real DEFAULT 0,
  height_pct    real DEFAULT 0,
  x_pts         real DEFAULT 0,
  y_pts         real DEFAULT 0,
  width_pts     real DEFAULT 0,
  height_pts    real DEFAULT 0,
  UNIQUE (exam_code, question_code)
);

-- ══════════════════════════════════════════════════════════════
-- [NEW] CleverPlatform tables
-- ══════════════════════════════════════════════════════════════

-- User profiles with role information
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  name        text NOT NULL DEFAULT '',
  role        text NOT NULL DEFAULT 'student'
              CHECK (role IN ('teacher', 'student', 'parent', 'admin')),
  google_id   text,
  avatar_url  text,
  created_at  timestamptz DEFAULT now()
);

-- Courses (e.g. IBDP AAHL, IBDP AIHL)
CREATE TABLE IF NOT EXISTS courses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,               -- "IBDP AAHL"
  code        text UNIQUE NOT NULL,        -- "AAHL"
  year        integer NOT NULL DEFAULT 2026,
  description text,
  created_at  timestamptz DEFAULT now()
);

-- Student-course enrollment
CREATE TABLE IF NOT EXISTS enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid REFERENCES profiles(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES courses(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (student_id, course_id)
);

-- Topics within a course
CREATE TABLE IF NOT EXISTS topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid REFERENCES courses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Lessons within a topic
CREATE TABLE IF NOT EXISTS lessons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    uuid REFERENCES topics(id) ON DELETE CASCADE,
  title       text NOT NULL,
  slug        text NOT NULL,
  content_url text,                        -- URL to static HTML lesson page
  order_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Assignments from teacher
CREATE TABLE IF NOT EXISTS assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  uuid REFERENCES profiles(id),
  course_id   uuid REFERENCES courses(id),
  title       text NOT NULL,
  description text,
  due_date    timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- Student submissions for assignments
CREATE TABLE IF NOT EXISTS submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid REFERENCES profiles(id) ON DELETE CASCADE,
  assignment_id    uuid REFERENCES assignments(id) ON DELETE CASCADE,
  question_id      uuid REFERENCES questions(id),
  response_text    text,
  file_url         text,
  ai_grade         real,
  ai_feedback      text,
  teacher_grade    real,
  teacher_feedback text,
  confirmed        boolean DEFAULT false,
  submitted_at     timestamptz DEFAULT now()
);

-- Parent-student linking via registration codes
CREATE TABLE IF NOT EXISTS parent_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id         uuid REFERENCES profiles(id) ON DELETE CASCADE,
  student_id        uuid REFERENCES profiles(id) ON DELETE CASCADE,
  registration_code text NOT NULL,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (parent_id, student_id)
);

-- ══════════════════════════════════════════════════════════════
-- Row-Level Security (RLS)
-- ══════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_responses ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read their own profile; admins/teachers can read all
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.jwt() ->> 'email' = email);

CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

CREATE POLICY "Admins can manage profiles" ON profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

-- Courses: readable by all authenticated users
CREATE POLICY "Authenticated users can view courses" ON courses
  FOR SELECT USING (auth.role() = 'authenticated');

-- Topics/Lessons: readable by all authenticated users
CREATE POLICY "Authenticated users can view topics" ON topics
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view lessons" ON lessons
  FOR SELECT USING (auth.role() = 'authenticated');

-- Questions: readable by all authenticated users
CREATE POLICY "Authenticated users can view questions" ON questions
  FOR SELECT USING (auth.role() = 'authenticated');

-- Students table: readable by teachers/admins
CREATE POLICY "Teachers can view students" ON students
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

-- Exams: readable by all authenticated users
CREATE POLICY "Authenticated users can view exams" ON exams
  FOR SELECT USING (auth.role() = 'authenticated');

-- Grades: students see own, teachers see all
CREATE POLICY "Students can view own grades" ON grades
  FOR SELECT USING (auth.jwt() ->> 'email' = student_email);

CREATE POLICY "Teachers can view all grades" ON grades
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

-- Student responses: students see own, teachers see all
CREATE POLICY "Students can view own responses" ON student_responses
  FOR SELECT USING (auth.jwt() ->> 'email' = student_email);

CREATE POLICY "Teachers can view all responses" ON student_responses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

-- Assignments: readable by enrolled students and teachers
CREATE POLICY "Authenticated users can view assignments" ON assignments
  FOR SELECT USING (auth.role() = 'authenticated');

-- Submissions: students see own, teachers see all
CREATE POLICY "Students can view own submissions" ON submissions
  FOR SELECT USING (
    student_id IN (SELECT id FROM profiles WHERE email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Teachers can manage all submissions" ON submissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

-- Students can create submissions
CREATE POLICY "Students can create submissions" ON submissions
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM profiles WHERE email = auth.jwt() ->> 'email')
  );

-- Enrollments: viewable by the enrolled student and teachers
CREATE POLICY "Users can view own enrollments" ON enrollments
  FOR SELECT USING (
    student_id IN (SELECT id FROM profiles WHERE email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Teachers can manage enrollments" ON enrollments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

-- Parent links: parents see own links, teachers see all
CREATE POLICY "Parents can view own links" ON parent_links
  FOR SELECT USING (
    parent_id IN (SELECT id FROM profiles WHERE email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Teachers can manage parent links" ON parent_links
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.email = auth.jwt() ->> 'email' AND p.role IN ('admin', 'teacher'))
  );

-- ══════════════════════════════════════════════════════════════
-- Seed data: initial courses
-- ══════════════════════════════════════════════════════════════

INSERT INTO courses (name, code, year, description) VALUES
  ('IBDP Analysis & Approaches HL', 'AAHL', 2026, 'IB Diploma Programme Mathematics: Analysis and Approaches Higher Level'),
  ('IBDP Applications & Interpretation HL', 'AIHL', 2026, 'IB Diploma Programme Mathematics: Applications and Interpretation Higher Level')
ON CONFLICT (code) DO NOTHING;

-- Admin profile
INSERT INTO profiles (email, name, role) VALUES
  ('clevermathematics@gmail.com', 'Admin', 'admin')
ON CONFLICT (email) DO NOTHING;
