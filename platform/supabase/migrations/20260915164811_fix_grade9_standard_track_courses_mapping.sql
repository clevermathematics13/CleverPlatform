-- Grade 9 Standard's track_courses mapping still pointed at last year's
-- archived class, "9D (2025-2026)" (fc29a912), and not at this year's 9D
-- (9776610b, 18 invited students). The same stale mapping was fixed for
-- Grade 9 Extended on 22 Aug 2026 (20260822143417); Standard was left as it
-- was because nothing had been attached to it. The first Standard Level
-- summative (Key Assessment 1, Unit 1) is now attached to 9D, and the AI
-- grader pools a class's track siblings into its roster (see
-- LoadInvitedRosterOptions.includeTrackSiblings) -- with the old mapping that
-- pool would have been last year's students.
--
-- Uses names rather than pasted ids so the statement says what it does.
delete from public.track_courses
where track_course_id = (select id from public.courses where name = 'Grade 9 Standard')
  and member_course_id = (select id from public.courses where name = '9D (2025-2026)');

insert into public.track_courses (track_course_id, member_course_id)
select t.id, m.id
from public.courses t, public.courses m
where t.name = 'Grade 9 Standard' and m.name = '9D'
  and not exists (
    select 1 from public.track_courses tc
    where tc.track_course_id = t.id and tc.member_course_id = m.id
  );
