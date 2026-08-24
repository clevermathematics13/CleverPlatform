-- CleverPlatform: Nuanced Analysis pedagogical SPECS (056)
-- Stores validated NuancedAnalysisSpec JSON (the pedagogical "feel").
-- Sibling of nuanced_analysis_template_asts (the "look").

create table if not exists public.nuanced_analysis_specs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  programme   text not null default 'IBDP',
  subject     text not null default 'Mathematics',
  strand      text not null check (strand in ('AA', 'AI')),
  level       text not null check (level in ('HL', 'SL')),
  name          text not null,
  spec_version  text not null,
  is_canonical  boolean not null default false,
  spec  jsonb not null,
  constraint spec_is_object check (jsonb_typeof(spec) = 'object')
);

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

create index if not exists idx_na_specs_owner
  on public.nuanced_analysis_specs (owner_id);

create index if not exists idx_na_specs_course
  on public.nuanced_analysis_specs (programme, subject, strand, level);

create unique index if not exists uq_na_specs_canonical_per_course
  on public.nuanced_analysis_specs (programme, subject, strand, level)
  where is_canonical;

alter table public.nuanced_analysis_specs enable row level security;

create policy "owner_full_access" on public.nuanced_analysis_specs
  for all
  to authenticated
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "read_canonical" on public.nuanced_analysis_specs
  for select
  to authenticated
  using (is_canonical = true);

create policy "service_role_full_access" on public.nuanced_analysis_specs
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nuanced_analysis_specs is
  'Stores validated NuancedAnalysisSpec JSON (the pedagogical "feel" of a Nuanced Analysis). Canonical row (owner_id IS NULL, is_canonical = true) is seeded from CANONICAL_AAHL_SPEC and managed by the service role.';;
