-- Re-point the existing Grade 9 Nuanced Analysis packets and their continuity
-- record from the old roster-course id (31370a33-269f-4ede-b04a-daf16e11dff8,
-- "9A (2025-2026)") onto the new virtual "Grade 9 Extended" course
-- (b1d3b183-5cbe-4994-ac3c-2a11120ed752), since these packets are shared
-- across 9A/9C/9G rather than specific to the 9A roster.

update public.nuanced_analyses
set course_id = 'b1d3b183-5cbe-4994-ac3c-2a11120ed752',
    course = 'Grade 9 Mathematics (Extended)'
where course_id = '31370a33-269f-4ede-b04a-daf16e11dff8';

update public.na_continuity
set course_id = 'b1d3b183-5cbe-4994-ac3c-2a11120ed752'
where course_id = '31370a33-269f-4ede-b04a-daf16e11dff8';
;
