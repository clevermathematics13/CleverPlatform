alter table public.ai_grade_results
  add column evidence_box_reported jsonb;

comment on column public.ai_grade_results.evidence_box_reported is
  'The {page, x0, y0, x1, y1} box exactly as the grading model reported it -- fractions of that page, page 1-indexed -- before any padding or bounding. evidence_box is derived from it (boundModelBoxes in lib/evidence-crops.ts) and can be re-derived without a model call. Null for rows graded before 23 Sep 2026, for parts the model reported no box for, and for rows a partial re-mark copied forward from such a run. Read by the re-cut and the layout proposal; never written after the row is created.';
