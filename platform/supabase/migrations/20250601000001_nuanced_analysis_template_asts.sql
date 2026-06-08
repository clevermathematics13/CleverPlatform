-- ── CleverPlatform: Nuanced Analysis template ASTs ───────────────────────────
-- Migration: 20250601000001_nuanced_analysis_template_asts
--
-- Creates the nuanced_analysis_template_asts table to store validated
-- TemplateAst JSON objects.
--
-- Design rules:
--   1. Store only validated JSON — raw HTML/CSS/LaTeX strings are forbidden.
--   2. The schema_version column tracks which TemplateAst schema version
--      this row was validated against.
--   3. RLS: teachers can read/write their own templates; students cannot
--      access this table at all.
--   4. A CHECK constraint confirms the payload is an object (not an array
--      or primitive). Full Zod validation is enforced at the application layer.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.nuanced_analysis_template_asts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Human-readable name, e.g. "Nuanced Analysis — Compact (IBDP AA HL)"
  template_name  text not null,

  -- Schema version from the TemplateAst.schemaVersion field,
  -- e.g. "2025-06-01.1".  Stored redundantly for quick querying.
  schema_version text not null,

  -- The full validated TemplateAst JSON object.
  -- Must pass TemplateAstSchema Zod validation before insert.
  ast  jsonb not null,

  -- Quick sanity guard: reject anything that is not a JSON object.
  constraint ast_is_object check (jsonb_typeof(ast) = 'object')
);

-- Updated-at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_nuanced_analysis_template_asts_updated_at
before update on public.nuanced_analysis_template_asts
for each row execute procedure public.set_updated_at();

-- Index for fast lookup by owner
create index if not exists idx_na_template_asts_owner
  on public.nuanced_analysis_template_asts (owner_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.nuanced_analysis_template_asts enable row level security;

-- Teachers can read/write their own templates
create policy "owner_full_access" on public.nuanced_analysis_template_asts
  for all
  to authenticated
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Service role has unrestricted access (used by API routes)
create policy "service_role_full_access" on public.nuanced_analysis_template_asts
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nuanced_analysis_template_asts is
  'Stores validated TemplateAst JSON objects for Nuanced Analysis PDF generation. Only validated objects (via TemplateAstSchema Zod schema) should be inserted.';

comment on column public.nuanced_analysis_template_asts.ast is
  'Full TemplateAst JSON object. Must pass TemplateAstSchema validation. Raw HTML, CSS, or LaTeX strings must never appear in this column.';
