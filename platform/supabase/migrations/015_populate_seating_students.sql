-- ============================================
-- 015. POPULATE seating_students FROM EXISTING DATA
-- ============================================
-- Derives rows from invited_students + courses + profiles.
-- student_id  = email (stable unique key)
-- class_group = short label (e.g. "27AH" for "IBDP AAHL")
-- name        = profiles.display_name (registered) OR invited_students.full_name
-- Runs safely on re-run via ON CONFLICT DO NOTHING.
-- ============================================

INSERT INTO public.seating_students (student_id, name, class_group, active, notes)
SELECT
  ist.email                                          AS student_id,
  COALESCE(p.display_name, ist.full_name, ist.email) AS name,
  CASE c.name
    WHEN 'IBDP AAHL' THEN '27AH'
    WHEN 'IBDP AIHL' THEN '27AI'
    ELSE c.name
  END                                                AS class_group,
  true                                               AS active,
  ''                                                 AS notes
FROM public.invited_students ist
JOIN public.courses c ON c.id = ist.course_id
LEFT JOIN public.profiles p ON p.email = ist.email
ON CONFLICT (student_id) DO NOTHING;
