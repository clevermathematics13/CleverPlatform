create table if not exists public.google_oauth_tokens (
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  provider         text not null default 'google-classroom',
  access_token     text,
  refresh_token    text,
  id_token         text,
  scope            text,
  token_type       text,
  expiry_date      bigint,
  google_email     text,
  last_error       text,
  last_refreshed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (profile_id, provider)
);

comment on table public.google_oauth_tokens is
  'Server-side Google OAuth token store. Replaces browser-cookie token storage so the Classroom/Drive connection survives device changes, cookie clears and background jobs.';

alter table public.google_oauth_tokens enable row level security;

drop policy if exists "own tokens select" on public.google_oauth_tokens;
create policy "own tokens select" on public.google_oauth_tokens
  for select using (auth.uid() = profile_id);

drop policy if exists "own tokens insert" on public.google_oauth_tokens;
create policy "own tokens insert" on public.google_oauth_tokens
  for insert with check (auth.uid() = profile_id);

drop policy if exists "own tokens update" on public.google_oauth_tokens;
create policy "own tokens update" on public.google_oauth_tokens
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "own tokens delete" on public.google_oauth_tokens;
create policy "own tokens delete" on public.google_oauth_tokens
  for delete using (auth.uid() = profile_id);

create or replace function public.touch_google_oauth_tokens()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists trg_touch_google_oauth_tokens on public.google_oauth_tokens;
create trigger trg_touch_google_oauth_tokens
  before update on public.google_oauth_tokens
  for each row execute function public.touch_google_oauth_tokens();;
