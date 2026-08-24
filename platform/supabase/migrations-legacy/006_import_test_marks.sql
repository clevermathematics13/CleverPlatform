-- =============================================
-- Import test data for "27AH [P01] P1"
-- Run in Supabase SQL Editor
-- =============================================

-- Step 1: Fix test total (screenshot shows 14 items totaling 64 marks)
UPDATE public.tests SET total_marks = 64
WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- Step 2: Delete old test items and re-insert matching screenshot layout
DELETE FROM public.test_items
WHERE test_id = 'a0000000-0000-0000-0000-000000000001';

INSERT INTO public.test_items (test_id, question_number, ib_question_code, part_label, max_marks, subtopic_codes, sort_order) VALUES
('a0000000-0000-0000-0000-000000000001', 1, 'EXM.1.SL.TZ0.1',    '',  7,  ARRAY['1.6'],         0),
('a0000000-0000-0000-0000-000000000001', 2, 'SPM.1.SL.TZ0.3',    '',  4,  ARRAY['1.6'],         1),
('a0000000-0000-0000-0000-000000000001', 3, 'EXN.1.SL.TZ0.4',    '',  6,  ARRAY['1.6'],         2),
('a0000000-0000-0000-0000-000000000001', 4, '22N.1.SL.TZ0.S_4',  'a', 4,  ARRAY['1.6'],         3),
('a0000000-0000-0000-0000-000000000001', 4, '22N.1.SL.TZ0.S_4',  'b', 2,  ARRAY['3.2'],         4),
('a0000000-0000-0000-0000-000000000001', 5, '17M.1.SL.TZ2.S_1',  '',  5,  ARRAY['1.2'],         5),
('a0000000-0000-0000-0000-000000000001', 6, '16N.1.SL.TZ0.S_8',  'a', 4,  ARRAY['3.12'],        6),
('a0000000-0000-0000-0000-000000000001', 6, '16N.1.SL.TZ0.S_8',  'b', 2,  ARRAY['3.12'],        7),
('a0000000-0000-0000-0000-000000000001', 6, '16N.1.SL.TZ0.S_8',  'c', 5,  ARRAY['3.12'],        8),
('a0000000-0000-0000-0000-000000000001', 6, '16N.1.SL.TZ0.S_8',  'd', 5,  ARRAY['3.12'],        9),
('a0000000-0000-0000-0000-000000000001', 7, '23M.1.AHL.TZ2.H_7', 'a', 1,  ARRAY['1.15 (ind)'], 10),
('a0000000-0000-0000-0000-000000000001', 7, '13N.1.AHL.TZ0.H_6', 'b', 4,  ARRAY['1.15 (ind)'], 11),
('a0000000-0000-0000-0000-000000000001', 7, '23M.2.AHL.TZ1.H_9', 'c', 7,  ARRAY['1.15.1'],     12),
('a0000000-0000-0000-0000-000000000001', 7, '23M.2.AHL.TZ1.H_9', 'd', 8,  ARRAY['1.15.1'],     13);

-- Step 3: Import student marks
-- Marks are matched via: first name → invited_students.student_name → profiles.email
-- NOTE: Only students who have logged in (have a profile) will get marks inserted.
-- If 0 rows are inserted, it means no students have logged in yet.

INSERT INTO public.student_marks (test_item_id, student_id, marks_awarded)
SELECT ti.id, p.id, v.marks
FROM (VALUES
  -- Julio:      Q1=3, Q2=4, Q3=6, Q4a=3, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=5, Q7a=1, Q7b=2, Q7c=7, Q7d=2
  ('Julio',      0, 3), ('Julio',      1, 4), ('Julio',      2, 6), ('Julio',      3, 3), ('Julio',      4, 2),
  ('Julio',      5, 5), ('Julio',      6, 4), ('Julio',      7, 2), ('Julio',      8, 5), ('Julio',      9, 5),
  ('Julio',     10, 1), ('Julio',     11, 2), ('Julio',     12, 7), ('Julio',     13, 2),
  -- Nicolas:    Q1=6, Q2=0, Q3=6, Q4a=4, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=4, Q7a=1, Q7b=1, Q7c=2, Q7d=0
  ('Nicolas',    0, 6), ('Nicolas',    1, 0), ('Nicolas',    2, 6), ('Nicolas',    3, 4), ('Nicolas',    4, 2),
  ('Nicolas',    5, 5), ('Nicolas',    6, 4), ('Nicolas',    7, 2), ('Nicolas',    8, 5), ('Nicolas',    9, 4),
  ('Nicolas',   10, 1), ('Nicolas',   11, 1), ('Nicolas',   12, 2), ('Nicolas',   13, 0),
  -- Gael:       Q1=7, Q2=4, Q3=6, Q4a=2, Q4b=0, Q5=1, Q6a=4, Q6b=2, Q6c=2, Q6d=5, Q7a=1, Q7b=4, Q7c=0, Q7d=2
  ('Gael',       0, 7), ('Gael',       1, 4), ('Gael',       2, 6), ('Gael',       3, 2), ('Gael',       4, 0),
  ('Gael',       5, 1), ('Gael',       6, 4), ('Gael',       7, 2), ('Gael',       8, 2), ('Gael',       9, 5),
  ('Gael',      10, 1), ('Gael',      11, 4), ('Gael',      12, 0), ('Gael',      13, 2),
  -- Minjun:     Q1=7, Q2=4, Q3=6, Q4a=4, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=5, Q7a=1, Q7b=4, Q7c=7, Q7d=8
  ('Minjun',     0, 7), ('Minjun',     1, 4), ('Minjun',     2, 6), ('Minjun',     3, 4), ('Minjun',     4, 2),
  ('Minjun',     5, 5), ('Minjun',     6, 4), ('Minjun',     7, 2), ('Minjun',     8, 5), ('Minjun',     9, 5),
  ('Minjun',    10, 1), ('Minjun',    11, 4), ('Minjun',    12, 7), ('Minjun',    13, 8),
  -- Camilla:    Q1=3, Q2=4, Q3=6, Q4a=4, Q4b=2, Q5=1, Q6a=4, Q6b=2, Q6c=1, Q6d=0, Q7a=1, Q7b=1, Q7c=3, Q7d=0
  ('Camilla',    0, 3), ('Camilla',    1, 4), ('Camilla',    2, 6), ('Camilla',    3, 4), ('Camilla',    4, 2),
  ('Camilla',    5, 1), ('Camilla',    6, 4), ('Camilla',    7, 2), ('Camilla',    8, 1), ('Camilla',    9, 0),
  ('Camilla',   10, 1), ('Camilla',   11, 1), ('Camilla',   12, 3), ('Camilla',   13, 0),
  -- Pedro:      Q1=1, Q2=0, Q3=6, Q4a=0, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=0, Q6d=4, Q7a=1, Q7b=2, Q7c=0, Q7d=0
  ('Pedro',      0, 1), ('Pedro',      1, 0), ('Pedro',      2, 6), ('Pedro',      3, 0), ('Pedro',      4, 0),
  ('Pedro',      5, 5), ('Pedro',      6, 4), ('Pedro',      7, 2), ('Pedro',      8, 0), ('Pedro',      9, 4),
  ('Pedro',     10, 1), ('Pedro',     11, 2), ('Pedro',     12, 0), ('Pedro',     13, 0),
  -- Salim:      Q1=5, Q2=0, Q3=3, Q4a=2, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=0, Q6d=4, Q7a=1, Q7b=0, Q7c=2, Q7d=0
  ('Salim',      0, 5), ('Salim',      1, 0), ('Salim',      2, 3), ('Salim',      3, 2), ('Salim',      4, 0),
  ('Salim',      5, 5), ('Salim',      6, 4), ('Salim',      7, 2), ('Salim',      8, 0), ('Salim',      9, 4),
  ('Salim',     10, 1), ('Salim',     11, 0), ('Salim',     12, 2), ('Salim',     13, 0),
  -- Wyatt:      Q1=2, Q2=2, Q3=6, Q4a=3, Q4b=1, Q5=3, Q6a=4, Q6b=2, Q6c=2, Q6d=4, Q7a=1, Q7b=0, Q7c=1, Q7d=0
  ('Wyatt',      0, 2), ('Wyatt',      1, 2), ('Wyatt',      2, 6), ('Wyatt',      3, 3), ('Wyatt',      4, 1),
  ('Wyatt',      5, 3), ('Wyatt',      6, 4), ('Wyatt',      7, 2), ('Wyatt',      8, 2), ('Wyatt',      9, 4),
  ('Wyatt',     10, 1), ('Wyatt',     11, 0), ('Wyatt',     12, 1), ('Wyatt',     13, 0),
  -- Seungjun:   Q1=7, Q2=4, Q3=6, Q4a=4, Q4b=2, Q5=5, Q6a=4, Q6b=2, Q6c=5, Q6d=5, Q7a=1, Q7b=4, Q7c=7, Q7d=7
  ('Seungjun',   0, 7), ('Seungjun',   1, 4), ('Seungjun',   2, 6), ('Seungjun',   3, 4), ('Seungjun',   4, 2),
  ('Seungjun',   5, 5), ('Seungjun',   6, 4), ('Seungjun',   7, 2), ('Seungjun',   8, 5), ('Seungjun',   9, 5),
  ('Seungjun',  10, 1), ('Seungjun',  11, 4), ('Seungjun',  12, 7), ('Seungjun',  13, 7),
  -- Carlos:     Q1=7, Q2=4, Q3=6, Q4a=3, Q4b=1, Q5=1, Q6a=4, Q6b=2, Q6c=0, Q6d=5, Q7a=1, Q7b=0, Q7c=0, Q7d=0
  ('Carlos',     0, 7), ('Carlos',     1, 4), ('Carlos',     2, 6), ('Carlos',     3, 3), ('Carlos',     4, 1),
  ('Carlos',     5, 1), ('Carlos',     6, 4), ('Carlos',     7, 2), ('Carlos',     8, 0), ('Carlos',     9, 5),
  ('Carlos',    10, 1), ('Carlos',    11, 0), ('Carlos',    12, 0), ('Carlos',    13, 0),
  -- Luciana:    Q1=5, Q2=2, Q3=3, Q4a=4, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=0, Q6d=0, Q7a=1, Q7b=4, Q7c=2, Q7d=3
  ('Luciana',    0, 5), ('Luciana',    1, 2), ('Luciana',    2, 3), ('Luciana',    3, 4), ('Luciana',    4, 0),
  ('Luciana',    5, 5), ('Luciana',    6, 4), ('Luciana',    7, 2), ('Luciana',    8, 0), ('Luciana',    9, 0),
  ('Luciana',   10, 1), ('Luciana',   11, 4), ('Luciana',   12, 2), ('Luciana',   13, 3),
  -- Alejandro:  Q1=5, Q2=4, Q3=6, Q4a=0, Q4b=0, Q5=0, Q6a=4, Q6b=0, Q6c=0, Q6d=0, Q7a=1, Q7b=0, Q7c=0, Q7d=3
  ('Alejandro',  0, 5), ('Alejandro',  1, 4), ('Alejandro',  2, 6), ('Alejandro',  3, 0), ('Alejandro',  4, 0),
  ('Alejandro',  5, 0), ('Alejandro',  6, 4), ('Alejandro',  7, 0), ('Alejandro',  8, 0), ('Alejandro',  9, 0),
  ('Alejandro', 10, 1), ('Alejandro', 11, 0), ('Alejandro', 12, 0), ('Alejandro', 13, 3),
  -- Gustavo:    Q1=7, Q2=2, Q3=6, Q4a=2, Q4b=0, Q5=5, Q6a=4, Q6b=2, Q6c=2, Q6d=4, Q7a=1, Q7b=1, Q7c=2, Q7d=0
  ('Gustavo',    0, 7), ('Gustavo',    1, 2), ('Gustavo',    2, 6), ('Gustavo',    3, 2), ('Gustavo',    4, 0),
  ('Gustavo',    5, 5), ('Gustavo',    6, 4), ('Gustavo',    7, 2), ('Gustavo',    8, 2), ('Gustavo',    9, 4),
  ('Gustavo',   10, 1), ('Gustavo',   11, 1), ('Gustavo',   12, 2), ('Gustavo',   13, 0)
) AS v(name, sort_ord, marks)
JOIN public.test_items ti
  ON ti.test_id = 'a0000000-0000-0000-0000-000000000001'
  AND ti.sort_order = v.sort_ord
JOIN public.invited_students ist
  ON ist.student_name ILIKE v.name || '%'
JOIN public.profiles p
  ON p.email = ist.email
ON CONFLICT (test_item_id, student_id) DO NOTHING;

-- Step 4: Verify results
SELECT
  p.full_name,
  t.name AS test_name,
  SUM(sm.marks_awarded) AS marks_earned,
  t.total_marks AS max_total,
  ROUND(100.0 * SUM(sm.marks_awarded) / t.total_marks, 1) AS pct
FROM public.student_marks sm
JOIN public.test_items ti ON ti.id = sm.test_item_id
JOIN public.tests t ON t.id = ti.test_id
JOIN public.profiles p ON p.id = sm.student_id
WHERE t.id = 'a0000000-0000-0000-0000-000000000001'
GROUP BY p.full_name, t.name, t.total_marks
ORDER BY pct DESC;
