-- ---------------------------------------------------------------------------
-- Formative Assessment 1: strict grade boundaries
-- ---------------------------------------------------------------------------
-- FA1 (f5221cd9-66b1-48cd-bfe3-652d87df26b2, 50 marks) had boundary_set_id
-- NULL, so lib/grade-bands.ts fell through to pctToGradeFallback() -- the
-- generic 80/70/60/50/40/30 bands -- and both the gradebook grid and the
-- Exam Reflection dashboard flagged the Level column '~approx'. On this
-- class that put 33 of 50 students at Level 6 or 7.
--
-- This set is deliberately stricter than sets A-D: a 7 needs 90% (45/50)
-- where set D, the most demanding of the four, asks 76%. It is a formative
-- paper marked to a higher bar, not an IB-boundary estimate, so it is scoped
-- to this one test rather than added to the A-D progression.
--
-- Grade 1 sits at 0.0100 to match the shape of sets A-D; pctToGradeWithBoundaries()
-- returns 1 as its floor anyway, so the row is for consistency, not behaviour.

WITH s AS (
  INSERT INTO grade_boundary_sets (name, description) VALUES
    ('FA1 - strict', 'Formative Assessment 1 - strict boundaries: a 7 needs 90% (45/50)')
  RETURNING id
)
INSERT INTO grade_boundaries (set_id, grade, min_proportion)
SELECT s.id, v.grade, v.min_proportion
FROM s
JOIN (VALUES
  (1, 0.0100),
  (2, 0.4000),
  (3, 0.5000),
  (4, 0.6000),
  (5, 0.7000),
  (6, 0.8000),
  (7, 0.9000)
) AS v(grade, min_proportion) ON true;

UPDATE tests
SET boundary_set_id = (SELECT id FROM grade_boundary_sets WHERE name = 'FA1 - strict')
WHERE id = 'f5221cd9-66b1-48cd-bfe3-652d87df26b2';
