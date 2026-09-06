-- Where a result's evidence_box came from.
--
-- The grading model reports its evidenceBox as fractions of a page it is
-- never told the dimensions of, and an audit of one 41-part paper found it
-- synthesises a plausible layout rather than measuring one: 22 of the 33
-- crops did not contain the work they were captioned as evidence for, every
-- one of them landing above it. Teachers can now redraw a region by hand
-- (POST .../ai-grade/results/[resultId]/evidence-box), and per-paper anchors
-- are the intended longer-term replacement for the model's guess.
--
-- Once a row's box can have three different origins with three different
-- degrees of trust, "where did this come from" has to be recorded rather
-- than inferred -- otherwise a corrected crop is indistinguishable from a
-- guessed one, and neither a teacher nor a later backfill can tell which
-- rows still need attention.
--
-- Deliberately no check constraint: 'anchor' is not written by any code yet,
-- and a constraint would mean a second migration to introduce it.
alter table public.ai_grade_results
  add column evidence_box_source text;

comment on column public.ai_grade_results.evidence_box_source is
  'Origin of evidence_box: ''model'' (located by the grading model, the historical default), ''teacher'' (redrawn by hand on the scanned page), or ''anchor'' (from a locked per-paper region -- not yet written by any code). Null for rows graded before this column existed and for rows with no evidence_box at all. No check constraint, so a new source can be added without a migration.';
