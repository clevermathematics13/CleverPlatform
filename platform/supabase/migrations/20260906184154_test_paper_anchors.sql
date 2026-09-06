-- Per-paper answer regions, so evidence crops stop depending on the grading
-- model guessing where the work is.
--
-- Audited against one 41-part paper: 22 of the 33 crops the model located did
-- not contain the work they were captioned as evidence for, every one landing
-- above it. The cropper is exact -- all 33 reproduce byte-for-byte from their
-- recorded boxes -- so only the coordinates were ever wrong. The model is
-- asked for fractions of a page it is never told the dimensions of, and it
-- answers with a synthesised layout: un-padded, all 66 y-values are exact
-- multiples of 0.01 in arithmetic sequences per question.
--
-- The fix is the one the NA scan pipeline already settled on: locate each
-- part ONCE per paper, with a human confirming, and reuse it for every
-- student. These two tables mirror na_packet_versions / na_anchors, including
-- their column names, so the region rows map straight onto the CV service's
-- /crop request body with no translation layer.
--
-- NOTHING READS THESE YET. Added ahead of the authoring UI and the consuming
-- code so the shape can be reviewed on its own.

create table public.test_paper_layouts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  label text not null,
  -- The PDF the regions were drawn on, in the exam-scans bucket. There is no
  -- blank master paper anywhere in this system (tests.paper_url is a
  -- free-text URL nobody fetches, and the generated student PDF is streamed
  -- and discarded), so in practice this is one representative student's scan
  -- -- the same stand-in the NA side already sanctioned in
  -- na-review/packet-scans/[packetScanId]/inspect-fillrects/route.ts.
  reference_storage_path text,
  reference_kind text check (reference_kind in ('master_upload', 'student_scan')),
  -- Which run that scan came from, when reference_kind is 'student_scan'.
  -- Provenance only: nulled rather than cascading, since losing the run does
  -- not invalidate geometry already drawn.
  reference_run_id uuid references public.ai_grade_runs(id) on delete set null,
  page_count integer not null,
  -- One {widthPt, heightPt} per page of the reference, in order.
  --
  -- na_anchors stores absolute points with no record of the page they were
  -- measured against, so a scan at a different paper size or scanner scale
  -- shifts every crop for every student with no signal at all. Keeping the
  -- reference's page box lets the consumer map region -> fraction of
  -- reference page -> points on the actual scan page, which costs one
  -- multiplication and closes that hole.
  reference_page_sizes jsonb not null,
  anchors_locked boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A re-sitting reuses the tests row, so one test can accumulate several
-- physical paper layouts over time. Exactly one is current; the others stay
-- for the runs that were graded under them. Without this a re-laid-out
-- reprint would silently inherit the previous paper's geometry, which is the
-- failure na_packet_versions exists to prevent on the NA side.
create unique index test_paper_layouts_one_active_idx
  on public.test_paper_layouts (test_id) where is_active;

create table public.test_item_anchors (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.test_paper_layouts(id) on delete cascade,
  -- Keyed on the part's NATURAL identity, deliberately not on test_items.id.
  -- lib/formative-assessment-bridge.ts's syncTestItems deletes every
  -- source='custom' row for a test and re-inserts fresh uuids on EVERY save
  -- of a Formative Assessment draft -- including a save that only changes the
  -- title. An FK to test_items(id) with on delete cascade would therefore
  -- destroy a whole hand-drawn anchor set the first time a teacher fixed a
  -- typo, silently and with no way to recover it.
  question_number integer not null,
  part_label text,
  -- 0-indexed page of the reference PDF, matching na_anchors.page_index and
  -- the CV service's AnchorIn.pageIndex.
  page_index integer not null,
  x0_pt numeric not null,
  y0_pt numeric not null,
  x1_pt numeric not null,
  y1_pt numeric not null,
  -- Caps adaptive right/bottom growth, same meaning as na_anchors: usually
  -- the next region's edge, so one overflowing answer cannot swallow the
  -- following part's.
  expand_max_x1_pt numeric,
  expand_max_y1_pt numeric,
  sort_order integer,
  source text not null default 'manual_draw',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_item_anchors_box_ordered check (x1_pt > x0_pt and y1_pt > y0_pt)
);

-- part_label is null for a question with no parts, and a plain unique
-- constraint would let those duplicate: in Postgres, NULLs are distinct, so
-- unique (layout_id, question_number, part_label) permits Q7 twice.
create unique index test_item_anchors_part_idx
  on public.test_item_anchors (layout_id, question_number, coalesce(part_label, ''));

alter table public.test_paper_layouts enable row level security;
alter table public.test_item_anchors enable row level security;

-- Reached through the owning test, matching test_items' policy rather than
-- ai_grade_results' broader get_my_role() = 'teacher'. A teacher should not
-- be able to read or write geometry for a paper whose own items their RLS
-- hides from them.
create policy "Teachers manage paper layouts for their tests" on public.test_paper_layouts
  for all using (
    exists (select 1 from public.tests t where t.id = test_paper_layouts.test_id and t.teacher_id = auth.uid())
  );

create policy "Teachers manage anchors for their tests" on public.test_item_anchors
  for all using (
    exists (
      select 1
      from public.test_paper_layouts l
      join public.tests t on t.id = l.test_id
      where l.id = test_item_anchors.layout_id and t.teacher_id = auth.uid()
    )
  );

comment on table public.test_paper_layouts is
  'One physical layout of a test paper. A re-sitting reuses the tests row, so a test can have several; exactly one is is_active (enforced by a partial unique index) and that is the one new grading runs use. reference_page_sizes records the page box the anchors were measured against so a differently sized or scaled scan is detectable rather than silently mis-cropped.';

comment on table public.test_item_anchors is
  'One answer region per part of a paper layout, in absolute points on the reference page. Keyed on (question_number, part_label) rather than test_items.id because syncTestItems recreates test_items rows with new uuids on every Formative Assessment save. Column names mirror na_anchors so these map directly onto the CV /crop request body.';
