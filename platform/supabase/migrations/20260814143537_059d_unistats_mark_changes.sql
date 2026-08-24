INSERT INTO public.mark_changes (test_item_id, student_id, changed_by, old_marks, new_marks, reason)
SELECT sm.test_item_id, sm.student_id, '702750f6-be43-47d2-a422-a2f15b4d0bf9', NULL, sm.marks_awarded,
  'AI-assisted grading against uploaded official mark scheme (27AH [L00] P2 UniStats), reviewed and accepted in chat, run ' || run.id
FROM public.student_marks sm
JOIN public.test_items ti ON ti.id = sm.test_item_id
JOIN public.ai_grade_runs run ON run.test_id = ti.test_id AND run.student_id = sm.student_id
WHERE ti.test_id = 'b1000000-0000-4000-8000-000000000001';;
