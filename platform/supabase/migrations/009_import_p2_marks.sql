-- 009: Import student marks for "27AH [K05] P2"
-- Corrects test structure from 80→64 marks (14 items, not 17)
-- Marks will be inserted when students have registered profiles

-- ============================================
-- 1. Fix test: delete old items, set correct total
-- ============================================
DELETE FROM public.test_items
WHERE test_id = 'a0000000-0000-0000-0000-000000000002';

UPDATE public.tests SET total_marks = 64
WHERE id = 'a0000000-0000-0000-0000-000000000002';

-- ============================================
-- 2. Insert 14 test items matching gradebook
--    Q1(7), Q2(4), Q3(6), Q4a(4), Q4b(2), Q5(5),
--    Q6a(4), Q6b(2), Q6c(5), Q6d(5),
--    Q7a(1), Q7b(4), Q7c(7), Q7d(8)  = 64
-- ============================================
INSERT INTO public.test_items
  (test_id, question_number, ib_question_code, part_label, max_marks, subtopic_codes, google_doc_id, google_ms_id, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000002', 1, '22M.2.AHL.TZ2.H_6',  '',  7, ARRAY['5.17 (vol)'], '1Q6QdVYLL0iOo00cdu3-oGOASNXI3P-zjddHBgMHH7DU', '17VFlp49U15wcbOoSP7wNUdraz3TjElwYwyvavLErec8',  0),
  ('a0000000-0000-0000-0000-000000000002', 2, '22M.2.AHL.TZ2.H_7',  '',  4, ARRAY['5.13'],       '1GjApU2kNImuwo8Q8cQ2cR_J41XT3Fe7BZWqnZElqWVs', '1ogg4P9-_Q5-7GVgrtIbo355WjhYgoYs7Mjk0OOjO7Ho',  1),
  ('a0000000-0000-0000-0000-000000000002', 3, '22M.2.AHL.TZ2.H_8',  '',  6, ARRAY['4.9'],        '1dQDyTZPkwaKvT3qxvir8eaFbFhNIYZOZjkIrTfkLuX0', '1DZ1VMR3IdjD58Od9_q5GTQPgjOy5l2rHR125r8b3Aw4',  2),
  ('a0000000-0000-0000-0000-000000000002', 4, '22M.2.AHL.TZ2.H_9',  'a', 4, ARRAY['1.1'],        '15DnfS23MjKkzG9bxXM0rgHOnB3jfpk_zGQI1m_78udg', '1vSZlJi0hmS3poRPnELKFMJeD0L8oSrPZX-kwbck5d-k',  3),
  ('a0000000-0000-0000-0000-000000000002', 4, '22M.2.AHL.TZ2.H_9',  'b', 2, ARRAY['1.1'],        '15DnfS23MjKkzG9bxXM0rgHOnB3jfpk_zGQI1m_78udg', '1vSZlJi0hmS3poRPnELKFMJeD0L8oSrPZX-kwbck5d-k',  4),
  ('a0000000-0000-0000-0000-000000000002', 5, '22M.2.AHL.TZ2.H_10', '',  5, ARRAY['3.7'],        '14KHubH7N-mNGOT-CwB2Z7IRq2dw3dq0E6q4rGSlMbYg', '1wEO17aobk34aABWhz1lpU5sYB8-1Ms7XGUZKcc_WNk8',  5),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'a', 4, ARRAY['3.14'],       '1dDRzrUi22EahxCEtJwRH-V3jdT0MVPvuvi_au8mt7go', '1JX18BxFKi-at4rzgqJbGa-Fri8rJjpUM3RGS17EnTtw',  6),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'b', 2, ARRAY['3.12'],       '1dDRzrUi22EahxCEtJwRH-V3jdT0MVPvuvi_au8mt7go', '1JX18BxFKi-at4rzgqJbGa-Fri8rJjpUM3RGS17EnTtw',  7),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'c', 5, ARRAY['3.14'],       '1dDRzrUi22EahxCEtJwRH-V3jdT0MVPvuvi_au8mt7go', '1JX18BxFKi-at4rzgqJbGa-Fri8rJjpUM3RGS17EnTtw',  8),
  ('a0000000-0000-0000-0000-000000000002', 6, '22M.2.AHL.TZ2.H_11', 'd', 5, ARRAY['3.15'],       '1dDRzrUi22EahxCEtJwRH-V3jdT0MVPvuvi_au8mt7go', '1JX18BxFKi-at4rzgqJbGa-Fri8rJjpUM3RGS17EnTtw',  9),
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'a', 1, ARRAY['5.1'],        '1Or2f0cXW3pxhm8g913gI-hb_Gasl3pjNGoDMrB3X2fQ', '1O-dU6ei1r7DgYFDkbtM7ZGWvNB5UQzRPBQkvvJbw9tc', 10),
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'b', 4, ARRAY['5.14.1'],     '1Or2f0cXW3pxhm8g913gI-hb_Gasl3pjNGoDMrB3X2fQ', '1O-dU6ei1r7DgYFDkbtM7ZGWvNB5UQzRPBQkvvJbw9tc', 11),
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'c', 7, ARRAY['5.8'],        '1Or2f0cXW3pxhm8g913gI-hb_Gasl3pjNGoDMrB3X2fQ', '1O-dU6ei1r7DgYFDkbtM7ZGWvNB5UQzRPBQkvvJbw9tc', 12),
  ('a0000000-0000-0000-0000-000000000002', 7, '22M.2.AHL.TZ2.H_12', 'd', 8, ARRAY['5.18 (sep)'], '1Or2f0cXW3pxhm8g913gI-hb_Gasl3pjNGoDMrB3X2fQ', '1O-dU6ei1r7DgYFDkbtM7ZGWvNB5UQzRPBQkvvJbw9tc', 13);

-- ============================================
-- 3. Import student marks (13 students × 14 items)
-- ============================================
INSERT INTO public.student_marks (test_item_id, student_id, marks_awarded)
SELECT ti.id, p.id, v.marks
FROM (VALUES
  -- Julio:     Q1=3, Q2=4, Q3=6, Q4a=3, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=5, Q7a=1, Q7b=2, Q7c=7, Q7d=2  (raw=51)
  ('Julio',      0, 3), ('Julio',      1, 4), ('Julio',      2, 6), ('Julio',      3, 3), ('Julio',      4, 2),
  ('Julio',      5, 5), ('Julio',      6, 4), ('Julio',      7, 2), ('Julio',      8, 5), ('Julio',      9, 5),
  ('Julio',     10, 1), ('Julio',     11, 2), ('Julio',     12, 7), ('Julio',     13, 2),
  -- Nicolas:   Q1=6, Q2=0, Q3=6, Q4a=4, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=4, Q7a=1, Q7b=1, Q7c=2, Q7d=0  (raw=42)
  ('Nicolas',    0, 6), ('Nicolas',    1, 0), ('Nicolas',    2, 6), ('Nicolas',    3, 4), ('Nicolas',    4, 2),
  ('Nicolas',    5, 5), ('Nicolas',    6, 4), ('Nicolas',    7, 2), ('Nicolas',    8, 5), ('Nicolas',    9, 4),
  ('Nicolas',   10, 1), ('Nicolas',   11, 1), ('Nicolas',   12, 2), ('Nicolas',   13, 0),
  -- Gael:      Q1=7, Q2=4, Q3=6, Q4a=2, Q4b=0, Q5=1, Q6a=4, Q6b=2, Q6c=2, Q6d=5, Q7a=1, Q7b=4, Q7c=0, Q7d=2  (raw=40)
  ('Gael',       0, 7), ('Gael',       1, 4), ('Gael',       2, 6), ('Gael',       3, 2), ('Gael',       4, 0),
  ('Gael',       5, 1), ('Gael',       6, 4), ('Gael',       7, 2), ('Gael',       8, 2), ('Gael',       9, 5),
  ('Gael',      10, 1), ('Gael',      11, 4), ('Gael',      12, 0), ('Gael',      13, 2),
  -- Minjun:    Q1=7, Q2=4, Q3=6, Q4a=4, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=5, Q7a=1, Q7b=4, Q7c=7, Q7d=8  (raw=64)
  ('Minjun',     0, 7), ('Minjun',     1, 4), ('Minjun',     2, 6), ('Minjun',     3, 4), ('Minjun',     4, 2),
  ('Minjun',     5, 5), ('Minjun',     6, 4), ('Minjun',     7, 2), ('Minjun',     8, 5), ('Minjun',     9, 5),
  ('Minjun',    10, 1), ('Minjun',    11, 4), ('Minjun',    12, 7), ('Minjun',    13, 8),
  -- Camilla:   Q1=3, Q2=4, Q3=6, Q4a=4, Q4b=2, Q5=1, Q6a=4, Q6b=2, Q6c=1, Q6d=0, Q7a=1, Q7b=1, Q7c=3, Q7d=0  (raw=32)
  ('Camilla',    0, 3), ('Camilla',    1, 4), ('Camilla',    2, 6), ('Camilla',    3, 4), ('Camilla',    4, 2),
  ('Camilla',    5, 1), ('Camilla',    6, 4), ('Camilla',    7, 2), ('Camilla',    8, 1), ('Camilla',    9, 0),
  ('Camilla',   10, 1), ('Camilla',   11, 1), ('Camilla',   12, 3), ('Camilla',   13, 0),
  -- Pedro:     Q1=1, Q2=0, Q3=6, Q4a=0, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=0, Q6d=4, Q7a=1, Q7b=2, Q7c=0, Q7d=0  (raw=25)
  ('Pedro',      0, 1), ('Pedro',      1, 0), ('Pedro',      2, 6), ('Pedro',      3, 0), ('Pedro',      4, 0),
  ('Pedro',      5, 5), ('Pedro',      6, 4), ('Pedro',      7, 2), ('Pedro',      8, 0), ('Pedro',      9, 4),
  ('Pedro',     10, 1), ('Pedro',     11, 2), ('Pedro',     12, 0), ('Pedro',     13, 0),
  -- Salim:     Q1=5, Q2=0, Q3=3, Q4a=2, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=0, Q6d=4, Q7a=1, Q7b=0, Q7c=2, Q7d=0  (raw=28)
  ('Salim',      0, 5), ('Salim',      1, 0), ('Salim',      2, 3), ('Salim',      3, 2), ('Salim',      4, 0),
  ('Salim',      5, 5), ('Salim',      6, 4), ('Salim',      7, 2), ('Salim',      8, 0), ('Salim',      9, 4),
  ('Salim',     10, 1), ('Salim',     11, 0), ('Salim',     12, 2), ('Salim',     13, 0),
  -- Wyatt:     Q1=2, Q2=2, Q3=6, Q4a=3, Q4b=1, Q5=3, Q6a=4, Q6b=2, Q6c=2, Q6d=4, Q7a=1, Q7b=0, Q7c=1, Q7d=0  (raw=31)
  ('Wyatt',      0, 2), ('Wyatt',      1, 2), ('Wyatt',      2, 6), ('Wyatt',      3, 3), ('Wyatt',      4, 1),
  ('Wyatt',      5, 3), ('Wyatt',      6, 4), ('Wyatt',      7, 2), ('Wyatt',      8, 2), ('Wyatt',      9, 4),
  ('Wyatt',     10, 1), ('Wyatt',     11, 0), ('Wyatt',     12, 1), ('Wyatt',     13, 0),
  -- Seungjun:  Q1=7, Q2=4, Q3=6, Q4a=4, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=5, Q7a=1, Q7b=4, Q7c=7, Q7d=7  (raw=63)
  ('Seungjun',   0, 7), ('Seungjun',   1, 4), ('Seungjun',   2, 6), ('Seungjun',   3, 4), ('Seungjun',   4, 2),
  ('Seungjun',   5, 5), ('Seungjun',   6, 4), ('Seungjun',   7, 2), ('Seungjun',   8, 5), ('Seungjun',   9, 5),
  ('Seungjun',  10, 1), ('Seungjun',  11, 4), ('Seungjun',  12, 7), ('Seungjun',  13, 7),
  -- Carlos:    Q1=7, Q2=4, Q3=6, Q4a=3, Q4b=1, Q5=1, Q6a=4, Q6b=2, Q6c=0, Q6d=5, Q7a=1, Q7b=0, Q7c=0, Q7d=0  (raw=34)
  ('Carlos',     0, 7), ('Carlos',     1, 4), ('Carlos',     2, 6), ('Carlos',     3, 3), ('Carlos',     4, 1),
  ('Carlos',     5, 1), ('Carlos',     6, 4), ('Carlos',     7, 2), ('Carlos',     8, 0), ('Carlos',     9, 5),
  ('Carlos',    10, 1), ('Carlos',    11, 0), ('Carlos',    12, 0), ('Carlos',    13, 0),
  -- Luciana:   Q1=5, Q2=2, Q3=3, Q4a=4, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=0, Q6d=0, Q7a=1, Q7b=4, Q7c=2, Q7d=3  (raw=35)
  ('Luciana',    0, 5), ('Luciana',    1, 2), ('Luciana',    2, 3), ('Luciana',    3, 4), ('Luciana',    4, 0),
  ('Luciana',    5, 5), ('Luciana',    6, 4), ('Luciana',    7, 2), ('Luciana',    8, 0), ('Luciana',    9, 0),
  ('Luciana',   10, 1), ('Luciana',   11, 4), ('Luciana',   12, 2), ('Luciana',   13, 3),
  -- Alejandro: Q1=5, Q2=4, Q3=6, Q4a=0, Q4b=0, Q5=0, Q6a=4, Q6b=0, Q6c=0, Q6d=0, Q7a=1, Q7b=0, Q7c=0, Q7d=3  (raw=23)
  ('Alejandro',  0, 5), ('Alejandro',  1, 4), ('Alejandro',  2, 6), ('Alejandro',  3, 0), ('Alejandro',  4, 0),
  ('Alejandro',  5, 0), ('Alejandro',  6, 4), ('Alejandro',  7, 0), ('Alejandro',  8, 0), ('Alejandro',  9, 0),
  ('Alejandro', 10, 1), ('Alejandro', 11, 0), ('Alejandro', 12, 0), ('Alejandro', 13, 3),
  -- Gustavo:   Q1=7, Q2=2, Q3=6, Q4a=2, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=2, Q6d=4, Q7a=1, Q7b=1, Q7c=2, Q7d=0  (raw=38)
  ('Gustavo',    0, 7), ('Gustavo',    1, 2), ('Gustavo',    2, 6), ('Gustavo',    3, 2), ('Gustavo',    4, 0),
  ('Gustavo',    5, 5), ('Gustavo',    6, 4), ('Gustavo',    7, 2), ('Gustavo',    8, 2), ('Gustavo',    9, 4),
  ('Gustavo',   10, 1), ('Gustavo',   11, 1), ('Gustavo',   12, 2), ('Gustavo',   13, 0)
) AS v(name, sort_ord, marks)
JOIN public.test_items ti
  ON ti.test_id = 'a0000000-0000-0000-0000-000000000002'
  AND ti.sort_order = v.sort_ord
JOIN public.invited_students ist
  ON ist.full_name ILIKE v.name || '%'
JOIN public.profiles p
  ON p.email = ist.email
ON CONFLICT (test_item_id, student_id) DO NOTHING;

-- ============================================
-- 4. Verify
-- ============================================
SELECT COUNT(*) AS item_count, SUM(max_marks) AS total_marks
FROM public.test_items
WHERE test_id = 'a0000000-0000-0000-0000-000000000002';
-- Expected: 14 items, 64 total marks

SELECT
  p.display_name,
  SUM(sm.marks_awarded) AS marks_earned,
  t.total_marks,
  ROUND(100.0 * SUM(sm.marks_awarded) / t.total_marks, 1) AS pct
FROM public.student_marks sm
JOIN public.test_items ti ON ti.id = sm.test_item_id
JOIN public.tests t ON t.id = ti.test_id
JOIN public.profiles p ON p.id = sm.student_id
WHERE t.id = 'a0000000-0000-0000-0000-000000000002'
GROUP BY p.display_name, t.total_marks
ORDER BY pct DESC;
