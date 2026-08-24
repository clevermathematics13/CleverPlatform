-- 003: IB question bank — subtopics, questions, question parts

-- ============================================
-- 1. SUBTOPICS reference table
-- ============================================
CREATE TABLE IF NOT EXISTS public.subtopics (
  code TEXT PRIMARY KEY,
  descriptor TEXT NOT NULL,
  section INT NOT NULL,
  alt_code TEXT,
  parent_code TEXT
);

ALTER TABLE public.subtopics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can view subtopics" ON public.subtopics;
CREATE POLICY "Everyone can view subtopics" ON public.subtopics FOR SELECT USING (true);
DROP POLICY IF EXISTS "Teachers can manage subtopics" ON public.subtopics;
CREATE POLICY "Teachers can manage subtopics" ON public.subtopics FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'));

-- Seed subtopics
INSERT INTO public.subtopics (code, descriptor, section, alt_code, parent_code) VALUES
-- Section 1: Number & Algebra
('1.1',          'Scientific notation',                                    1, NULL, NULL),
('1.2',          'Arithmetic sequences and series',                        1, NULL, NULL),
('1.3',          'Geometric sequences and series',                         1, NULL, NULL),
('1.4',          'Financial applications',                                 1, NULL, NULL),
('1.5',          'Exponents and logarithms',                               1, NULL, NULL),
('1.6',          'Deductive Proof',                                        1, NULL, NULL),
('1.7',          'Further exponents and logarithms',                       1, NULL, NULL),
('1.7.4',        'Change of base of a logarithm',                         1, NULL, '1.7'),
('1.7.5',        'Solving exponential equations',                          1, NULL, '1.7'),
('1.8',          'Sum of infinite geometric sequences',                    1, NULL, NULL),
('1.9',          'The binomial theorem',                                   1, NULL, NULL),
('1.9.1',        'Pascal''s triangle',                                     1, NULL, '1.9'),
('1.10',         'Counting principles and the generalised binomial theorem',1, NULL, NULL),
('1.10 (com)',   'Combinations',                                           1, NULL, '1.10'),
('1.10.3',       'Combinations',                                           1, NULL, '1.10'),
('1.10.4',       'Generalization of the binomial theorem',                 1, NULL, '1.10'),
('1.11',         'Partial fractions',                                      1, NULL, NULL),
('1.12',         'Introduction to complex numbers',                        1, NULL, NULL),
('1.13',         'Complex numbers in polar and Euler forms',               1, NULL, NULL),
('1.14',         'Powers and roots of complex numbers',                    1, NULL, NULL),
('1.15 (con)',   'Proof by contradiction',                                 1, NULL, NULL),
('1.15 (ind)',   'Proof by induction',                                     1, NULL, NULL),
('1.16',         'Systems of linear equations',                            1, NULL, NULL),
-- Section 2: Functions
('2.1',          'Straight lines',                                         2, NULL, NULL),
('2.2',          'Functions',                                              2, NULL, NULL),
('2.3',          'Graphs of functions',                                    2, NULL, NULL),
('2.4',          'Key features of graphs',                                 2, NULL, NULL),
('2.5.1',        'Composite functions',                                    2, NULL, NULL),
('2.5.2',        'Inverse functions',                                      2, NULL, NULL),
('2.6',          'Quadratic functions',                                    2, NULL, NULL),
('2.7',          'Quadratic equations and quadratic inequalities',         2, NULL, NULL),
('2.8',          'Rational functions',                                     2, NULL, NULL),
('2.9',          'Exponential functions',                                  2, NULL, NULL),
('2.10',         'Solving equations',                                      2, NULL, NULL),
('2.11',         'Transformations of graphs',                              2, NULL, NULL),
('2.12',         'Polynomial functions',                                   2, NULL, NULL),
('2.13',         'Further rational functions',                             2, NULL, NULL),
('2.14',         'Odd and even functions',                                 2, NULL, NULL),
('2.15',         'Solving inequalities',                                   2, NULL, NULL),
('2.16',         'Further graph transformations',                          2, NULL, NULL),
-- Section 3: Geometry & Trigonometry
('3.1',          '3D space',                                               3, NULL, NULL),
('3.2',          'Triangle trigonometry',                                   3, NULL, NULL),
('3.3',          'Applications of trigonometry',                           3, NULL, NULL),
('3.4',          'The circle',                                             3, NULL, NULL),
('3.5',          'Trig ratios beyond acute angles',                        3, NULL, NULL),
('3.6',          'Trigonometric identities',                               3, NULL, NULL),
('3.7',          'Circular functions',                                     3, NULL, NULL),
('3.8',          'Trigonometric equations',                                3, NULL, NULL),
('3.9',          'Reciprocal trig ratios and inverse trig functions',      3, NULL, NULL),
('3.10',         'Trigonometric identities revisited',                     3, NULL, NULL),
('3.11',         'Further circular functions',                             3, NULL, NULL),
('3.12',         'Vectors',                                                3, NULL, NULL),
('3.13',         'Scalar product',                                         3, NULL, NULL),
('3.14',         'Lines in two and three dimensions',                      3, NULL, NULL),
('3.15',         'Relative positions of lines',                            3, NULL, NULL),
('3.16',         'Vector product',                                         3, NULL, NULL),
('3.17',         'Vector equations of a plane',                            3, NULL, NULL),
('3.18',         'Intersections and angles between lines and planes',      3, NULL, NULL),
-- Section 4: Statistics & Probability
('4.1',          'Collection of data and sampling',                        4, NULL, NULL),
('4.2',          'Presentation of data',                                   4, NULL, NULL),
('4.3',          'Measures of central tendency and dispersion',            4, NULL, NULL),
('4.4',          'Linear correlation of bivariate data',                   4, NULL, NULL),
('4.5',          'Probability and expected outcomes',                      4, NULL, NULL),
('4.6',          'Probability calculations',                               4, NULL, NULL),
('4.7',          'Discrete random variables',                              4, NULL, NULL),
('4.8',          'The binomial distribution',                              4, NULL, NULL),
('4.9',          'The normal distribution and curve',                      4, NULL, NULL),
('4.10',         'Further linear regression',                              4, NULL, NULL),
('4.11',         'Conditional probability and independence',               4, NULL, NULL),
('4.12',         'The standard normal distribution',                       4, NULL, NULL),
('4.13',         'Bayes'' theorem',                                        4, NULL, NULL),
('4.14',         'Continuous random variables',                            4, NULL, NULL),
-- Section 5: Calculus
('5.1',          'Introduction to differentiation',                        5, NULL, NULL),
('5.2',          'Increasing and decreasing functions',                    5, NULL, NULL),
('5.3',          'Derivatives of power functions',                         5, NULL, NULL),
('5.4',          'Tangents and normals',                                   5, NULL, NULL),
('5.5',          'Introduction to integration',                            5, NULL, NULL),
('5.6',          'Differentiation rules',                                  5, NULL, NULL),
('5.7',          'Further graph properties',                               5, NULL, NULL),
('5.7.2',        'Second derivative',                                      5, NULL, '5.7'),
('5.7.3',        'Concavity',                                             5, NULL, '5.7'),
('5.7.4',        'Relationship between graphs and derivative graphs',     5, NULL, '5.7'),
('5.8',          'Optimisation',                                           5, NULL, NULL),
('5.9',          'Kinematics',                                             5, NULL, NULL),
('5.10',         'Indefinite integrals',                                   5, NULL, NULL),
('5.10.2',       'Integrals of reciprocal functions',                      5, NULL, '5.10'),
('5.10.5',       'Substitution',                                           5, NULL, '5.10'),
('5.11',         'Definite integrals',                                     5, NULL, NULL),
('5.12 (FP)',    'First Principles',                                       5, NULL, NULL),
('5.12 (lim)',   'Limits, continuity, differentiability',                  5, NULL, NULL),
('5.12 (high)',  'Higher derivatives',                                     5, NULL, NULL),
('5.13',         'Limits of indeterminate forms',                          5, NULL, NULL),
('5.14',         'Chain rule part deux',                                   5, NULL, NULL),
('5.14.1',       'Implicit differentiation',                               5, '5.14 (imp)', '5.14'),
('5.14.2',       'Related rates of change',                                5, '5.14 (rroc)', '5.14'),
('5.15 (diff)',  'Derivatives of other functions',                         5, NULL, NULL),
('5.15 (int)',   'Integrals of other functions',                           5, NULL, NULL),
('5.15.5',       'Indefinite integrals of rational functions',             5, '5.15 (pfd)', NULL),
('5.16',         'Further integration',                                    5, NULL, NULL),
('5.16 (Isub)',  'Integration by substitution (indefinite)',               5, NULL, '5.16'),
('5.16 (Dsub)',  'Integration by substitution (definite)',                 5, NULL, '5.16'),
('5.16 (parts)', 'Integration by parts',                                  5, '5.16 (ibp)', '5.16'),
('5.16.4',       'Repeated integration by parts',                          5, '5.16 (ibp+)', '5.16'),
('5.17 (vol)',   'Volume of revolution',                                   5, NULL, NULL),
('5.17 (rs)',    'Riemann Sum',                                            5, NULL, NULL),
('5.18',         'Differential equations',                                 5, NULL, NULL),
('5.18 (Eul)',   'Euler''s method',                                        5, NULL, '5.18'),
('5.18 (sep)',   'Separable differential equations',                       5, NULL, '5.18'),
('5.18 (hom)',   'Homogeneous equations',                                  5, NULL, '5.18'),
('5.18 (IF)',    'Integrating factor',                                     5, NULL, '5.18'),
('5.19',         'Maclaurin series expansions',                            5, NULL, NULL)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 2. IB QUESTIONS (one row per IB question code)
-- ============================================
CREATE TABLE IF NOT EXISTS public.ib_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  session TEXT NOT NULL,
  paper INT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('SL', 'AHL')),
  timezone TEXT NOT NULL,
  difficulty INT CHECK (difficulty BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ib_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers can manage IB questions" ON public.ib_questions;
CREATE POLICY "Teachers can manage IB questions" ON public.ib_questions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'));
DROP POLICY IF EXISTS "Students can view IB questions" ON public.ib_questions;
CREATE POLICY "Students can view IB questions" ON public.ib_questions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('student', 'teacher')));

-- ============================================
-- 3. QUESTION PARTS (a, ai, aii, b, c, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS public.question_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.ib_questions(id) ON DELETE CASCADE,
  part_label TEXT NOT NULL DEFAULT '',
  marks INT NOT NULL DEFAULT 1,
  subtopic_codes TEXT[] DEFAULT '{}',
  command_term TEXT,
  hints TEXT,
  content_images TEXT[] DEFAULT '{}',
  markscheme_images TEXT[] DEFAULT '{}',
  content_text TEXT,
  markscheme_text TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, part_label)
);

ALTER TABLE public.question_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers can manage question parts" ON public.question_parts;
CREATE POLICY "Teachers can manage question parts" ON public.question_parts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'));
DROP POLICY IF EXISTS "Students can view question parts" ON public.question_parts;
CREATE POLICY "Students can view question parts" ON public.question_parts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('student', 'teacher')));
