-- Teaching material an assessment can be built FROM.
--
-- The assessment creator could only be told a topic and a grade. Everything the
-- class had actually worked through -- the packets, the study guide, the
-- textbook pages -- lived outside the platform, so a generated paper could only
-- ever be about the right subject rather than about the right lessons.
--
-- This table holds the uploaded ones. It deliberately does NOT hold the
-- material the platform produced itself: Nuanced Analysis packets, authored
-- templates and saved assessments already carry their own content in richer
-- form than a PDF, and copying them here would make two answers to "what does
-- A.1 say". The catalogue in platform/lib/source-materials.ts unions the two.
--
-- extracted_text is the point of the row. A PDF in storage cannot be read by
-- the generator; the text pulled out of it at upload time can.
create table if not exists public.source_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Both nullable: material can belong to a class, to a grade, or to neither
  -- (a textbook extract is not owned by one cohort).
  course_id uuid references public.courses(id) on delete set null,
  grade_level text,
  -- Object key inside the private exam-scans bucket, under source-materials/.
  storage_path text not null,
  content_type text not null default 'application/pdf',
  page_count integer,
  byte_size bigint,
  -- Null means the text could not be pulled out (a scanned page with no text
  -- layer). The row is still worth keeping: the file downloads, it just cannot
  -- be fed to the generator, and the catalogue says so rather than silently
  -- contributing nothing to the prompt.
  extracted_text text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists source_materials_course_idx on public.source_materials (course_id);
create index if not exists source_materials_grade_idx on public.source_materials (grade_level);

alter table public.source_materials enable row level security;

drop policy if exists "Teachers manage source materials" on public.source_materials;

-- Shared across teachers rather than scoped to the uploader: this is a
-- department catalogue, and material uploaded by one person is exactly what
-- the next person building the same unit's paper needs.
create policy "Teachers manage source materials"
  on public.source_materials
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

comment on table public.source_materials is
  'Uploaded teaching material the assessment creator can build questions from. Platform-produced material (nuanced_analyses, assignment_templates, tests.custom_content) is NOT copied here -- see platform/lib/source-materials.ts, which unions both into one catalogue.';