
drop function if exists public.teacher_link_parent(text, uuid);

create function public.teacher_link_parent(p_parent_email text, p_student_id uuid)
returns table(parent_profile_id uuid, parent_display_name text, already_linked boolean, pending boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_parent_id uuid;
  v_parent_role text;
  v_parent_name text;
  v_student_exists boolean;
  v_already boolean := false;
  v_email text := lower(trim(p_parent_email));
begin
  if public.get_my_role() != 'teacher' then
    raise exception 'Unauthorized';
  end if;

  if v_email is null or v_email = '' then
    raise exception 'Parent email is required';
  end if;

  select exists (select 1 from public.students where id = p_student_id) into v_student_exists;
  if not v_student_exists then
    raise exception 'Student enrollment not found';
  end if;

  select id, role, display_name into v_parent_id, v_parent_role, v_parent_name
  from public.profiles
  where lower(email) = v_email;

  if v_parent_id is null then
    insert into public.invited_parents (email, student_id)
    values (v_email, p_student_id)
    on conflict (email, student_id) do nothing;

    return query select null::uuid, null::text, false, true;
    return;
  end if;

  if v_parent_role = 'teacher' then
    raise exception '% is a teacher account and cannot be converted to a parent.', p_parent_email;
  end if;

  if v_parent_role != 'parent' then
    update public.profiles set role = 'parent', updated_at = now() where id = v_parent_id;
    delete from public.students where profile_id = v_parent_id;
  end if;

  select exists (
    select 1 from public.parent_links
    where parent_links.parent_profile_id = v_parent_id and parent_links.student_id = p_student_id
  ) into v_already;

  insert into public.parent_links (parent_profile_id, student_id)
  values (v_parent_id, p_student_id)
  on conflict (parent_profile_id, student_id) do nothing;

  return query select v_parent_id, v_parent_name, v_already, false;
end;
$function$;

drop function if exists public.teacher_invite_parent(text, uuid, text);
drop function if exists public.teacher_remove_parent_link(uuid);
drop function if exists public.teacher_remove_invited_parent(uuid);
;
