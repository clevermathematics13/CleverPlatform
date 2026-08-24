do $mig$
declare
  v_pv uuid := '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff';
  v_na uuid := 'aabd94f4-aa08-405e-bccb-5003d31696cb';
  v_rubric uuid;
  v_qtext text;
  v_sketch text;
  v_ans_a text := $q$(a) Ten discrete points satisfying 2a + c = 19 with a and c non-negative integers: (0,19), (1,17), (2,15), (3,13), (4,11), (5,9), (6,7), (7,5), (8,3), (9,1). Plotted as separate points only -- no connecting line, since only whole tickets can be bought.$q$;
begin
  if exists (select 1 from na_anchors where packet_version_id = v_pv and qid = 'Q26(a)') then
    raise exception 'Q26(a) anchor already exists -- aborting';
  end if;

  select question_text, answer_sketch into v_qtext, v_sketch
    from na_anchors where packet_version_id = v_pv and qid = 'Q26(b)';

  update na_anchors set sort_order = sort_order + 1
   where packet_version_id = v_pv and sort_order >= 33;

  insert into na_rubric_items
    (nuanced_analysis_id, qid, base_qid, question_number, question_text,
     answer_key, command_term, marks, question_marks, source)
  values
    (v_na, 'Q26(a)', 'Q26', 27, v_qtext, v_ans_a,
     'Plot / Describe / Explain', 2, 5, 'manual')
  returning id into v_rubric;

  insert into na_anchors
    (packet_version_id, qid, base_qid, page_index,
     x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt,
     command_term, marks_available, answer_sketch, source, sort_order,
     question_text, question_marks, question_answer, rubric_item_id)
  values
    (v_pv, 'Q26(a)', 'Q26', 21,
     50.83, 168.00, 544.50, 530.00, 580.28, 542.00,
     'Plot / Describe / Explain', 2, v_sketch, 'manual_grid', 33,
     v_qtext, 5, v_ans_a, v_rubric);
end
$mig$;
