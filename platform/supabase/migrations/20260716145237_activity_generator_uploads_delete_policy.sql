-- Teachers can already INSERT and SELECT anything in the 'uploads' bucket
-- ("Teachers can upload files" / "Teachers can view all uploads"), but there
-- is no DELETE policy yet. The AI Activity Generator now stores attachments
-- server-side under uploads/activity-generator/{teacher_id}/... and needs to
-- clean them up after each Claude request (and when a user removes a pending
-- attachment before sending). Scope this DELETE policy to that prefix only,
-- so it can't be used to delete unrelated files elsewhere in the bucket.
create policy "Teachers can delete activity generator uploads"
on storage.objects
for delete
using (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = 'activity-generator'
  and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role = 'teacher'
  )
);;
