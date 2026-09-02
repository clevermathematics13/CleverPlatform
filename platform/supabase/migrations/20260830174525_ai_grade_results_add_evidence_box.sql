-- The AI grading review UI shows a cropped scan region alongside each
-- part's transcribed evidence (see evidence_image_path), but the exact
-- box used to generate that crop was never persisted -- only the
-- resulting PNG. When a crop is wrong (e.g. the model's evidenceBox
-- undershoots vertically and the crop shows only printed question text,
-- not the student's handwriting -- see the Nicolas Carriquiry Q4(a)
-- case), there was no way to inspect or regenerate it without a full
-- re-grade. Storing the box the crop was actually rendered from lets a
-- future "regenerate this crop" action call the CV service directly
-- with an adjusted box, at no Anthropic API cost.
alter table public.ai_grade_results
  add column evidence_box jsonb;

comment on column public.ai_grade_results.evidence_box is
  'The {page, x0, y0, x1, y1} box (fractions of the page, already padded -- see fetchEvidenceCrops in app/api/tests/[id]/ai-grade/route.ts) actually sent to the CV /crop service to produce evidence_image_path. Null for results graded before this column existed, and whenever no crop was produced (workFound false, no evidenceBox reported, or the CV call failed).';
