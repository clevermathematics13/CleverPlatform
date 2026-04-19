-- 007: Test structure for "27AH [K05] P2" — all 7 questions from May 2022 AHL P2 TZ2
-- 88 minutes, 80 marks total, 17 scoring items

-- ============================================
-- 1. Create the test (reuse teacher & course from P1)
-- ============================================
INSERT INTO public.tests (id, teacher_id, course_id, name, total_marks)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  (SELECT teacher_id FROM public.tests WHERE id = 'a0000000-0000-0000-0000-000000000001'),
  (SELECT course_id FROM public.tests WHERE id = 'a0000000-0000-0000-0000-000000000001'),
  '27AH [K05] P2',
  80
);

-- ============================================
-- 2. Insert 17 test items (Q1–Q4 whole, Q5 a–d, Q6 a–e, Q7 a–c+e)
-- ============================================
INSERT INTO public.test_items
  (test_id, question_number, ib_question_code, part_label, max_marks, subtopic_codes, sort_order)
VALUES
  -- Q1 (5 marks)
  ('a0000000-0000-0000-0000-000000000002', 1, '22M.2.AHL.TZ2.H_6',  '',  5, ARRAY['5.17 (vol)'],  0),
  -- Q2 (8 marks)
  ('a0000000-0000-0000-0000-000000000002', 2, '22M.2.AHL.TZ2.H_7',  '',  8, ARRAY['5.13'],        1),
  -- Q3 (7 marks)
  ('a0000000-0000-0000-0000-000000000002', 3, '22M.2.AHL.TZ2.H_8',  '',  7, ARRAY['4.9'],         2),
  -- Q4 (4 marks)
  ('a0000000-0000-0000-0000-000000000002', 4, '22M.2.AHL.TZ2.H_9',  '',  4, ARRAY['1.1'],         3),
  -- Q5 (15 marks = 3+3+3+6)
  ('a0000000-0000-0000-0000-000000000002', 5, '22M.2.AHL.TZ2.H_10', 'a', 3, ARRAY['3.7'],         4),
  ('a0000000-0000-0000-0000-000000000002', 5, '22M.2.AHL.TZ2.H_10', 'b', 3, ARRAY['2.1'],         5),
  ('a0000000-0000-0000-0000-000000000002', 5, '22M.2.AHL.TZ2.H_10', 'c', 3, ARRAY['1.6'],         6),
  ('a0000000-0000-0000-0000-000000000002', 5, '22M.2.AHL.TZ2.H_10', 'd', 6, ARRAY['5.2'],         7),
  -- Q6 (20 marks = 2+2+4+7+5)
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'a', 2, ARRAY['3.14'],        8),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'b', 2, ARRAY['3.12'],        9),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'c', 4, ARRAY['3.14'],       10),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'd', 7, ARRAY['3.15'],       11),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'e', 5, ARRAY['3.15'],       12),
  -- Q7 (21 marks = 1+4+7+9, parts a–c + e, no d)
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'a', 1, ARRAY['5.1'],        13),
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'b', 4, ARRAY['5.14.1'],     14),
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'c', 7, ARRAY['5.8'],        15),
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'e', 9, ARRAY['5.18 (sep)'], 16);

-- ============================================
-- 3. Verify totals
-- ============================================
SELECT
  question_number,
  part_label,
  ib_question_code,
  max_marks,
  subtopic_codes
FROM public.test_items
WHERE test_id = 'a0000000-0000-0000-0000-000000000002'
ORDER BY sort_order;

SELECT COUNT(*) AS item_count, SUM(max_marks) AS total_marks
FROM public.test_items
WHERE test_id = 'a0000000-0000-0000-0000-000000000002';
-- Expected: 17 items, 80 total marks
