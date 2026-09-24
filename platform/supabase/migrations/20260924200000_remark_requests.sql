-- Re-mark requests: a student's written case that one part of a test should
-- be re-marked, and the teacher's answer to it.
--
-- After self-grading, the Compare step of the reflection page shows each
-- part's ClevMark beside the student's own mark. Where the two differ, a
-- student can now explain why they think the part should be re-marked; the
-- teacher answers on /dashboard/remark-requests with "Mark changed" (which
-- writes student_marks and mark_changes, as any teacher mark edit does) or
-- "Mark stands", optionally with a note the student reads beside the part.
-- A request still waiting for an answer is left out of the student's
-- disagreement %, so it does not hold the Upload Corrections step shut; once
-- answered, the part counts again.
--
-- Students READ their own rows and write none. Every student write goes
-- through app/api/remark-requests, which checks what a policy cannot -- the
-- test is visible to them (track family, hidden, release time), they have
-- self-graded it, the part has a ClevMark that differs from their saved
-- mark -- takes the marks at that moment itself, and writes with the service
-- role. A policy letting students insert their own rows would also let them
-- skip all of that, back-date created_at, or invent the marks they asked
-- about, straight through the API. For the same reason the teacher's
-- ?viewStudent= view, which runs in the teacher's session, cannot file a
-- request on a student's behalf: there is no insert policy for anyone.
--
-- Teachers read and answer requests on tests they own, the same ownership
-- test student_marks uses, so the account that can answer a request is the
-- account that can change the mark it is about.
--
-- One request per student per part. The row a student asked with is never
-- rewritten: remark_requests_guard refuses to change whose request it is,
-- which part it is about, the marks when it was made or when it was made,
-- and refuses any change to an answered request.

create table if not exists public.remark_requests (
  id uuid primary key default gen_random_uuid(),
  test_item_id uuid not null references public.test_items(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  explanation text not null check (char_length(explanation) between 1 and 1000),
  -- The ClevMark the student disputed, and their saved self mark (null for a
  -- blank), when they asked.
  marks_at_request integer not null check (marks_at_request >= 0),
  self_marks_at_request integer check (self_marks_at_request >= 0),
  status text not null default 'pending' check (status in ('pending', 'changed', 'stands')),
  -- The ClevMark once answered.
  resolved_marks integer check (resolved_marks >= 0),
  teacher_note text check (char_length(teacher_note) <= 1000),
  -- No ON DELETE action: a SET NULL would be an update of an answered row,
  -- which the guard below refuses.
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint remark_requests_one_per_part unique (test_item_id, student_id),
  constraint remark_requests_answered_when_resolved
    check ((status = 'pending') = (resolved_at is null)),
  constraint remark_requests_pending_has_no_answer
    check (status <> 'pending' or (resolved_marks is null and teacher_note is null and resolved_by is null)),
  constraint remark_requests_answer_has_mark
    check (status = 'pending' or resolved_marks is not null)
);

comment on table public.remark_requests is
  'A student''s request that one part of a test be re-marked, made from the Compare step after self-grading, and the teacher''s answer: changed or stands, with an optional note. One per student per part. Students read their own rows; every student write goes through app/api/remark-requests with the service role. A pending request is left out of the student''s disagreement %.';
comment on column public.remark_requests.marks_at_request is
  'The ClevMark (student_marks.marks_awarded) the student disputed, as it was when they asked.';
comment on column public.remark_requests.self_marks_at_request is
  'The student''s saved self mark on the part when they asked; null for a blank (no attempt).';
comment on column public.remark_requests.resolved_marks is
  'The ClevMark once the teacher answered. For changed it is the new mark; for stands, the mark as it stood.';

create or replace function public.remark_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.test_item_id is distinct from old.test_item_id
     or new.student_id is distinct from old.student_id
     or new.marks_at_request is distinct from old.marks_at_request
     or new.self_marks_at_request is distinct from old.self_marks_at_request
     or new.created_at is distinct from old.created_at then
    raise exception 'remark_requests: the part, the student, the marks when asked and the time asked never change';
  end if;
  if old.status <> 'pending' then
    raise exception 'remark_requests: an answered request is final';
  end if;
  if new.status <> 'pending' and new.explanation is distinct from old.explanation then
    raise exception 'remark_requests: the explanation cannot change in the write that answers it';
  end if;
  return new;
end;
$$;

drop trigger if exists remark_requests_guard on public.remark_requests;
create trigger remark_requests_guard
  before update on public.remark_requests
  for each row execute function public.remark_requests_guard();

drop trigger if exists set_updated_at on public.remark_requests;
create trigger set_updated_at
  before update on public.remark_requests
  for each row execute function public.set_updated_at();

alter table public.remark_requests enable row level security;

-- New tables inherit full rights for anon and authenticated from the
-- default privileges, which would leave RLS as the only barrier. Nobody
-- inserts or deletes here except the service role.
revoke all on public.remark_requests from anon;
revoke insert, delete, truncate on public.remark_requests from authenticated;

drop policy if exists "Students read their own re-mark requests" on public.remark_requests;
create policy "Students read their own re-mark requests"
  on public.remark_requests for select to authenticated
  using (student_id = (select auth.uid()));

drop policy if exists "Teachers read re-mark requests on their tests" on public.remark_requests;
create policy "Teachers read re-mark requests on their tests"
  on public.remark_requests for select to authenticated
  using (exists (
    select 1
    from public.test_items ti
    join public.tests t on t.id = ti.test_id
    where ti.id = remark_requests.test_item_id
      and t.teacher_id = (select auth.uid())
  ));

drop policy if exists "Teachers answer re-mark requests on their tests" on public.remark_requests;
create policy "Teachers answer re-mark requests on their tests"
  on public.remark_requests for update to authenticated
  using (exists (
    select 1
    from public.test_items ti
    join public.tests t on t.id = ti.test_id
    where ti.id = remark_requests.test_item_id
      and t.teacher_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.test_items ti
    join public.tests t on t.id = ti.test_id
    where ti.id = remark_requests.test_item_id
      and t.teacher_id = (select auth.uid())
  ));

create index if not exists remark_requests_pending_idx
  on public.remark_requests (created_at) where status = 'pending';
create index if not exists remark_requests_student_idx
  on public.remark_requests (student_id);
create index if not exists remark_requests_resolved_by_idx
  on public.remark_requests (resolved_by);
