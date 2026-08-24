insert into storage.buckets (id, name, public)
values ('exam-scans', 'exam-scans', false)
on conflict (id) do nothing;

drop policy if exists exam_scans_teacher_select on storage.objects;
create policy exam_scans_teacher_select
  on storage.objects for select
  using (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');

drop policy if exists exam_scans_teacher_insert on storage.objects;
create policy exam_scans_teacher_insert
  on storage.objects for insert
  with check (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');

drop policy if exists exam_scans_teacher_update on storage.objects;
create policy exam_scans_teacher_update
  on storage.objects for update
  using (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');

drop policy if exists exam_scans_teacher_delete on storage.objects;
create policy exam_scans_teacher_delete
  on storage.objects for delete
  using (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');;
