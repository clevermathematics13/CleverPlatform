alter table na_response_crops
  add column possibly_truncated boolean not null default false;

comment on column na_response_crops.possibly_truncated is
  'True when stage 4''s adaptive expansion stopped only because it hit the anchor''s expand_max_x1_pt/expand_max_y1_pt cap while ink was still touching that edge -- this crop may be missing content beyond what could be captured, and should be reviewed or the anchor''s geometry widened.';
