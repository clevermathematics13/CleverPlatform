
-- Corrects the five confirmed mis-splits where a base anchor's marks
-- still carried the whole question's total instead of its own share
-- after sub-parts were pulled out. Verified individually against the
-- authoritative parts[] content before applying (Q7 in particular was
-- checked in detail: (a) list-eight-factors vs (b) determine-and-justify
-- the divisor count -- the 2/4 split is correct, not suspicious).
-- Q26 is excluded: it's a different problem (a missing anchor, not a
-- wrong number) and is handled separately.
--
-- na_rubric_items.marks is corrected in the same statement set so the
-- rubric (source of truth) and na_anchors (grading input) can't drift
-- back out of sync with each other.

update na_anchors set marks_available = 3
where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q1';
update na_rubric_items set marks = 3
where nuanced_analysis_id = 'aabd94f4-aa08-405e-bccb-5003d31696cb' and qid = 'Q1';

update na_anchors set marks_available = 5
where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q6';
update na_rubric_items set marks = 5
where nuanced_analysis_id = 'aabd94f4-aa08-405e-bccb-5003d31696cb' and qid = 'Q6';

update na_anchors set marks_available = 2
where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q7';
update na_rubric_items set marks = 2
where nuanced_analysis_id = 'aabd94f4-aa08-405e-bccb-5003d31696cb' and qid = 'Q7';

update na_anchors set marks_available = 2
where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q13';
update na_rubric_items set marks = 2
where nuanced_analysis_id = 'aabd94f4-aa08-405e-bccb-5003d31696cb' and qid = 'Q13';

update na_anchors set marks_available = 2
where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q19';
update na_rubric_items set marks = 2
where nuanced_analysis_id = 'aabd94f4-aa08-405e-bccb-5003d31696cb' and qid = 'Q19';
;
