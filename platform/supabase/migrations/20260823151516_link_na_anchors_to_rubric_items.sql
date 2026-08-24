
-- Links each physical answer box (anchor, geometry) to its rubric entry
-- (content). Keeping these as separate tables joined by FK -- rather than
-- copying rubric text onto every anchor -- means editing the rubric in
-- one place changes what grading uses, with no stale copies.
alter table na_anchors
  add column if not exists rubric_item_id uuid references na_rubric_items(id) on delete set null;

create index if not exists na_anchors_rubric_item_idx on na_anchors (rubric_item_id);

comment on column na_anchors.rubric_item_id is
  'The rubric entry for this answer box. na_anchors owns geometry (where the box is); na_rubric_items owns content (what was asked, what earns marks).';

update na_anchors a
set rubric_item_id = ri.id
from na_rubric_items ri
where a.packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff'
  and ri.nuanced_analysis_id = 'aabd94f4-aa08-405e-bccb-5003d31696cb'
  and ri.qid = a.qid;
;
