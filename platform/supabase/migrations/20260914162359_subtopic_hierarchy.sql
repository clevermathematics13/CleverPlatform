-- ---------------------------------------------------------------------------
-- Finish the subtopic hierarchy, and enforce it
-- ---------------------------------------------------------------------------
-- `subtopics.parent_code` already existed and was already right for 21 of the
-- 33 sub-codes. Whoever populated it stopped at exactly the twelve whose
-- parent is not a row in this table -- 1.15, 2.5, 5.12, 5.15 and 5.17 are
-- referred to by their children and have never existed themselves. That was a
-- sensible place to stop, not an oversight; there was nothing to point at.
--
-- This creates those five, parents the twelve orphans, and turns parent_code
-- into a real foreign key so the next gap cannot be introduced silently.
--
-- Why this matters beyond tidiness: a question tagged `5.16 (parts)` and one
-- tagged `5.16.4` are both further integration, and until the hierarchy is
-- complete no rollup can say so. The codes themselves are deliberately left
-- alone -- "5.16 (parts)" reads better to a teacher than "5.16.3" ever will,
-- and re-coding would mean retagging thousands of question parts to buy
-- nothing the parent column does not already give.

-- ---------------------------------------------------------------------------
-- 1. The five topics the taxonomy refers to but never had
-- ---------------------------------------------------------------------------
-- `section` is taken from the children, which all already agree.
INSERT INTO subtopics (code, descriptor, section) VALUES
  ('1.15', 'Proof by induction, contradiction and counterexample', 1),
  ('2.5',  'Composite and inverse functions',                      2),
  ('5.12', 'Continuity, differentiability and first principles',   5),
  ('5.15', 'Derivatives and integrals of further functions',       5),
  ('5.17', 'Areas and volumes of revolution',                      5);

-- ---------------------------------------------------------------------------
-- 2. Parent the twelve orphans
-- ---------------------------------------------------------------------------
UPDATE subtopics SET parent_code = '1.15' WHERE code IN ('1.15 (con)', '1.15 (ind)');
UPDATE subtopics SET parent_code = '2.5'  WHERE code IN ('2.5.1', '2.5.2');
UPDATE subtopics SET parent_code = '5.12' WHERE code IN ('5.12 (FP)', '5.12 (high)', '5.12 (lim)');
UPDATE subtopics SET parent_code = '5.15' WHERE code IN ('5.15 (diff)', '5.15 (int)', '5.15.5');
UPDATE subtopics SET parent_code = '5.17' WHERE code IN ('5.17 (rs)', '5.17 (vol)');

-- ---------------------------------------------------------------------------
-- 3. Merge the one genuine duplicate
-- ---------------------------------------------------------------------------
-- `1.10 (com)` and `1.10.3` were both "Combinations" with two question parts
-- each, so four parts on one concept could never aggregate together. The
-- teacher chose `1.10 (com)`.
--
-- The retag runs BEFORE the delete on purpose. syllabus_coverage's foreign key
-- is ON DELETE CASCADE, so dropping the subtopic row first would silently take
-- the coverage row with it rather than move it -- and the course in question
-- already has its own `1.10 (com)` row marked covered, so the honest move is to
-- drop the now-redundant duplicate rather than try to merge two trues.
UPDATE question_parts
SET subtopic_codes = array_replace(subtopic_codes, '1.10.3', '1.10 (com)')
WHERE '1.10.3' = ANY(subtopic_codes);

DELETE FROM syllabus_coverage WHERE subtopic_code = '1.10.3';
DELETE FROM subtopics WHERE code = '1.10.3';

-- ---------------------------------------------------------------------------
-- 4. Make the hierarchy enforceable
-- ---------------------------------------------------------------------------
-- No foreign key existed on parent_code, so a typo or a deleted parent left a
-- dangling string. ON UPDATE CASCADE keeps children attached if a code is ever
-- renamed; ON DELETE SET NULL orphans a child rather than deleting real
-- curriculum content along with its heading.
ALTER TABLE subtopics
  ADD CONSTRAINT subtopics_parent_code_fkey
  FOREIGN KEY (parent_code) REFERENCES subtopics(code)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE subtopics
  ADD CONSTRAINT subtopics_parent_not_self
  CHECK (parent_code IS DISTINCT FROM code);

COMMENT ON COLUMN subtopics.parent_code IS
  'The topic this sub-code rolls up into, e.g. "5.16 (parts)" -> "5.16". Null for a topic-level code. The hierarchy lives here rather than in the shape of the code, because the codes use three spellings (5.11, 5.16.4, "5.16 (parts)") and all three are deliberate.';