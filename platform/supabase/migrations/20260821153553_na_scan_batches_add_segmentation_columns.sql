-- Brings na_scan_batches up to the same shape as ai_grade_batches (the
-- Tests batch-grading pipeline this NA scanning pipeline is modelled on),
-- so the segmentation proposal a teacher needs to review/confirm can
-- actually be persisted between the upload+segment step and the
-- confirm+split step, rather than relying on the client to round-trip it
-- blindly in a single request.
alter table public.na_scan_batches
  add column source_storage_path text,
  add column proposed_segments jsonb,
  add column confirmed_segments jsonb,
  add column unassigned_pages jsonb,
  add column segmented_at timestamptz,
  add column split_at timestamptz;

comment on column public.na_scan_batches.proposed_segments is
  'AI-proposed page-to-student mapping from the segmentation vision pass. Shape: array of {label, pages, confidence, note, matchedInvitedId, matchedStudentName, matchedProfileId}. Never used to write na_packet_scans directly -- the teacher must confirm via the split step, which writes confirmed_segments.';

comment on column public.na_scan_batches.confirmed_segments is
  'Teacher-confirmed page-to-student mapping, written by the split step once the teacher has reviewed and corrected proposed_segments. Shape: array of {label, pages, invitedId}. This is the only version ever used to create na_packet_scans rows.';;
