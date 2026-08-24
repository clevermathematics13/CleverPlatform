
-- Grade 9 Extended's track_courses mapping still pointed at last year's
-- archived 9G (2025-2026) instead of this year's live 9G (created today,
-- 2026-08-22 13:13), and never included 9C (also created today, 06:12) at
-- all. This is what caused the NA scan-test dropdown to show last year's
-- 9G roster (some names + some archived/hidden) pooled in with the live
-- 9A roster instead of the correct live 9A + 9C + 9G set.
--
-- Confirmed with Pablo: 9A, 9C, and 9G are all Grade 9 Extended.

-- Remove the stale archived-9G row from Grade 9 Extended
delete from track_courses
where track_course_id = 'b1d3b183-5cbe-4994-ac3c-2a11120ed752'
  and member_course_id = 'e3d14ebd-ce57-489d-8999-4916c2b688ce'; -- 9G (2025-2026), archived

-- Add the live 9G
insert into track_courses (track_course_id, member_course_id)
values ('b1d3b183-5cbe-4994-ac3c-2a11120ed752', '41997ffc-8fe4-4ff2-8612-a80edeb8dd91') -- 9G, live
on conflict do nothing;

-- Add the live 9C (was missing entirely)
insert into track_courses (track_course_id, member_course_id)
values ('b1d3b183-5cbe-4994-ac3c-2a11120ed752', 'dc6d8fcf-cacd-4b5b-9674-478ac78f7f3c') -- 9C, live
on conflict do nothing;
;
