-- Nuanced Analysis scanned-response pipeline: anchors, scan ingestion,
-- crop extraction, and AI-assisted assessment (vertical review by
-- question, teacher approval gate before anything reaches a student).

create table public.na_packet_versions (
  id uuid primary key default gen_random_uuid(),
  nuanced_analysis_id uuid references public.nuanced_analyses(id),
  version_label text not null,
  page_count integer not null,
  master_pdf_storage_path text,
  anchor_source text not null default 'auto_fillrect'
    check (anchor_source in ('auto_fillrect', 'manual_table', 'typst_metadata')),
  anchors_locked boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.na_anchors (
  id uuid primary key default gen_random_uuid(),
  packet_version_id uuid not null references public.na_packet_versions(id) on delete cascade,
  qid text not null,
  base_qid text not null,
  part_label text,
  page_index integer not null,
  x0_pt numeric not null,
  y0_pt numeric not null,
  x1_pt numeric not null,
  y1_pt numeric not null,
  expand_max_x1_pt numeric,
  expand_max_y1_pt numeric,
  command_term text,
  marks_available numeric,
  answer_sketch text,
  open_rubric text,
  misconception_context text,
  source text not null default 'auto_fillrect',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (packet_version_id, qid)
);

create table public.na_scan_batches (
  id uuid primary key default gen_random_uuid(),
  packet_version_id uuid not null references public.na_packet_versions(id),
  course_id uuid references public.courses(id),
  uploaded_by uuid references public.profiles(id),
  source_filename text,
  page_count integer,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'matched', 'cropped', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table public.na_scan_pages (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.na_scan_batches(id) on delete cascade,
  batch_page_index integer not null,
  storage_path text not null,
  detected_page_index integer,
  match_confidence numeric,
  transform_inliers integer,
  page_rotation_deg numeric,
  packet_seq integer,
  is_overflow boolean not null default false,
  flagged boolean not null default false,
  flag_note text,
  created_at timestamptz not null default now(),
  unique (batch_id, batch_page_index)
);

create table public.na_packet_scans (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.na_scan_batches(id) on delete cascade,
  packet_version_id uuid not null references public.na_packet_versions(id),
  packet_seq integer not null,
  student_profile_id uuid references public.profiles(id),
  name_crop_storage_path text,
  id_confidence numeric,
  id_status text not null default 'pending'
    check (id_status in ('pending', 'confirmed', 'needs_review')),
  status text not null default 'pending'
    check (status in ('pending', 'cropped', 'assessed', 'reviewed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.na_response_crops (
  id uuid primary key default gen_random_uuid(),
  packet_scan_id uuid not null references public.na_packet_scans(id) on delete cascade,
  anchor_id uuid not null references public.na_anchors(id),
  storage_path text not null,
  ink_density numeric,
  is_blank boolean not null default false,
  boundary_expanded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (packet_scan_id, anchor_id)
);

create table public.na_feedback (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.na_response_crops(id) on delete cascade,
  ai_attempted boolean,
  ai_transcription text,
  ai_verdict text check (ai_verdict in ('correct', 'partial', 'incorrect', 'unclear')),
  ai_marks_awarded numeric,
  ai_marks_available numeric,
  ai_misconception_tags text[],
  ai_margin_comment text,
  ai_next_step text,
  ai_confidence numeric,
  ai_teacher_note text,
  ai_raw_response jsonb,
  ai_validation_error text,
  -- teacher's final decision -- starts as a copy of the AI draft, and is
  -- what actually gets shown to the student once approved
  final_verdict text check (final_verdict in ('correct', 'partial', 'incorrect', 'unclear')),
  final_marks_awarded numeric,
  final_margin_comment text,
  final_next_step text,
  teacher_edited boolean not null default false,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  released_at timestamptz,
  student_flagged_misread boolean not null default false,
  student_flag_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.na_comment_bank (
  id uuid primary key default gen_random_uuid(),
  anchor_id uuid references public.na_anchors(id),
  body text not null,
  use_count integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_na_anchors_packet_version on public.na_anchors(packet_version_id);
create index idx_na_scan_pages_batch on public.na_scan_pages(batch_id);
create index idx_na_packet_scans_batch on public.na_packet_scans(batch_id);
create index idx_na_packet_scans_student on public.na_packet_scans(student_profile_id);
create index idx_na_response_crops_packet_scan on public.na_response_crops(packet_scan_id);
create index idx_na_response_crops_anchor on public.na_response_crops(anchor_id);
create index idx_na_feedback_crop on public.na_feedback(crop_id);
create index idx_na_feedback_released on public.na_feedback(released_at) where released_at is not null;

-- updated_at triggers, house style
create trigger set_updated_at before update on public.na_packet_scans
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.na_feedback
  for each row execute function public.set_updated_at();

-- RLS
alter table public.na_packet_versions enable row level security;
alter table public.na_anchors enable row level security;
alter table public.na_scan_batches enable row level security;
alter table public.na_scan_pages enable row level security;
alter table public.na_packet_scans enable row level security;
alter table public.na_response_crops enable row level security;
alter table public.na_feedback enable row level security;
alter table public.na_comment_bank enable row level security;

create policy "teachers full access" on public.na_packet_versions
  for all using (public.get_my_role() = 'teacher');
create policy "teachers full access" on public.na_anchors
  for all using (public.get_my_role() = 'teacher');
create policy "teachers full access" on public.na_scan_batches
  for all using (public.get_my_role() = 'teacher');
create policy "teachers full access" on public.na_scan_pages
  for all using (public.get_my_role() = 'teacher');
create policy "teachers full access" on public.na_packet_scans
  for all using (public.get_my_role() = 'teacher');
create policy "teachers full access" on public.na_response_crops
  for all using (public.get_my_role() = 'teacher');
create policy "teachers full access" on public.na_feedback
  for all using (public.get_my_role() = 'teacher');
create policy "teachers full access" on public.na_comment_bank
  for all using (public.get_my_role() = 'teacher');

-- students: read only their OWN released feedback, nothing else
create policy "students read own released feedback" on public.na_feedback
  for select using (
    public.get_my_role() = 'student'
    and released_at is not null
    and crop_id in (
      select rc.id from public.na_response_crops rc
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      where ps.student_profile_id = auth.uid()
    )
  );

create policy "students read own crops" on public.na_response_crops
  for select using (
    public.get_my_role() = 'student'
    and packet_scan_id in (
      select id from public.na_packet_scans where student_profile_id = auth.uid()
    )
  );

create policy "students update own feedback flag" on public.na_feedback
  for update using (
    public.get_my_role() = 'student'
    and released_at is not null
    and crop_id in (
      select rc.id from public.na_response_crops rc
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      where ps.student_profile_id = auth.uid()
    )
  )
  with check (
    -- students may only ever set the flag fields, enforced at the API
    -- layer (route validates only student_flagged_misread/student_flag_note
    -- are present in the update payload) since column-level RLS is not
    -- available; this policy governs row visibility only
    true
  );

-- parents: read through parent_links, same released-only restriction
create policy "parents read linked student released feedback" on public.na_feedback
  for select using (
    public.get_my_role() = 'parent'
    and released_at is not null
    and crop_id in (
      select rc.id from public.na_response_crops rc
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      join public.parent_links pl on pl.student_id = ps.student_profile_id
      where pl.parent_profile_id = auth.uid()
    )
  );
;
