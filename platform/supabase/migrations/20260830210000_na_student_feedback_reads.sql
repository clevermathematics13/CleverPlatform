-- Phase 2 of the in-app student feedback feature: the student read path
-- needs two things Phase 0 didn't cover, both discovered while building
-- lib/na-feedback-service.ts against the real schema/RLS:
--
-- 1. na_packet_versions and nuanced_analyses currently have ZERO student
--    read access (teachers-only) -- but the student feedback page needs a
--    packet title ("K06 Paper 2 Practice") for its packet picker. Neither
--    table carries any answer-key content (that lives on na_anchors,
--    already scoped in the Phase 0 migration), so this is metadata-only
--    and scoped the same way: only versions/analyses reachable through
--    that student's own RELEASED feedback.
--
-- 2. The exam-scans Storage bucket has only ONE read policy today
--    (exam_scans_teacher_select), gated on get_my_role() = 'teacher' --
--    confirmed directly against production. So even with every table-level
--    RLS policy in place, a student still could not actually load their
--    own crop image or the printed-question image, since Storage RLS is
--    separate from table RLS. Adds student SELECT policies on
--    storage.objects for both na_response_crops.storage_path and
--    na_anchors.prompt_crop_storage_path, scoped through released feedback
--    exactly like the Phase 0 table policies.

create policy "students read packet versions for their released feedback"
  on public.na_packet_versions for select
  using (
    public.get_my_role() = 'student'
    and id in (
      select a.packet_version_id
      from public.na_anchors a
      join public.na_response_crops rc on rc.anchor_id = a.id
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      join public.na_feedback fb on fb.crop_id = rc.id
      where ps.student_profile_id = auth.uid()
        and fb.released_at is not null
    )
  );

create policy "students read nuanced analyses for their released feedback"
  on public.nuanced_analyses for select
  using (
    public.get_my_role() = 'student'
    and id in (
      select pv.nuanced_analysis_id
      from public.na_packet_versions pv
      join public.na_anchors a on a.packet_version_id = pv.id
      join public.na_response_crops rc on rc.anchor_id = a.id
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      join public.na_feedback fb on fb.crop_id = rc.id
      where ps.student_profile_id = auth.uid()
        and fb.released_at is not null
    )
  );

create policy "students read own released crop images"
  on storage.objects for select
  using (
    bucket_id = 'exam-scans'
    and public.get_my_role() = 'student'
    and name in (
      select rc.storage_path
      from public.na_response_crops rc
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      join public.na_feedback fb on fb.crop_id = rc.id
      where ps.student_profile_id = auth.uid()
        and fb.released_at is not null
    )
  );

create policy "students read prompt crop images for their released feedback"
  on storage.objects for select
  using (
    bucket_id = 'exam-scans'
    and public.get_my_role() = 'student'
    and name in (
      select a.prompt_crop_storage_path
      from public.na_anchors a
      join public.na_response_crops rc on rc.anchor_id = a.id
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      join public.na_feedback fb on fb.crop_id = rc.id
      where ps.student_profile_id = auth.uid()
        and fb.released_at is not null
        and a.prompt_crop_storage_path is not null
    )
  );
