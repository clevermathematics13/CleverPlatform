-- ---------------------------------------------------------------------------
-- Student numbers, for PowerSchool score import
-- ---------------------------------------------------------------------------
-- PowerTeacher Pro matches imported scores on the school-defined student
-- number and nothing else: a student name column is accepted but only powers
-- its "Validate Student Names" check, which compares the name against the
-- number rather than standing in for it. This platform stored no such number
-- -- students are a uuid, an email and a display name -- so an exported CSV
-- could never be imported without someone pasting the numbers in by hand
-- every time.
--
-- Nullable, and deliberately not unique. A student enrolled in two courses has
-- two students rows and would carry the same number in both, and the same
-- holds for invited_students, which is also per-course. Uniqueness belongs to
-- the school's roster, not to a join table.
--
-- Both tables need it because a gradebook row can come from either: a student
-- who has logged in (students -> profiles) or one imported and never signed in
-- (invited_students). See INVITED_SUBJECT_PREFIX in lib/ai-grading.ts.

ALTER TABLE students ADD COLUMN student_number text;
ALTER TABLE invited_students ADD COLUMN student_number text;

COMMENT ON COLUMN students.student_number IS
  'School-defined student number, as PowerSchool knows it. Used to match rows on PowerTeacher Pro score import; not unique here because one student has one row per course.';
COMMENT ON COLUMN invited_students.student_number IS
  'School-defined student number, as PowerSchool knows it. Used to match rows on PowerTeacher Pro score import; not unique here because one student has one row per course.';
