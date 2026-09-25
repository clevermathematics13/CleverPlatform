-- 27AH [K05] P2 (tests.id a0000000-0000-0000-0000-000000000002): replace the
-- parts and marks that legacy migrations-legacy/009_import_p2_marks.sql
-- copied from 27AH [P01] P1 with the paper that was sat -- 22M AA HL
-- Paper 2 TZ2, questions 6-12: 21 printed parts, 80 marks -- and give three
-- bank questions the parts that paper prints:
--   22M.2.AHL.TZ2.H_7   ''          -> (a) 2, (b) 6
--   22M.2.AHL.TZ2.H_9   ''          -> (a) 2, (b) 2
--   22M.2.AHL.TZ2.H_12  a, b, c7, e9 -> a 1, b 4, c 5, d 2, e 7, f 2
-- The typed question and mark-scheme LaTeX for these questions is written
-- separately, not here: it is IB copyright and this repository is public.
-- See docs/HANDOFF.md section 41, "[K05] P2 rebuilt".
--
-- One DO block, so it is all or nothing: every guard runs before the first
-- change, each change checks the rows it touched, and the post-checks
-- re-read the result. The hashes pin the rows as they were inspected on
-- 25 Sep 2026; if anything moved since, this raises and changes nothing.

do $$
declare
  k05     constant uuid := 'a0000000-0000-0000-0000-000000000002';
  p01     constant uuid := 'a0000000-0000-0000-0000-000000000001';
  teacher constant uuid := '702750f6-be43-47d2-a422-a2f15b4d0bf9';
  codes   constant text[] := array[
    '22M.2.AHL.TZ2.H_6', '22M.2.AHL.TZ2.H_7', '22M.2.AHL.TZ2.H_8', '22M.2.AHL.TZ2.H_9',
    '22M.2.AHL.TZ2.H_10', '22M.2.AHL.TZ2.H_11', '22M.2.AHL.TZ2.H_12'];
  q7  uuid;
  q9  uuid;
  q12 uuid;
  n   int;
  h   text;
begin
  ---- guards: the test ------------------------------------------------------
  perform 1 from tests where id = k05 and name = '27AH [K05] P2' and total_marks = 64 and hidden;
  if not found then
    raise exception 'K05 P2: the test row is not the hidden 64-mark test that was inspected';
  end if;

  select md5(string_agg(concat_ws('|', id, question_number, part_label, max_marks, ib_question_code, sort_order),
                        ',' order by sort_order))
    into h from test_items where test_id = k05;
  if h is distinct from '917b5124a8a80bebae279c3acca2f15c' then
    raise exception 'K05 P2: its 14 parts changed since inspection (md5 %)', h;
  end if;

  -- Its 182 marks are P01 P1's, cell for cell (student, position, question,
  -- label, maximum, mark), and unchanged since inspection.
  select count(*) into n
    from student_marks sm join test_items ti on ti.id = sm.test_item_id where ti.test_id = k05;
  if n <> 182 then raise exception 'K05 P2: expected 182 marks, found %', n; end if;
  select count(*) into n from (
    select sm.student_id, ti.sort_order, ti.question_number, ti.part_label, ti.max_marks, sm.marks_awarded
      from student_marks sm join test_items ti on ti.id = sm.test_item_id where ti.test_id = k05
    except
    select sm.student_id, ti.sort_order, ti.question_number, ti.part_label, ti.max_marks, sm.marks_awarded
      from student_marks sm join test_items ti on ti.id = sm.test_item_id where ti.test_id = p01
  ) not_a_copy;
  if n <> 0 then raise exception 'K05 P2: % of its marks are not copies of P01 P1 marks', n; end if;
  select md5(string_agg(concat_ws('|', sm.id, coalesce(sm.student_id::text, '-'),
                                  coalesce(sm.invited_student_id::text, '-'), sm.test_item_id, sm.marks_awarded),
                        ',' order by sm.id))
    into h from student_marks sm join test_items ti on ti.id = sm.test_item_id where ti.test_id = k05;
  if h is distinct from 'cc5b9e452a41aafc4e2eaf0d76dc7f7f' then
    raise exception 'K05 P2: its marks changed since inspection (md5 %)', h;
  end if;

  -- The only other rows on its parts: the teacher's own 14 test
  -- self-scores and one 0 -> 0 mark change.
  select count(*) into n
    from student_self_scores s join test_items ti on ti.id = s.test_item_id
   where ti.test_id = k05 and s.student_id = teacher;
  if n <> 14 or exists (select 1 from student_self_scores s join test_items ti on ti.id = s.test_item_id
                         where ti.test_id = k05 and s.student_id is distinct from teacher) then
    raise exception 'K05 P2: its self-scores are not the teacher''s 14 test rows';
  end if;
  select count(*) into n
    from mark_changes mc join test_items ti on ti.id = mc.test_item_id where ti.test_id = k05;
  if n <> 1 then raise exception 'K05 P2: expected 1 mark change, found %', n; end if;

  -- Nothing marked, laid out, exported or given boundaries yet.
  if exists (select 1 from ai_grade_results r join test_items ti on ti.id = r.test_item_id where ti.test_id = k05)
     or exists (select 1 from grader_feedback
                 where test_id = k05 or test_item_id in (select id from test_items where test_id = k05))
     or exists (select 1 from remark_requests r join test_items ti on ti.id = r.test_item_id where ti.test_id = k05)
     or exists (select 1 from ai_grade_runs where test_id = k05)
     or exists (select 1 from ai_grade_batches where test_id = k05)
     or exists (select 1 from ai_grade_message_batches where test_id = k05)
     or exists (select 1 from test_paper_layouts where test_id = k05)
     or exists (select 1 from powerschool_export_files where test_id = k05)
     or exists (select 1 from grade_boundary_sets where test_id = k05)
     or exists (select 1 from boundary_suggestions where test_id = k05)
     or exists (select 1 from test_boundary_decisions where test_id = k05)
     or exists (select 1 from correction_checks where test_id = k05)
     or exists (select 1 from pdf_uploads where test_id = k05)
     or exists (select 1 from test_absences where test_id = k05) then
    raise exception 'K05 P2: it already has marking, layout, export or boundary rows; not rebuilding';
  end if;
  if to_regclass('public.mark_scheme_explanations') is not null then
    execute 'select count(*) from public.mark_scheme_explanations where test_id = $1' into n using k05;
    if n <> 0 then raise exception 'K05 P2: it has % mark scheme explanations', n; end if;
  end if;

  ---- guards: the bank ------------------------------------------------------
  select id into q7  from ib_questions where code = '22M.2.AHL.TZ2.H_7';
  select id into q9  from ib_questions where code = '22M.2.AHL.TZ2.H_9';
  select id into q12 from ib_questions where code = '22M.2.AHL.TZ2.H_12';
  if q7 is null or q9 is null or q12 is null then
    raise exception 'bank: H_7, H_9 or H_12 is missing';
  end if;

  -- label:marks:sort of every part of the seven questions, as inspected
  select string_agg(code || '=' || parts, ';' order by code) into h from (
    select q.code,
           string_agg(p.part_label || ':' || p.marks || ':' || p.sort_order, ',' order by p.sort_order, p.part_label) parts
      from ib_questions q join question_parts p on p.question_id = q.id
     where q.code = any(codes)
     group by q.code) b;
  if h is distinct from
     '22M.2.AHL.TZ2.H_10=a:3:10,b:3:20,c:3:30,d:6:40;'
     || '22M.2.AHL.TZ2.H_11=a:2:10,b:2:20,c:4:30,d:7:40,e:5:50;'
     || '22M.2.AHL.TZ2.H_12=a:1:10,b:4:20,c:7:30,e:9:50;'
     || '22M.2.AHL.TZ2.H_6=:5:0;'
     || '22M.2.AHL.TZ2.H_7=:8:0;'
     || '22M.2.AHL.TZ2.H_8=:7:0;'
     || '22M.2.AHL.TZ2.H_9=:4:0' then
    raise exception 'bank: the parts of the seven questions are not as inspected: %', h;
  end if;

  if exists (select 1 from question_parts p join ib_questions q on q.id = p.question_id
              where q.code = any(codes) and nullif(btrim(p.markscheme_latex), '') is not null) then
    raise exception 'bank: a part already has mark-scheme LaTeX';
  end if;

  -- Nothing else points at these questions' parts, so relabelling and
  -- splitting them can only affect K05 P2.
  if exists (select 1 from test_items where ib_question_code = any(codes) and test_id <> k05)
     or exists (select 1 from saved_exams se, unnest(codes) c where position(c in se.questions::text) > 0)
     or exists (select 1 from practice_set_items where ib_question_code = any(codes))
     or exists (select 1 from question_part_metadata_history mh join ib_questions q on q.id = mh.question_id
                 where q.code = any(codes))
     or exists (select 1 from question_images i join ib_questions q on q.id = i.question_id
                 where q.code = any(codes) and i.part_id is not null)
     or exists (select 1 from graph_image_crops g join ib_questions q on q.id = g.question_id
                 where q.code = any(codes))
     or exists (select 1 from graph_extraction_queue g join ib_questions q on q.id = g.question_id
                 where q.code = any(codes) and g.part_id is not null)
     or exists (select 1 from graph_crop_choice_associations a
                  join question_parts p on p.id = a.part_id
                  join ib_questions q on q.id = p.question_id
                 where q.code = any(codes)) then
    raise exception 'bank: something else references these questions; not restructuring';
  end if;

  ---- bank: the parts the paper prints ---------------------------------------
  update question_parts set part_label = 'a', marks = 2, sort_order = 10
   where id = 'f42334f5-9c5f-417d-bf83-91d21feaaf2c' and question_id = q7 and part_label = '' and marks = 8;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'bank: H_7 relabel touched % rows', n; end if;
  insert into question_parts (question_id, part_label, marks, sort_order, subtopic_codes)
  values (q7, 'b', 6, 20, array['5.13']);

  update question_parts set part_label = 'a', marks = 2, sort_order = 10
   where id = '4f6093f2-623a-4cd6-bb5b-be0d0a356fe9' and question_id = q9 and part_label = '' and marks = 4;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'bank: H_9 relabel touched % rows', n; end if;
  insert into question_parts (question_id, part_label, marks, sort_order, subtopic_codes)
  values (q9, 'b', 2, 20, array['1.10']);

  update question_parts set marks = 5
   where id = '40b41a3c-82c0-41b2-bd5e-985e30a7e6e1' and question_id = q12 and part_label = 'c' and marks = 7;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'bank: H_12 (c) touched % rows', n; end if;
  update question_parts set marks = 7
   where id = 'e5a0c482-7f54-4819-8445-101530ce64e9' and question_id = q12 and part_label = 'e' and marks = 9;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'bank: H_12 (e) touched % rows', n; end if;
  insert into question_parts (question_id, part_label, marks, sort_order, subtopic_codes)
  values (q12, 'd', 2, 40, array['5.8']),
         (q12, 'f', 2, 60, array['5.18 (sep)']);

  ---- test: remove the copied parts and marks ----------------------------------
  delete from student_self_scores where test_item_id in (select id from test_items where test_id = k05);
  get diagnostics n = row_count;
  if n <> 14 then raise exception 'test: deleted % self-scores, expected 14', n; end if;
  delete from mark_changes where test_item_id in (select id from test_items where test_id = k05);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'test: deleted % mark changes, expected 1', n; end if;
  delete from student_marks where test_item_id in (select id from test_items where test_id = k05);
  get diagnostics n = row_count;
  if n <> 182 then raise exception 'test: deleted % marks, expected 182', n; end if;
  delete from test_items where test_id = k05;
  get diagnostics n = row_count;
  if n <> 14 then raise exception 'test: deleted % parts, expected 14', n; end if;

  ---- test: the 21 printed parts -------------------------------------------------
  -- Joined to the bank on label AND marks, so a part whose bank marks differ
  -- from the printed tariff is simply not inserted and the count check raises.
  insert into test_items (test_id, question_number, ib_question_code, part_label, max_marks,
                          subtopic_codes, google_doc_id, google_ms_id, sort_order, source)
  select k05, v.qn, v.code, v.label, p.marks, p.subtopic_codes, q.google_doc_id, q.google_ms_id, v.sort, 'bank'
    from (values
      (1, '22M.2.AHL.TZ2.H_6',  '',  5,  0),
      (2, '22M.2.AHL.TZ2.H_7',  'a', 2,  1),
      (2, '22M.2.AHL.TZ2.H_7',  'b', 6,  2),
      (3, '22M.2.AHL.TZ2.H_8',  '',  7,  3),
      (4, '22M.2.AHL.TZ2.H_9',  'a', 2,  4),
      (4, '22M.2.AHL.TZ2.H_9',  'b', 2,  5),
      (5, '22M.2.AHL.TZ2.H_10', 'a', 3,  6),
      (5, '22M.2.AHL.TZ2.H_10', 'b', 3,  7),
      (5, '22M.2.AHL.TZ2.H_10', 'c', 3,  8),
      (5, '22M.2.AHL.TZ2.H_10', 'd', 6,  9),
      (6, '22M.2.AHL.TZ2.H_11', 'a', 2, 10),
      (6, '22M.2.AHL.TZ2.H_11', 'b', 2, 11),
      (6, '22M.2.AHL.TZ2.H_11', 'c', 4, 12),
      (6, '22M.2.AHL.TZ2.H_11', 'd', 7, 13),
      (6, '22M.2.AHL.TZ2.H_11', 'e', 5, 14),
      (7, '22M.2.AHL.TZ2.H_12', 'a', 1, 15),
      (7, '22M.2.AHL.TZ2.H_12', 'b', 4, 16),
      (7, '22M.2.AHL.TZ2.H_12', 'c', 5, 17),
      (7, '22M.2.AHL.TZ2.H_12', 'd', 2, 18),
      (7, '22M.2.AHL.TZ2.H_12', 'e', 7, 19),
      (7, '22M.2.AHL.TZ2.H_12', 'f', 2, 20)
    ) as v(qn, code, label, marks, sort)
    join ib_questions q on q.code = v.code
    join question_parts p on p.question_id = q.id and p.part_label = v.label and p.marks = v.marks;
  get diagnostics n = row_count;
  if n <> 21 then raise exception 'test: inserted % parts, expected 21', n; end if;

  update tests set total_marks = 80 where id = k05 and total_marks = 64;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'test: total_marks update touched % rows', n; end if;

  ---- post-checks ----------------------------------------------------------------
  select string_agg(question_number || ':' || s, ',' order by question_number) into h from (
    select question_number, sum(max_marks) s from test_items where test_id = k05 group by question_number) t;
  if h is distinct from '1:5,2:8,3:7,4:4,5:15,6:20,7:21' then
    raise exception 'post: per-question totals are %', h;
  end if;
  select count(*) into n from test_items where test_id = k05;
  if n <> 21 then raise exception 'post: % parts on the test', n; end if;
  if (select sum(max_marks) from test_items where test_id = k05) <> 80
     or (select total_marks from tests where id = k05) <> 80 then
    raise exception 'post: the test does not total 80';
  end if;
  if exists (select 1 from student_marks sm join test_items ti on ti.id = sm.test_item_id where ti.test_id = k05) then
    raise exception 'post: marks remain on the test';
  end if;

  -- The split leaves each bank question's total unchanged.
  select string_agg(code || '=' || total, ',' order by code) into h from (
    select q.code, sum(p.marks) total
      from ib_questions q join question_parts p on p.question_id = q.id
     where q.code = any(codes) group by q.code) b;
  if h is distinct from
     '22M.2.AHL.TZ2.H_10=15,22M.2.AHL.TZ2.H_11=20,22M.2.AHL.TZ2.H_12=21,22M.2.AHL.TZ2.H_6=5,'
     || '22M.2.AHL.TZ2.H_7=8,22M.2.AHL.TZ2.H_8=7,22M.2.AHL.TZ2.H_9=4' then
    raise exception 'post: bank question totals are %', h;
  end if;

  -- P01 P1, whose marks these were, is untouched.
  select md5(string_agg(concat_ws('|', id, question_number, part_label, max_marks, ib_question_code, sort_order),
                        ',' order by sort_order))
    into h from test_items where test_id = p01;
  if h is distinct from 'd1f7ed6f5c54db360b283e7c31ba4273' then raise exception 'post: P01 P1 parts changed'; end if;
  select md5(string_agg(concat_ws('|', sm.id, coalesce(sm.student_id::text, '-'),
                                  coalesce(sm.invited_student_id::text, '-'), sm.test_item_id, sm.marks_awarded),
                        ',' order by sm.id))
    into h from student_marks sm join test_items ti on ti.id = sm.test_item_id where ti.test_id = p01;
  if h is distinct from '874350f210e29c9d6e708e0bb48ab8e6' then raise exception 'post: P01 P1 marks changed'; end if;
end $$;
