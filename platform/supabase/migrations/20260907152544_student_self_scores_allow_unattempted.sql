-- student_self_scores.self_marks was NOT NULL DEFAULT 0, so a student could
-- not submit a self-assessment that left any question unattempted.
--
-- The self-grade form (components/reflection/NativeForm.tsx) tells students
-- in as many words to leave a box blank if they made no attempt, and sends
-- that box as NULL: self_marks NULL means "did not attempt", 0 means
-- "attempted and earned nothing", and those are different facts about the
-- student. Postgres rejected the NULL with 23502 and the submit failed.
--
-- Worse, the client upserted one row per question in a loop, so every
-- question before the first blank was already committed: the student got an
-- error, a half-saved self-assessment, and a disagreement score computed
-- from it. Three students on "27AH [K06] P1" are sitting on exactly 18 of
-- 19 items for that reason.
--
-- A student who filled in every single box got through, which is why the
-- table has rows at all and why the failure looked intermittent.
--
-- Widening NOT NULL to NULL is backward compatible: existing rows are
-- untouched and every existing writer still supplies a value. The DEFAULT 0
-- goes with it -- on a column where NULL carries meaning, defaulting an
-- omitted value to 0 invents an attempt the student never made.

alter table public.student_self_scores
  alter column self_marks drop not null,
  alter column self_marks drop default;

comment on column public.student_self_scores.self_marks is
  'Marks the student judged they earned on this test item. NULL means they made no attempt at the question, which is distinct from an attempt that earned 0.';
