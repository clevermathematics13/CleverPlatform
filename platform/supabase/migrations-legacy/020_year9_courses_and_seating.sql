-- ============================================
-- 020. Year 9 courses + seating_students sync
-- ============================================
-- 1. Adds courses for Year 9 class groups 9A, 9D, 9G.
-- 2. Syncs any already-imported invited_students for those courses
--    into seating_students (idempotent — ON CONFLICT DO NOTHING).
-- ============================================

-- 1. Unique constraint on courses.name (safe to add if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'courses_name_unique'
      AND conrelid = 'public.courses'::regclass
  ) THEN
    ALTER TABLE public.courses ADD CONSTRAINT courses_name_unique UNIQUE (name);
  END IF;
END $$;

-- 2. Courses
INSERT INTO public.courses (name, description) VALUES
  ('9A', 'Year 9 Mathematics — Group A'),
  ('9D', 'Year 9 Mathematics — Group D'),
  ('9G', 'Year 9 Mathematics — Group G')
ON CONFLICT (name) DO NOTHING;

-- 2. Sync invited_students → seating_students for the new courses
INSERT INTO public.seating_students (student_id, name, class_group, active, notes)
SELECT
  ist.email                                          AS student_id,
  COALESCE(p.display_name, ist.full_name, ist.email) AS name,
  c.name                                             AS class_group,
  true                                               AS active,
  ''                                                 AS notes
FROM public.invited_students ist
JOIN public.courses c ON c.id = ist.course_id
LEFT JOIN public.profiles p ON p.email = ist.email
WHERE c.name IN ('9A', '9D', '9G')
ON CONFLICT (student_id) DO NOTHING;
