
-- invited_parents: teacher-managed pre-registration list, mirrors invited_students.
create table if not exists public.invited_parents (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  student_id uuid not null references public.students(id) on delete cascade,
  registered boolean not null default false,
  profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (email, student_id)
);

alter table public.invited_parents enable row level security;

create policy "Teachers manage invited_parents"
  on public.invited_parents
  for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

-- A signed-in user can see their own pending invite rows (needed so the
-- sign-in promotion path can be called safely from the client if ever needed).
create policy "Users can see their own invited_parents rows"
  on public.invited_parents
  for select
  using (lower(email) = lower((select email from public.profiles where id = auth.uid())));

-- teacher_invite_parent: teacher creates (or updates) an invite. If the
-- parent's email already has a profiles row (they signed in before being
-- invited), promote immediately instead of waiting for their next sign-in.
create or replace function public.teacher_invite_parent(
  p_email text,
  p_student_id uuid,
  p_full_name text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_email text := lower(trim(p_email));
  v_existing_profile_id uuid;
begin
  if public.get_my_role() != 'teacher' then
    raise exception 'Unauthorized';
  end if;

  if v_email is null or v_email = '' then
    raise exception 'Email is required';
  end if;

  if p_student_id is null then
    raise exception 'student_id is required';
  end if;

  insert into public.invited_parents (email, student_id, full_name)
  values (v_email, p_student_id, nullif(trim(p_full_name), ''))
  on conflict (email, student_id) do update
    set full_name = coalesce(excluded.full_name, public.invited_parents.full_name);

  -- If this person already has a profile (signed in previously), promote now.
  select id into v_existing_profile_id
  from public.profiles
  where lower(email) = v_email
  limit 1;

  if v_existing_profile_id is not null then
    update public.profiles
    set role = 'parent'
    where id = v_existing_profile_id;

    insert into public.parent_links (parent_profile_id, student_id)
    values (v_existing_profile_id, p_student_id)
    on conflict do nothing;

    update public.invited_parents
    set registered = true, profile_id = v_existing_profile_id
    where email = v_email and student_id = p_student_id;
  end if;
end;
$function$;

-- promote_to_parent_on_signin: called once right after a profile is
-- created/loaded during sign-in (e.g. from the /auth callback route).
-- If the signing-in email matches a pending invited_parents row, this
-- promotes the profile to 'parent' and creates the parent_links row(s)
-- automatically -- no manual role edit ever required.
create or replace function public.promote_to_parent_on_signin(
  p_profile_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_email text := lower(trim(p_email));
  v_matched boolean := false;
  v_row record;
begin
  if p_profile_id is null or v_email is null or v_email = '' then
    return false;
  end if;

  for v_row in
    select id, student_id
    from public.invited_parents
    where lower(email) = v_email and registered = false
  loop
    insert into public.parent_links (parent_profile_id, student_id)
    values (p_profile_id, v_row.student_id)
    on conflict do nothing;

    update public.invited_parents
    set registered = true, profile_id = p_profile_id
    where id = v_row.id;

    v_matched := true;
  end loop;

  if v_matched then
    update public.profiles
    set role = 'parent'
    where id = p_profile_id;
  end if;

  return v_matched;
end;
$function$;

-- teacher_remove_parent_link: unlink a parent from a student.
create or replace function public.teacher_remove_parent_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if public.get_my_role() != 'teacher' then
    raise exception 'Unauthorized';
  end if;

  delete from public.parent_links where id = p_link_id;
end;
$function$;

-- teacher_remove_invited_parent: cancel a pending parent invite.
create or replace function public.teacher_remove_invited_parent(p_invited_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if public.get_my_role() != 'teacher' then
    raise exception 'Unauthorized';
  end if;

  delete from public.invited_parents where id = p_invited_id;
end;
$function$;
;
