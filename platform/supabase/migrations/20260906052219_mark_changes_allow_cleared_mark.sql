-- mark_changes.new_marks was NOT NULL, so clearing a mark could not be
-- recorded honestly.
--
-- The gradebook clears a cell by DELETEing the student_marks row. The audit
-- log had no way to say that: NULL was rejected, and writing 0 would claim
-- the teacher had awarded zero marks, which is a different fact about the
-- student and would be read back as a real score. So the only faithful
-- option was to log nothing at all -- which is what the gradebook did.
--
-- old_marks is already nullable for the mirror-image case (the first mark on
-- an item, where there was no prior value). This makes the two ends
-- symmetric: NULL on either side means "no mark", and a row with
-- new_marks NULL is a clear.
--
-- Widening NOT NULL to NULL is backward compatible: existing rows are
-- untouched and every existing writer still supplies a value.

alter table public.mark_changes
  alter column new_marks drop not null;

comment on column public.mark_changes.new_marks is
  'Marks after the change. NULL means the mark was cleared (the student_marks row was deleted), which is distinct from a recorded score of 0.';

comment on column public.mark_changes.old_marks is
  'Marks before the change. NULL means there was no mark on this item for this student beforehand.';
