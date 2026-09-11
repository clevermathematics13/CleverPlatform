-- ---------------------------------------------------------------------------
-- Correct the question_image_paths comment: the check is per directory
-- ---------------------------------------------------------------------------
-- The column comment written in 20260911142859 said the service intersects
-- these paths with the question_images rows of image_type 'question'. That
-- was true then and is no longer: three of the 27AH set's questions carry a
-- printed answer box a page deep, dead space on a screen the student is meant
-- to read from, so the set now points at trimmed derivatives stored beside the
-- originals under <code>/question/. Those deliberately have no question_images
-- row -- that is what keeps them out of the teacher's bank UI and out of
-- printed papers, where the answer box belongs -- so an exact-row check would
-- have thrown them away.
--
-- The check is therefore on the directory: a curated path is served when it
-- sits in the same directory as one of the code's real question images. That
-- still closes the leak it exists for. Every path it compares against is a
-- question image, so the only directory it can ever admit is
-- <code>/question; a mark scheme lives in <code>/markscheme, and the bank's
-- loose past-paper imports sit under prefixes of their own.
--
-- Comment only. No data or structure changes.

COMMENT ON COLUMN practice_set_items.question_image_paths IS
  'Storage paths of the images that are actually this question, in reading order, verified when the set was built. May point at a trimmed derivative stored beside the bank''s own images under <code>/question/ (no question_images row, so it stays out of the bank UI and printed papers). Empty means every question image for the code. Not a security boundary -- lib/practice-sets.ts admits a path only when its directory matches one of the code''s question images, and the storage policy independently allows a student only objects whose second path segment is "question".';