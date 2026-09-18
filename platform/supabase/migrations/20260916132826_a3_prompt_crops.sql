-- A.3's printed-prompt crops, 32 of 32. Rendered from the master at 300 DPI by
-- scripts/na_prompt_crops.py and uploaded to
-- na-crops/997390bb-c0ab-43fe-a123-cfe5f3d80fbe/prompts/<anchor id>.png.
--
-- NONE WERE SKIPPED, which is new. A.1 skipped 9 of 40 and A.2 10 of 32: those
-- are sub-part boxes whose prompt is printed in the shared block above their
-- question's first box, so their own gap falls under MIN_GAP_PT and a crop
-- would be a near-empty sliver. A.3 prints exactly one box per question and has
-- no sub-part boxes at all, so every anchor has a real prompt above it. That
-- also turned up a latent bug in the generator: with an empty skip list it
-- emitted "and qid not in ()", which is a syntax error. The clause is now
-- omitted when nothing is skipped; A.2 regenerates unchanged.
update na_anchors
set prompt_crop_storage_path =
      'na-crops/997390bb-c0ab-43fe-a123-cfe5f3d80fbe/prompts/' || id || '.png'
where packet_version_id = '997390bb-c0ab-43fe-a123-cfe5f3d80fbe';