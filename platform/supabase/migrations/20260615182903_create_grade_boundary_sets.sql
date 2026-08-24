
-- ── Grade Boundary Sets ───────────────────────────────────────────────────────

CREATE TABLE grade_boundary_sets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,          -- 'A', 'B', 'C', 'D'
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grade_boundaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          uuid NOT NULL REFERENCES grade_boundary_sets(id) ON DELETE CASCADE,
  grade           integer NOT NULL CHECK (grade BETWEEN 1 AND 7),
  min_proportion  numeric(5,4) NOT NULL,     -- e.g. 0.5800 = 58%
  UNIQUE (set_id, grade)
);

-- ── Add boundary_set_id to tests ─────────────────────────────────────────────

ALTER TABLE tests
  ADD COLUMN boundary_set_id uuid REFERENCES grade_boundary_sets(id) ON DELETE SET NULL;

-- ── Seed Sets A–D ─────────────────────────────────────────────────────────────
-- Values from legacy Google Sheets "grade boundaries" tab (proportions)
-- Set A: most lenient (early course / low syllabus coverage)
-- Set D: most demanding (approaching IB exams / full syllabus)

WITH sets AS (
  INSERT INTO grade_boundary_sets (name, description) VALUES
    ('A', 'Early course — low syllabus coverage, most lenient boundaries'),
    ('B', 'Mid-early course — progressing toward IB difficulty'),
    ('C', 'Mid-late course — approaching full syllabus coverage'),
    ('D', 'Late course — full syllabus, closest to official IB boundaries')
  RETURNING id, name
)
INSERT INTO grade_boundaries (set_id, grade, min_proportion)
SELECT s.id, v.grade, v.min_proportion
FROM sets s
JOIN (VALUES
  ('A', 1, 0.0100),
  ('A', 2, 0.1700),
  ('A', 3, 0.3100),
  ('A', 4, 0.4500),
  ('A', 5, 0.5800),
  ('A', 6, 0.6800),
  ('A', 7, 0.8200),

  ('B', 1, 0.0100),
  ('B', 2, 0.1600),
  ('B', 3, 0.3000),
  ('B', 4, 0.4300),
  ('B', 5, 0.5700),
  ('B', 6, 0.6700),
  ('B', 7, 0.8100),

  ('C', 1, 0.0100),
  ('C', 2, 0.1500),
  ('C', 3, 0.2800),
  ('C', 4, 0.4100),
  ('C', 5, 0.5400),
  ('C', 6, 0.6600),
  ('C', 7, 0.7900),

  ('D', 1, 0.0100),
  ('D', 2, 0.1300),
  ('D', 3, 0.2600),
  ('D', 4, 0.3800),
  ('D', 5, 0.5100),
  ('D', 6, 0.6400),
  ('D', 7, 0.7600)
) AS v(set_name, grade, min_proportion) ON s.name = v.set_name;
;
