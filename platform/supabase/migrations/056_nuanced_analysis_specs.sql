-- ── CleverPlatform: Nuanced Analysis pedagogical SPECS ───────────────────────
-- Migration: 056_nuanced_analysis_specs
--
-- Creates the nuanced_analysis_specs table to store validated
-- NuancedAnalysisSpec JSON objects — the pedagogical "FEEL" layer of a Nuanced
-- Analysis (the cognitive arc, required component order, the eight design
-- layers, planted-error rules, TOK/IM rules, the flipped -> in-class ->
-- take-home delivery spine, the Teacher's Companion contract, etc.).
--
-- This is the sibling of nuanced_analysis_template_asts, which stores the
-- "LOOK" (TemplateAst: typography/spacing/pagination for the Typst renderer).
-- A complete template = one spec (feel) + one AST (look).
--
-- Design rules (mirrors the AST table):
--   1. Store only validated JSON — raw HTML/CSS/LaTeX strings are forbidden.
--      Full Zod validation (NuancedAnalysisSpecSchema) is enforced at the
--      application layer before insert/update.
--   2. spec_version tracks NuancedAnalysisSpec.identity.specVersion.
--   3. RLS: a teacher can read/write their OWN course-specific variants; the
--      CANONICAL row (owner_id IS NULL, is_canonical = true) is readable by
--      every authenticated teacher and is managed only by the service role.
--   4. A CHECK constraint confirms the payload is a JSON object.
--
-- The canonical IBDP AA HL row is seeded from application code (the exported
-- CANONICAL_AAHL_SPEC in platform/lib/nuanced-analysis-spec.defaults.ts) rather
-- than embedded here, so the seed can never drift from the Zod-validated
-- source object and no escape-dense JSON has to live inside SQL.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.nuanced_analysis_specs (
  id          uuid primary key default gen_random_uuid(),
  -- NULL owner_id + is_canonical = true marks the global canonical template.
  -- A non-null owner_id marks a teacher's course-specific variant.
  owner_id    uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Course keying, so specs can be looked up per curriculum/level.
  programme   text not null default 'IBDP',
  subject     text not null default 'Mathematics',
  strand      text not null check (strand in ('AA', 'AI')),
  level       text not null check (level in ('HL', 'SL')),

  -- Human-readable name, e.g. "Nuanced Analysis — Canonical (IBDP Mathematics AA HL)".
  name          text not null,

  -- Spec version from NuancedAnalysisSpec.identity.specVersion, e.g. "2026-07-14.1".
  spec_version  text not null,

  -- Exactly one canonical row per (programme, subject, strand, level).
  is_canonical  boolean not null default false,

  -- The full validated NuancedAnalysisSpec JSON object.
  spec  jsonb not null,

  -- Quick sanity guard: reject anything that is not a JSON object.
  constraint spec_is_object check (jsonb_typeof(spec) = 'object')
);

-- Reuse the shared updated-at trigger function (created by an earlier migration).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_nuanced_analysis_specs_updated_at
  on public.nuanced_analysis_specs;
create trigger trg_nuanced_analysis_specs_updated_at
before update on public.nuanced_analysis_specs
for each row execute procedure public.set_updated_at();

-- Fast lookup by owner (per-teacher variants).
create index if not exists idx_na_specs_owner
  on public.nuanced_analysis_specs (owner_id);

-- Fast lookup of a course's canonical spec.
create index if not exists idx_na_specs_course
  on public.nuanced_analysis_specs (programme, subject, strand, level);

-- At most one canonical row per course key.
create unique index if not exists uq_na_specs_canonical_per_course
  on public.nuanced_analysis_specs (programme, subject, strand, level)
  where is_canonical;

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.nuanced_analysis_specs enable row level security;

-- Teachers can read/write their OWN course-specific variants.
create policy "owner_full_access" on public.nuanced_analysis_specs
  for all
  to authenticated
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Any authenticated teacher can READ the canonical template(s).
create policy "read_canonical" on public.nuanced_analysis_specs
  for select
  to authenticated
  using (is_canonical = true);

-- Service role has unrestricted access (used by API routes; owns the canonical row).
create policy "service_role_full_access" on public.nuanced_analysis_specs
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nuanced_analysis_specs is
  'Stores validated NuancedAnalysisSpec JSON (the pedagogical "feel" of a Nuanced Analysis). Only objects that pass NuancedAnalysisSpecSchema Zod validation should be inserted. The canonical row (owner_id IS NULL, is_canonical = true) is seeded from CANONICAL_AAHL_SPEC and managed by the service role.';

comment on column public.nuanced_analysis_specs.spec is
  'Full NuancedAnalysisSpec JSON object. Must pass NuancedAnalysisSpecSchema validation. Raw HTML, CSS, or LaTeX strings must never appear as configuration in this column.';
