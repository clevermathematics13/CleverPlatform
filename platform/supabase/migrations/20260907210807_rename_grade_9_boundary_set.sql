-- ---------------------------------------------------------------------------
-- Rename the FA1 boundary set to 'Grade 9', and drop the unused band table
-- ---------------------------------------------------------------------------
-- 'FA1 - strict' was scoped to a single test, but the 1-7 Level is the standing
-- achievement scale for the whole Grade 9 course: FA1 hangs off 9G and is sat by
-- the entire track (see lib/exam-service.ts and the student_track_family_test_access
-- migration), and later Grade 9 papers want these same boundaries. Naming the set
-- for the course means the next test can simply be assigned it rather than minting
-- a second one-off. A test left unassigned falls back to pctToGradeFallback() and
-- the Level column renders a '~approx' badge.
--
-- Grade 9 is a course of the teacher's own design that borrows the 1-7 scale so
-- students meet it before DP. It is NOT an IB course, so this set does not belong
-- in the A-D progression, which is DP-only (a 7 at 76-82%). Values are unchanged:
-- 90/80/70/60/50/40, so a 7 still needs 45/50.
--
-- Second change: the Criterion-A-style achievementBands table has been removed
-- from the Formative Assessment format in code -- draft type, Zod schemas,
-- generator prompt, sandbox editor, mark-scheme HTML and CSS. Nothing ever
-- computed a band from it and it was not used. This strips the dead key from the
-- one stored draft that carried one, so custom_content matches the shape the code
-- now reads. Zod drops unknown keys anyway, so this is tidy-up, not a fix. The
-- reteachGuide beside it stays.

UPDATE grade_boundary_sets
SET name = 'Grade 9',
    description = 'Grade 9 course scale - a 7 needs 90%. Not an IB course; unrelated to sets A-D.'
WHERE name = 'FA1 - strict';

UPDATE tests
SET custom_content = custom_content - 'achievementBands'
WHERE jsonb_exists(custom_content, 'achievementBands');
