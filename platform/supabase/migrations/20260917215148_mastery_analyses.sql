-- The cache behind the AI mastery analysis, which has never existed.
--
-- app/api/mastery/analysis/route.ts spends a Claude call building a student's
-- mastery write-up and then upserts it here so the next page load can show it
-- without paying again. app/dashboard/mastery/page.tsx reads it back through
-- getSavedAnalysis() and passes it to StudentDashboard as `savedAnalysis`.
--
-- The table was never created. The route logs the failure and returns the
-- analysis anyway --
--     if (upsertError) { console.error("[mastery/analysis] upsert error:", ...) }
-- -- so nothing visible ever broke: every analysis simply regenerated from
-- scratch, at full cost and latency, and "saved analysis" was always null. A
-- failure that only writes to a server log is the kind that survives for
-- months, which is exactly what happened.
--
-- student_id is the PRIMARY KEY, not a surrogate id with a unique index beside
-- it. One analysis per student is the whole semantic, and the route upserts
-- with { onConflict: "student_id" }. A primary key is a NON-PARTIAL unique
-- index, so PostgREST can infer it as a conflict target -- unlike
-- uq_nuanced_analyses_course_section, whose partial predicate is why the
-- Nuanced Analysis save route could never save anything (see
-- platform/lib/na-packet-save.ts). Getting the key right here is what stops
-- this table repeating that bug.
create table if not exists public.mastery_analyses (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  analysis_text text not null,
  -- Written explicitly by the route rather than defaulted, so the timestamp the
  -- teacher reads is the one returned in the same response. The default is for
  -- rows inserted any other way.
  generated_at timestamptz not null default now()
);

alter table public.mastery_analyses enable row level security;

drop policy if exists "Read own mastery analysis, teachers read all" on public.mastery_analyses;
drop policy if exists "Write own mastery analysis, teachers write all" on public.mastery_analyses;

-- Scoped per student, NOT shared the way source_materials is. A mastery
-- analysis is a write-up of one student's weaknesses; the equivalent mistake on
-- nuanced_analyses ("every student could read every generated activity packet",
-- migration 20260807112835) had to be narrowed after the fact.
create policy "Read own mastery analysis, teachers read all"
  on public.mastery_analyses
  for select
  to authenticated
  using (public.get_my_role() = 'teacher' or student_id = auth.uid());

-- The write policy is load-bearing, not a formality. The route authenticates
-- with getApiUser() -- ANY signed-in user, not getApiTeacher() -- and takes
-- studentId straight from the submitted form, defaulting to the caller only
-- when the field is absent. So the application layer does not stop a student
-- naming somebody else. This does: the WITH CHECK is evaluated against the row
-- being written, so a student can only ever land their own.
create policy "Write own mastery analysis, teachers write all"
  on public.mastery_analyses
  for all
  to authenticated
  using (public.get_my_role() = 'teacher' or student_id = auth.uid())
  with check (public.get_my_role() = 'teacher' or student_id = auth.uid());

comment on table public.mastery_analyses is
  'One cached AI mastery write-up per student, keyed by student_id. Written by app/api/mastery/analysis/route.ts and read by app/dashboard/mastery/page.tsx. The route swallows write errors so a cache failure never costs the reader their analysis -- which is why this table being absent went unnoticed until 17 Sep 2026.';

comment on column public.mastery_analyses.generated_at is
  'When the analysis was produced. Shown to the teacher so a stale write-up is recognisable as stale.';
