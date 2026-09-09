-- Records A.2's "question, as printed" crops -- one per anchor, not per
-- student, since the printed content is identical for everyone. These are
-- what the review UI's "why this mark" panel shows between the plain-text
-- question and the student's own answer crop, so a teacher can see whether
-- an anchor box starts right under its prompt or well below it.
--
-- Each crop is the strip between the bottom of the previous printed element
-- on the page and the anchor's own top edge, across the content column
-- (x 50.83-544.50), rendered at 300 DPI from the master PDF recorded above.
-- Two refinements over the A.1 backfill, both from checking the output by
-- eye: the narrow inset boxes (the broken-math quote, the "a frame you may
-- use" scaffold) do NOT act as separators, because they are printed parts of
-- the question -- treating them as separators cost Q21 its prompt entirely
-- and cut the quote out of Q5's and Q17's; and the anchors themselves do act
-- as separators, which matters for Q20, whose crop otherwise opened with the
-- five empty rows of Q19's ruled table.
--
-- The 10 anchors excluded here are sub-part boxes whose prompt is printed in
-- the shared block above their question's FIRST box (already captured by that
-- anchor's crop), leaving a gap under the 25pt floor. A.1 skipped 9 of 40 for
-- the same reason. Every remaining anchor gets a real crop: 22 of 32.
update na_anchors
set prompt_crop_storage_path =
      'na-crops/2f8a4c31-6b7e-4d92-a1f5-8c3e07b9d240/prompts/' || id || '.png'
where packet_version_id = '2f8a4c31-6b7e-4d92-a1f5-8c3e07b9d240'
  and qid not in ('Q1(e)', 'Q3(b)', 'Q5(b)', 'Q13(b)', 'Q14(b)', 'Q14(c)',
                  'Q14(d)', 'Q17(b)', 'Q18(b)', 'Q18(c)');
