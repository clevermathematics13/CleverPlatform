-- 051: Split K06 P1 Q6 into separate 6a and 6b items, then backfill marks

DO $$
DECLARE
  v_test_id UUID;
  v_q6a_id UUID;
  v_q6b_id UUID;
  v_q6a_sort INT;
BEGIN
  SELECT id INTO v_test_id
  FROM public.tests
  WHERE name ILIKE '%K06%P1%'
  LIMIT 1;

  IF v_test_id IS NULL THEN
    RAISE EXCEPTION 'K06 P1 test not found';
  END IF;

  -- Prefer existing 6a; otherwise convert the combined blank-label Q6 row into 6a.
  SELECT id, sort_order INTO v_q6a_id, v_q6a_sort
  FROM public.test_items
  WHERE test_id = v_test_id
    AND question_number = 6
    AND part_label = 'a'
  LIMIT 1;

  IF v_q6a_id IS NULL THEN
    SELECT id, sort_order INTO v_q6a_id, v_q6a_sort
    FROM public.test_items
    WHERE test_id = v_test_id
      AND question_number = 6
      AND COALESCE(part_label, '') = ''
    LIMIT 1;

    IF v_q6a_id IS NULL THEN
      RAISE EXCEPTION 'No Q6 row found to split for test %', v_test_id;
    END IF;

    UPDATE public.test_items
    SET part_label = 'a', max_marks = 3
    WHERE id = v_q6a_id;
  ELSE
    UPDATE public.test_items
    SET max_marks = 3
    WHERE id = v_q6a_id;
  END IF;

  -- Ensure 6b exists; if missing, clone structural fields from 6a and place right after it.
  SELECT id INTO v_q6b_id
  FROM public.test_items
  WHERE test_id = v_test_id
    AND question_number = 6
    AND part_label = 'b'
  LIMIT 1;

  IF v_q6b_id IS NULL THEN
    UPDATE public.test_items
    SET sort_order = sort_order + 1
    WHERE test_id = v_test_id
      AND sort_order > v_q6a_sort;

    INSERT INTO public.test_items (
      test_id,
      question_number,
      ib_question_code,
      part_label,
      max_marks,
      subtopic_codes,
      google_doc_id,
      google_ms_id,
      sort_order
    )
    SELECT
      test_id,
      question_number,
      ib_question_code,
      'b',
      4,
      subtopic_codes,
      google_doc_id,
      google_ms_id,
      sort_order + 1
    FROM public.test_items
    WHERE id = v_q6a_id
    RETURNING id INTO v_q6b_id;
  ELSE
    UPDATE public.test_items
    SET max_marks = 4
    WHERE id = v_q6b_id;
  END IF;
END $$;

-- Backfill/overwrite teacher marks for 6a and 6b using the provided sheet values.
WITH
  target_test AS (
    SELECT id FROM public.tests WHERE name ILIKE '%K06%P1%' LIMIT 1
  ),
  q AS (
    SELECT id, part_label
    FROM public.test_items
    WHERE test_id = (SELECT id FROM target_test)
      AND question_number = 6
      AND part_label IN ('a', 'b')
  ),
  raw (first_name, part_label, marks) AS (
    VALUES
      ('julio', 'a', 3), ('julio', 'b', 4),
      ('nicolas', 'a', 3), ('nicolas', 'b', 4),
      ('gael', 'a', 3), ('gael', 'b', 4),
      ('minjun', 'a', 1), ('minjun', 'b', 4),
      ('camilla', 'a', 3), ('camilla', 'b', 3),
      ('pedro', 'a', 0), ('pedro', 'b', 2),
      ('salim', 'a', 3), ('salim', 'b', 4),
      ('wyatt', 'a', 3), ('wyatt', 'b', 4),
      ('seungjun', 'a', 3), ('seungjun', 'b', 4),
      ('carlos', 'a', 3), ('carlos', 'b', 1),
      ('luciana', 'a', 3), ('luciana', 'b', 3),
      ('alejandro', 'a', 1), ('alejandro', 'b', 2),
      ('gustavo', 'a', 3), ('gustavo', 'b', 3)
  )
INSERT INTO public.student_marks (student_id, test_item_id, marks_awarded)
SELECT
  p.id,
  q.id,
  r.marks
FROM raw r
JOIN q ON q.part_label = r.part_label
JOIN public.profiles p
  ON lower(split_part(p.display_name, ' ', 1)) = r.first_name
  AND p.role = 'student'
ON CONFLICT (test_item_id, student_id) DO UPDATE
  SET marks_awarded = EXCLUDED.marks_awarded;

-- Verification: every student should now have both 6a and 6b
SELECT
  p.display_name,
  MAX(CASE WHEN ti.part_label = 'a' THEN sm.marks_awarded END) AS q6a,
  MAX(CASE WHEN ti.part_label = 'b' THEN sm.marks_awarded END) AS q6b
FROM public.profiles p
LEFT JOIN public.student_marks sm ON sm.student_id = p.id
LEFT JOIN public.test_items ti ON ti.id = sm.test_item_id
LEFT JOIN public.tests t ON t.id = ti.test_id
WHERE p.role = 'student'
  AND t.name ILIKE '%K06%P1%'
  AND ti.question_number = 6
GROUP BY p.display_name
ORDER BY p.display_name;
