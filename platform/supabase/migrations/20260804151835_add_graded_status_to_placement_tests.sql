alter table public.placement_tests drop constraint placement_tests_status_check;
alter table public.placement_tests add constraint placement_tests_status_check
  check (status in ('uploaded', 'segmenting', 'segmented', 'grading', 'graded', 'complete', 'error'));
;
