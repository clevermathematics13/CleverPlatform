-- Q3's six marks now divide 3/3 across its two answer boxes, not 2/4.
--
-- A teacher's call, not a correction of a mistake. parts[] records one total
-- per question and no per-sub-part breakdown, so the original split was read
-- off the printed sub-parts and their answer keys: (a) rewrites "5 fewer than
-- p" using the formal definition, (b) explains why the definition makes the
-- reversal impossible. That reading weighted the explanation more heavily.
-- The teacher's is that the two halves are worth the same.
--
-- Safe to change in place: A.2 has no scans and no crops yet, so no student
-- has been marked against the old split and there is nothing downstream to
-- re-grade. Doing this after the first upload would also mean re-running
-- stage 5 for every affected crop.
--
-- Both tables carry the number and both are updated. na_anchors is what
-- stage 5 actually reads per crop (see HANDOFF ss5); na_rubric_items is the
-- editable rubric the review UI shows. Leaving them to disagree would give a
-- teacher one number on screen and the model another.
update na_anchors
set marks_available = 3
where packet_version_id = '2f8a4c31-6b7e-4d92-a1f5-8c3e07b9d240'
  and qid in ('Q3', 'Q3(b)');

update na_rubric_items
set marks = 3
where nuanced_analysis_id = '41e8ca4e-087d-4146-b364-19139d659343'
  and qid in ('Q3', 'Q3(b)');
