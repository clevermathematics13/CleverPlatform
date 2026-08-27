-- Stage 4's adaptive crop expansion can stop for two different reasons:
-- ink density dropping below threshold (content genuinely ended), or
-- hitting the anchor's configured expand_max_x1_pt/expand_max_y1_pt cap
-- while ink was still touching that edge (content may continue beyond
-- what the anchor's geometry allows capturing). Only the second case is a
-- real risk of a truncated answer -- see cv_crop_extract.py's
-- _adaptive_crop_bounds docstring, added after a real miss (A.1 Q1(d) and
-- Q1(e) both cut off a student's boxed final answer with no visible
-- signal that anything was wrong).
alter table na_response_crops
  add column possibly_truncated boolean not null default false;

comment on column na_response_crops.possibly_truncated is
  'True when stage 4''s adaptive expansion stopped only because it hit the anchor''s expand_max_x1_pt/expand_max_y1_pt cap while ink was still touching that edge -- this crop may be missing content beyond what could be captured, and should be reviewed or the anchor''s geometry widened.';
