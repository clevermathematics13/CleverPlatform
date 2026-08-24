-- Migration 048: Import 27AH [K06] P1 teacher marks from gradebook
-- student_marks.student_id references profiles.id directly

WITH
  target_test AS (
    SELECT id FROM public.tests WHERE name ILIKE '%K06%P1%' LIMIT 1
  ),
  q AS (
    SELECT ti.id, ti.question_number, COALESCE(ti.part_label, '') AS part_label
    FROM public.test_items ti
    WHERE ti.test_id = (SELECT id FROM target_test)
  ),
  raw (first_name, q_num, part, marks) AS (
    VALUES
    -- Julio
    ('julio',1,'a',2),('julio',1,'b',3),('julio',1,'c',2),('julio',2,'',4),
    ('julio',3,'a',3),('julio',3,'b',4),('julio',4,'',0),('julio',5,'',1),
    ('julio',6,'a',3),('julio',6,'b',4),('julio',7,'a',0),('julio',7,'b',0),
    ('julio',8,'a',3),('julio',8,'bi',2),('julio',8,'bii',3),('julio',8,'c',6),
    ('julio',9,'a',2),('julio',9,'b',2),('julio',9,'c',6),
    -- Nicolas
    ('nicolas',1,'a',2),('nicolas',1,'b',3),('nicolas',1,'c',2),('nicolas',2,'',5),
    ('nicolas',3,'a',3),('nicolas',3,'b',4),('nicolas',4,'',4),('nicolas',5,'',2),
    ('nicolas',6,'a',3),('nicolas',6,'b',4),('nicolas',7,'a',4),('nicolas',7,'b',2),
    ('nicolas',8,'a',2),('nicolas',8,'bi',2),('nicolas',8,'bii',3),('nicolas',8,'c',1),
    ('nicolas',9,'a',2),('nicolas',9,'b',0),('nicolas',9,'c',2),
    -- Gael
    ('gael',1,'a',2),('gael',1,'b',3),('gael',1,'c',2),('gael',2,'',5),
    ('gael',3,'a',3),('gael',3,'b',3),('gael',4,'',5),('gael',5,'',2),
    ('gael',6,'a',3),('gael',6,'b',4),('gael',7,'a',0),('gael',7,'b',2),
    ('gael',8,'a',3),('gael',8,'bi',4),('gael',8,'bii',1),('gael',8,'c',3),
    ('gael',9,'a',2),('gael',9,'b',0),('gael',9,'c',4),
    -- Minjun
    ('minjun',1,'a',2),('minjun',1,'b',3),('minjun',1,'c',2),('minjun',2,'',5),
    ('minjun',3,'a',3),('minjun',3,'b',4),('minjun',4,'',5),('minjun',5,'',2),
    ('minjun',6,'a',1),('minjun',6,'b',4),('minjun',7,'a',4),('minjun',7,'b',2),
    ('minjun',8,'a',3),('minjun',8,'bi',4),('minjun',8,'bii',3),('minjun',8,'c',6),
    ('minjun',9,'a',2),('minjun',9,'b',2),('minjun',9,'c',8),
    -- Camilla
    ('camilla',1,'a',2),('camilla',1,'b',3),('camilla',1,'c',2),('camilla',2,'',1),
    ('camilla',3,'a',3),('camilla',3,'b',0),('camilla',4,'',0),('camilla',5,'',4),
    ('camilla',6,'a',3),('camilla',6,'b',3),('camilla',7,'a',4),('camilla',7,'b',0),
    ('camilla',8,'a',3),('camilla',8,'bi',4),('camilla',8,'bii',3),('camilla',8,'c',1),
    ('camilla',9,'a',2),('camilla',9,'b',0),('camilla',9,'c',3),
    -- Pedro
    ('pedro',1,'a',2),('pedro',1,'b',3),('pedro',1,'c',2),('pedro',2,'',5),
    ('pedro',3,'a',3),('pedro',3,'b',4),('pedro',4,'',0),('pedro',5,'',2),
    ('pedro',6,'a',0),('pedro',6,'b',2),('pedro',7,'a',0),('pedro',7,'b',0),
    ('pedro',8,'a',3),('pedro',8,'bi',4),('pedro',8,'bii',3),('pedro',8,'c',2),
    ('pedro',9,'a',0),('pedro',9,'b',1),('pedro',9,'c',0),
    -- Salim
    ('salim',1,'a',2),('salim',1,'b',2),('salim',1,'c',2),('salim',2,'',0),
    ('salim',3,'a',3),('salim',3,'b',0),('salim',4,'',0),('salim',5,'',2),
    ('salim',6,'a',3),('salim',6,'b',4),('salim',7,'a',4),('salim',7,'b',1),
    ('salim',8,'a',3),('salim',8,'bi',4),('salim',8,'bii',2),('salim',8,'c',0),
    ('salim',9,'a',0),('salim',9,'b',0),('salim',9,'c',3),
    -- Wyatt
    ('wyatt',1,'a',2),('wyatt',1,'b',3),('wyatt',1,'c',2),('wyatt',2,'',5),
    ('wyatt',3,'a',3),('wyatt',3,'b',4),('wyatt',4,'',1),('wyatt',5,'',4),
    ('wyatt',6,'a',3),('wyatt',6,'b',4),('wyatt',7,'a',1),('wyatt',7,'b',2),
    ('wyatt',8,'a',3),('wyatt',8,'bi',3),('wyatt',8,'bii',1),('wyatt',8,'c',5),
    ('wyatt',9,'a',1),('wyatt',9,'b',2),('wyatt',9,'c',5),
    -- Seungjun
    ('seungjun',1,'a',2),('seungjun',1,'b',3),('seungjun',1,'c',2),('seungjun',2,'',5),
    ('seungjun',3,'a',3),('seungjun',3,'b',4),('seungjun',4,'',4),('seungjun',5,'',2),
    ('seungjun',6,'a',3),('seungjun',6,'b',4),('seungjun',7,'a',1),('seungjun',7,'b',2),
    ('seungjun',8,'a',1),('seungjun',8,'bi',4),('seungjun',8,'bii',3),('seungjun',8,'c',6),
    ('seungjun',9,'a',2),('seungjun',9,'b',2),('seungjun',9,'c',8),
    -- Carlos
    ('carlos',1,'a',2),('carlos',1,'b',3),('carlos',1,'c',2),('carlos',2,'',4),
    ('carlos',3,'a',3),('carlos',3,'b',0),('carlos',4,'',0),('carlos',5,'',4),
    ('carlos',6,'a',3),('carlos',6,'b',1),('carlos',7,'a',1),('carlos',7,'b',2),
    ('carlos',8,'a',3),('carlos',8,'bi',4),('carlos',8,'bii',2),('carlos',8,'c',3),
    ('carlos',9,'a',2),('carlos',9,'b',0),('carlos',9,'c',0),
    -- Luciana
    ('luciana',1,'a',0),('luciana',1,'b',2),('luciana',1,'c',2),('luciana',2,'',5),
    ('luciana',3,'a',3),('luciana',3,'b',4),('luciana',4,'',5),('luciana',5,'',4),
    ('luciana',6,'a',3),('luciana',6,'b',3),('luciana',7,'a',2),('luciana',7,'b',4),
    ('luciana',8,'a',3),('luciana',8,'bi',4),('luciana',8,'bii',3),('luciana',8,'c',4),
    ('luciana',9,'a',2),('luciana',9,'b',2),('luciana',9,'c',5),
    -- Alejandro
    ('alejandro',1,'a',2),('alejandro',1,'b',3),('alejandro',1,'c',2),('alejandro',2,'',5),
    ('alejandro',3,'a',3),('alejandro',3,'b',4),('alejandro',4,'',0),('alejandro',5,'',2),
    ('alejandro',6,'a',1),('alejandro',6,'b',2),('alejandro',7,'a',0),('alejandro',7,'b',0),
    ('alejandro',8,'a',3),('alejandro',8,'bi',2),('alejandro',8,'bii',1),('alejandro',8,'c',0),
    ('alejandro',9,'a',0),('alejandro',9,'b',1),('alejandro',9,'c',0),
    -- Gustavo
    ('gustavo',1,'a',2),('gustavo',1,'b',3),('gustavo',1,'c',2),('gustavo',2,'',5),
    ('gustavo',3,'a',3),('gustavo',3,'b',4),('gustavo',4,'',0),('gustavo',5,'',4),
    ('gustavo',6,'a',3),('gustavo',6,'b',3),('gustavo',7,'a',2),('gustavo',7,'b',4),
    ('gustavo',8,'a',3),('gustavo',8,'bi',4),('gustavo',8,'bii',3),('gustavo',8,'c',6),
    ('gustavo',9,'a',2),('gustavo',9,'b',0),('gustavo',9,'c',4)
  )

INSERT INTO public.student_marks (student_id, test_item_id, marks_awarded)
SELECT
  p.id            AS student_id,
  q.id            AS test_item_id,
  r.marks         AS marks_awarded
FROM raw r
JOIN q
  ON q.question_number = r.q_num
  AND q.part_label      = r.part
JOIN public.profiles p
  ON lower(split_part(p.display_name, ' ', 1)) = r.first_name
  AND p.role = 'student'
ON CONFLICT (test_item_id, student_id) DO UPDATE
  SET marks_awarded = EXCLUDED.marks_awarded;

-- Verify: show row counts per student
SELECT p.display_name, COUNT(*) AS rows_inserted
FROM public.student_marks sm
JOIN public.test_items ti ON ti.id = sm.test_item_id
JOIN public.tests t ON t.id = ti.test_id AND t.name ILIKE '%K06%P1%'
JOIN public.profiles p ON p.id = sm.student_id
GROUP BY p.display_name
ORDER BY p.display_name;
