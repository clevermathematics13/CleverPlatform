-- 27AH [K06] P1: give 17M.1.AHL.TZ1.H_5 the two parts its paper prints.
--
-- K06 P1 (63b97886-04e3-4094-b92e-8e1358286f87) marks Q6 as (a) 3 and
-- (b) 4 -- legacy 051 split the gradebook's Q6 that way -- and the question
-- prints (a) [3] and (b) [4]. The bank still stored 17M.1.AHL.TZ1.H_5 as one
-- '' part of 7 marks, so neither item matched a part: Mark Scans flagged
-- both and AI marking would skip them. This relabels that part as (a) with
-- 3 marks, adds (b) with 4, and retags K06's item 6b from 3.16 Vector
-- product to 3.13 Scalar product, as the teacher asked: (b) is the
-- scalar-product part. Ids, labels, marks and subtopics only; the LaTeX is
-- written separately (IB text stays out of this public repo). No marks,
-- self-scores or mark changes are touched.
--
-- Every guard is what was inspected on 26 Sep 2026; any difference raises.
do $$
declare
  k06 constant uuid := '63b97886-04e3-4094-b92e-8e1358286f87';
  q uuid;
  n int;
  h text;
begin
  ---- guards ---------------------------------------------------------------
  select md5(string_agg(ti.id::text || ti.part_label || ti.max_marks || array_to_string(ti.subtopic_codes, ','),
                        ';' order by ti.sort_order))
    into h from test_items ti where ti.test_id = k06;
  if h is distinct from '1567988753918ba551d5b740a248574a' then
    raise exception 'K06 P1: items are not as inspected (%)', h;
  end if;

  select id into q from ib_questions where code = '17M.1.AHL.TZ1.H_5';
  if q is null then
    raise exception '17M.1.AHL.TZ1.H_5 is missing';
  end if;
  select string_agg(p.id || ':' || p.part_label || ':' || p.marks || ':' || p.sort_order || ':'
                    || array_to_string(p.subtopic_codes, ','), ',')
    into h from question_parts p where p.question_id = q;
  if h is distinct from '5a329c40-840f-4e29-a6f4-e49628ed0526::7:0:3.16' then
    raise exception '17M.1.AHL.TZ1.H_5: parts are not as inspected (%)', h;
  end if;
  if exists (select 1 from question_parts where question_id = q
               and (nullif(btrim(content_latex), '') is not null or nullif(btrim(markscheme_latex), '') is not null)) then
    raise exception '17M.1.AHL.TZ1.H_5: the part already has LaTeX';
  end if;

  -- Nothing else depends on the part being ''. The one ExamBuilder draft
  -- that lists the question ("27AH [K06] P1", 20 May) keeps its snapshot of
  -- the question as it was built; it is not repointed.
  if exists (select 1 from test_items where ib_question_code = '17M.1.AHL.TZ1.H_5' and test_id <> k06)
     or (select count(*) from test_items where ib_question_code = '17M.1.AHL.TZ1.H_5' and test_id = k06) <> 2
     or (select count(*) from saved_exams where position('17M.1.AHL.TZ1.H_5' in questions::text) > 0) <> 1
     or exists (select 1 from practice_set_items where ib_question_code = '17M.1.AHL.TZ1.H_5')
     or exists (select 1 from question_part_metadata_history where question_id = q)
     or exists (select 1 from question_images where question_id = q and part_id is not null)
     or exists (select 1 from graph_image_crops where question_id = q)
     or exists (select 1 from graph_extraction_queue where question_id = q and part_id is not null)
     or exists (select 1 from graph_crop_choice_associations a
                  join question_parts p on p.id = a.part_id
                 where p.question_id = q) then
    raise exception '17M.1.AHL.TZ1.H_5: references are not as inspected; not restructuring';
  end if;

  ---- bank: the parts the paper prints --------------------------------------
  update question_parts set part_label = 'a', marks = 3, sort_order = 10
   where id = '5a329c40-840f-4e29-a6f4-e49628ed0526' and question_id = q and part_label = '' and marks = 7;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '17M.1.AHL.TZ1.H_5 (a): relabel touched % rows', n;
  end if;
  insert into question_parts (question_id, part_label, marks, sort_order, subtopic_codes)
  values (q, 'b', 4, 20, array['3.13']);

  ---- test: 6b is the scalar-product part -----------------------------------
  update test_items set subtopic_codes = array['3.13']
   where test_id = k06 and question_number = 6 and part_label = 'b' and max_marks = 4
     and subtopic_codes = array['3.16'];
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'K06 P1 6b: retag touched % rows', n;
  end if;

  ---- after ----------------------------------------------------------------
  select string_agg(p.part_label || ':' || p.marks || ':' || array_to_string(p.subtopic_codes, ','), ','
                    order by p.sort_order)
    into h from question_parts p where p.question_id = q;
  if h is distinct from 'a:3:3.16,b:4:3.13' then
    raise exception '17M.1.AHL.TZ1.H_5: parts are now %', h;
  end if;
  select md5(string_agg(ti.id::text || ti.part_label || ti.max_marks || array_to_string(ti.subtopic_codes, ','),
                        ';' order by ti.sort_order))
    into h from test_items ti where ti.test_id = k06;
  if h is distinct from '4b0d8c55e27c5240d743b36ef51e4f89' then
    raise exception 'K06 P1: items are now % (only 6b''s tag should have changed)', h;
  end if;
end $$;
