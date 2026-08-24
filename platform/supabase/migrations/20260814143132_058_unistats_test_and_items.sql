-- 058: create the "27AH [L00] P2 UniStats" test and its five test_items,
-- so AI-graded results from the scanned batch have somewhere to land.

INSERT INTO public.tests (id, teacher_id, course_id, name, test_date, total_marks)
VALUES (
  'b1000000-0000-4000-8000-000000000001',
  '702750f6-be43-47d2-a422-a2f15b4d0bf9',
  '7abac7b1-2cf6-4c94-a12b-3e083ed139c3',
  '27AH [L00] P2 UniStats',
  '2026-06-19',
  25
);

INSERT INTO public.test_items (id, test_id, question_number, ib_question_code, part_label, max_marks, sort_order)
VALUES
  ('b1000000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000001', 1, '19M.2.SL.TZ1.S_1',  '', 5, 1),
  ('b1000000-0000-4000-8000-000000000012', 'b1000000-0000-4000-8000-000000000001', 2, '13M.2.SL.TZ1.S_2',  '', 6, 2),
  ('b1000000-0000-4000-8000-000000000013', 'b1000000-0000-4000-8000-000000000001', 3, '22M.2.SL.TZ1.S_2',  '', 4, 3),
  ('b1000000-0000-4000-8000-000000000014', 'b1000000-0000-4000-8000-000000000001', 4, '22M.2.SL.TZ2.S_5',  '', 6, 4),
  ('b1000000-0000-4000-8000-000000000015', 'b1000000-0000-4000-8000-000000000001', 5, '13M.2.AHL.TZ1.H_1', '', 4, 5);;
