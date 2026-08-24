
create table if not exists public.nuanced_analysis_template_asts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  template_name  text not null,
  schema_version text not null,
  ast  jsonb not null,
  constraint ast_is_object check (jsonb_typeof(ast) = 'object')
);

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

create index if not exists idx_na_template_asts_owner
  on public.nuanced_analysis_template_asts (owner_id);

alter table public.nuanced_analysis_template_asts enable row level security;

create policy "owner_full_access" on public.nuanced_analysis_template_asts
  for all
  to authenticated
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "service_role_full_access" on public.nuanced_analysis_template_asts
  for all
  to service_role
  using (true)
  with check (true);
;
