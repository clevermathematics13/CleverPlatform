-- 061: create question_parts rows for the 3 BiStats-exam questions that have
-- zero parts today, so re-extraction/OCR has somewhere real to attach
-- content/images to instead of part_id=null. Marks and labels come from the
-- teacher's own ExamBuilder spreadsheet cross-checked against the actual
-- exam PDF (Q1 [Max mark: 7] blank-part, Q2 [Max mark: 7] blank-part,
-- Q4 [Max mark: 13] split a/b/c at 3/3/7).
--
-- 21N.2.AHL.TZ0.H_1 already has a correct single blank-label 7-mark part
-- (id 1aba541a...) and is untouched by this migration.

-- 15M.2.SL.TZ1.S_1 (exam Q2, 7 marks, whole question)
INSERT INTO public.question_parts (question_id, part_label, marks, sort_order)
VALUES ('879d01e0-5be1-402c-a3f5-92350a2f826a', '', 7, 0);

-- 21M.2.SL.TZ2.S_1 (exam Q3, 6 marks, whole question)
INSERT INTO public.question_parts (question_id, part_label, marks, sort_order)
VALUES ('53d5f42c-f9ce-424f-ad5b-20538670d75a', '', 6, 0);

-- 18M.2.SL.TZ1.S_8 (exam Q4, 13 marks total, split a=3 b=3 c=7 per the spreadsheet)
INSERT INTO public.question_parts (question_id, part_label, marks, sort_order)
VALUES
  ('4fb4718b-1588-40e1-80fa-04584f05b6f6', 'a', 3, 0),
  ('4fb4718b-1588-40e1-80fa-04584f05b6f6', 'b', 3, 1),
  ('4fb4718b-1588-40e1-80fa-04584f05b6f6', 'c', 7, 2);;
