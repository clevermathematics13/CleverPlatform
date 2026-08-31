alter table public.na_feedback
  add column ai_student_attempted boolean;

comment on column public.na_feedback.ai_student_attempted is
  'Did the STUDENT write anything in this answer box? false only for a genuinely untouched box (no writing, working, or crossings-out). NULL = not recorded, which readers must treat as true. Not to be confused with ai_attempted, which is whether the AI attempted to mark the crop.';

comment on column public.na_feedback.ai_attempted is
  'Did the AI attempt to mark this crop? false when assessment was deliberately skipped (ungraded thinking-space anchor, or a crop stage 4 flagged blank). Not to be confused with ai_student_attempted, which is about the student.';
