
-- Allow a parent invite to be created before the student has ever signed in.
-- student_id becomes nullable; when null, invited_student_email + course_id
-- act as the pending anchor, resolved once the student's students row exists.
alter table public.invited_parents
  alter column student_id drop not null;

alter table public.invited_parents
  add column if not exists invited_student_email text,
  add column if not exists course_id uuid references public.courses(id) on delete cascade;

alter table public.invited_parents
  drop constraint if exists invited_parents_student_id_fkey,
  add constraint invited_parents_student_id_fkey
    foreign key (student_id) references public.students(id) on delete cascade;

-- Replace the old unique(email, student_id) with something that also works
-- when student_id is null (Postgres treats NULLs as distinct, so the old
-- constraint alone would allow duplicate pending rows for the same email +
-- course -- add a second partial unique index to cover that case).
create unique index if not exists invited_parents_email_course_pending_idx
  on public.invited_parents (email, course_id)
  where student_id is null;

-- Extend auto_enroll_from_invitations: once a student's `students` row is
-- created (their first sign-in), resolve any invited_parents rows that were
-- waiting on that student's email + course by filling in the real student_id.
create or replace function public.auto_enroll_from_invitations(p_user_id uuid, p_user_email text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
BEGIN
  INSERT INTO public.students (profile_id, course_id, extra_time)
  SELECT p_user_id, i.course_id, i.extra_time
  FROM public.invited_students i
  WHERE i.email = p_user_email AND i.profile_id IS NULL
  ON CONFLICT (profile_id, course_id) DO UPDATE
  SET extra_time = EXCLUDED.extra_time;

  -- Resolve any parent invites that were waiting on this student's
  -- email+course pairing, now that a real students row exists for them.
  UPDATE public.invited_parents ip
  SET student_id = s.id
  FROM public.students s
  WHERE ip.student_id IS NULL
    AND ip.invited_student_email = p_user_email
    AND ip.course_id = s.course_id
    AND s.profile_id = p_user_id;

  -- Copy nickname (or derive from full_name) into profiles if not already set
  UPDATE public.profiles
  SET nickname = (
    SELECT COALESCE(
      NULLIF(trim(i.nickname), ''),
      split_part(i.full_name, ' ', 1)
    )
    FROM public.invited_students i
    WHERE i.email = p_user_email AND i.profile_id IS NULL
    LIMIT 1
  )
  WHERE id = p_user_id AND nickname IS NULL;

  UPDATE public.invited_students
  SET registered = true, profile_id = p_user_id
  WHERE email = p_user_email AND profile_id IS NULL;
END;
$function$;

-- Bulk roster import: one call per PDF upload. Creates invited_students rows
-- and, for each guardian email present, an invited_parents row anchored on
-- (invited_student_email, course_id) since the student hasn't signed in yet.
-- p_rows shape: [{ "student_email": "...", "full_name": "...", "guardian_emails": ["...", "..."] }, ...]
create or replace function public.teacher_bulk_import_roster(p_course_id uuid, p_rows jsonb)
returns table(student_email text, invited_student boolean, parent_invites_created integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row jsonb;
  v_student_email text;
  v_full_name text;
  v_guardian_email text;
  v_parent_count integer;
begin
  if public.get_my_role() != 'teacher' then
    raise exception 'Unauthorized';
  end if;

  if not exists (select 1 from public.courses where id = p_course_id) then
    raise exception 'Course not found';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_student_email := lower(trim(v_row->>'student_email'));
    v_full_name := nullif(trim(v_row->>'full_name'), '');

    if v_student_email is null or v_student_email = '' then
      continue;
    end if;

    insert into public.invited_students (email, course_id, full_name)
    values (v_student_email, p_course_id, v_full_name)
    on conflict (email, course_id) do update
      set full_name = coalesce(excluded.full_name, public.invited_students.full_name);

    v_parent_count := 0;

    for v_guardian_email in
      select lower(trim(g))
      from jsonb_array_elements_text(coalesce(v_row->'guardian_emails', '[]'::jsonb)) as g
      where trim(g) <> ''
    loop
      insert into public.invited_parents (email, invited_student_email, course_id)
      values (v_guardian_email, v_student_email, p_course_id)
      on conflict (email, course_id) where student_id is null do nothing;

      v_parent_count := v_parent_count + 1;
    end loop;

    student_email := v_student_email;
    invited_student := true;
    parent_invites_created := v_parent_count;
    return next;
  end loop;
end;
$function$;
;
