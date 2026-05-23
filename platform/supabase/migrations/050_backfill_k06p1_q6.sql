-- 050: Backfill missing Q6 marks for 27AH [K06] P1
-- Q6 is stored as a single item (max 7) with blank part_label in this test.

WITH
  target_test AS (
    SELECT id FROM public.tests WHERE name ILIKE '%K06%P1%' LIMIT 1
  ),
  q6 AS (
    SELECT ti.id
    FROM public.test_items ti
    WHERE ti.test_id = (SELECT id FROM target_test)
      AND ti.question_number = 6
      AND COALESCE(ti.part_label, '') = ''
    LIMIT 1
  ),
  raw (first_name, marks) AS (
    VALUES
      ('julio', 7),
      ('nicolas', 7),
      ('gael', 7),
      ('minjun', 5),
      ('camilla', 6),
      ('pedro', 2),
      ('salim', 7),
      ('wyatt', 7),
      ('seungjun', 7),
      ('carlos', 4),
      ('luciana', 6),
      ('alejandro', 3),
      ('gustavo', 6)
  )

INSERT INTO public.student_marks (student_id, test_item_id, marks_awarded)
SELECT p.id, q6.id, r.marks
FROM raw r
JOIN public.profiles p
  ON lower(split_part(p.display_name, ' ', 1)) = r.first_name
  AND p.role = 'student'
CROSS JOIN q6
ON CONFLICT (test_item_id, student_id) DO UPDATE
  SET marks_awarded = EXCLUDED.marks_awarded;

-- Verify Q6 is now present for all K06 P1 students
SELECT p.display_name, sm.marks_awarded AS q6_mark
FROM public.student_marks sm
JOIN public.profiles p ON p.id = sm.student_id
JOIN public.test_items ti ON ti.id = sm.test_item_id
JOIN public.tests t ON t.id = ti.test_id
WHERE t.name ILIKE '%K06%P1%'
  AND ti.question_number = 6
  AND COALESCE(ti.part_label, '') = ''
ORDER BY p.display_name;
