-- ---------------------------------------------------------------------------
-- Which images actually ARE the question
-- ---------------------------------------------------------------------------
-- "Show every question_images row for this code" is not good enough to put in
-- front of a student. The per-code question folders in the bank are not clean:
--
--   * One boilerplate image ("Expand (3 - x)^4 in ascending powers of x") is
--     sitting in 21 different questions' folders, left behind by whatever
--     imported them. A student would be shown a binomial expansion in the
--     middle of an integration set.
--   * Several folders carry a page of blank answer lines as a separate image
--     (20N.2.AHL.TZ0.H_3/question/01.png is nothing else), which renders as a
--     tall empty box above the real question.
--   * The real question is often not image 01 -- it is 04 as often as not.
--
-- None of that matters in the teacher bank, where a human is scanning a page
-- of thumbnails. It matters entirely on a page students are told to work
-- from. So the set records which images it means, verified by eye when the
-- set was built, in reading order.
--
-- Empty array means "every question image for this code", which is the right
-- default for a code whose folder is clean.
--
-- This is a curation aid, NOT a security boundary. lib/practice-sets.ts
-- intersects these paths with the question_images rows of image_type
-- 'question' before signing anything, so a mark scheme path typed in here
-- still cannot be served. The boundary is that intersection plus the RLS in
-- 20260911142419.

ALTER TABLE practice_set_items
  ADD COLUMN question_image_paths text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN practice_set_items.question_image_paths IS
  'Storage paths of the images that are actually this question, in reading order, verified when the set was built. Empty means every question image for the code. Not a security boundary -- the service intersects these with image_type=''question'' rows before signing.';