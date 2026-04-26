-- ============================================
-- COMBINED: 014 (tables) + 016 (seed 27AH students)
-- Paste this entire script into Supabase SQL Editor and Run.
-- ============================================

-- Drop old tables cleanly (in dependency order)
DROP TABLE IF EXISTS public.seating_current    CASCADE;
DROP TABLE IF EXISTS public.seating_assignments CASCADE;
DROP TABLE IF EXISTS public.seating_rules      CASCADE;
DROP TABLE IF EXISTS public.seating_settings   CASCADE;
DROP TABLE IF EXISTS public.seating_seats      CASCADE;
DROP TABLE IF EXISTS public.seating_students   CASCADE;

-- Students in each class group
CREATE TABLE IF NOT EXISTS public.seating_students (
  student_id  TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  class_group TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  notes       TEXT NOT NULL DEFAULT ''
);

ALTER TABLE public.seating_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers manage seating_students" ON public.seating_students;
CREATE POLICY "Teachers manage seating_students"
  ON public.seating_students FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Students read seating_students" ON public.seating_students;
CREATE POLICY "Students read seating_students"
  ON public.seating_students FOR SELECT
  USING (auth.role() = 'authenticated');

-- Physical seat layout
CREATE TABLE IF NOT EXISTS public.seating_seats (
  seat_id     TEXT PRIMARY KEY,
  class_group TEXT NOT NULL DEFAULT '*',
  pod_id      TEXT NOT NULL,
  seat_role   TEXT NOT NULL DEFAULT 'L',
  x           NUMERIC NOT NULL DEFAULT 0,
  y           NUMERIC NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.seating_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers manage seating_seats" ON public.seating_seats;
CREATE POLICY "Teachers manage seating_seats"
  ON public.seating_seats FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Students read seating_seats" ON public.seating_seats;
CREATE POLICY "Students read seating_seats"
  ON public.seating_seats FOR SELECT
  USING (auth.role() = 'authenticated');

-- Placement rules (PAIR / POD)
CREATE TABLE IF NOT EXISTS public.seating_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type   TEXT NOT NULL CHECK (rule_type IN ('PAIR', 'POD')),
  class_group TEXT NOT NULL DEFAULT '*',
  student_a   TEXT NOT NULL DEFAULT '',
  student_b   TEXT NOT NULL DEFAULT '',
  student_id  TEXT NOT NULL DEFAULT '',
  pod_id      TEXT NOT NULL DEFAULT '',
  weight      NUMERIC NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.seating_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers manage seating_rules" ON public.seating_rules;
CREATE POLICY "Teachers manage seating_rules"
  ON public.seating_rules FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

-- Assignment history
CREATE TABLE IF NOT EXISTS public.seating_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  class_group     TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  candidate_score NUMERIC NOT NULL DEFAULT 0,
  student_id      TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  seat_id         TEXT NOT NULL,
  pod_id          TEXT NOT NULL,
  seat_role       TEXT NOT NULL DEFAULT '',
  x               NUMERIC NOT NULL DEFAULT 0,
  y               NUMERIC NOT NULL DEFAULT 0
);

ALTER TABLE public.seating_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers manage seating_assignments" ON public.seating_assignments;
CREATE POLICY "Teachers manage seating_assignments"
  ON public.seating_assignments FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Students read own seating_assignments" ON public.seating_assignments;
CREATE POLICY "Students read own seating_assignments"
  ON public.seating_assignments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS seating_assignments_class_run_idx
  ON public.seating_assignments (class_group, run_id);
CREATE INDEX IF NOT EXISTS seating_assignments_timestamp_idx
  ON public.seating_assignments (timestamp DESC);

-- Current seating state (latest run per class – one row per student)
CREATE TABLE IF NOT EXISTS public.seating_current (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  class_group     TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  candidate_score NUMERIC NOT NULL DEFAULT 0,
  student_id      TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  seat_id         TEXT NOT NULL,
  pod_id          TEXT NOT NULL,
  seat_role       TEXT NOT NULL DEFAULT '',
  x               NUMERIC NOT NULL DEFAULT 0,
  y               NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (class_group, student_id)
);

ALTER TABLE public.seating_current ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers manage seating_current" ON public.seating_current;
CREATE POLICY "Teachers manage seating_current"
  ON public.seating_current FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Students read seating_current" ON public.seating_current;
CREATE POLICY "Students read seating_current"
  ON public.seating_current FOR SELECT
  USING (auth.role() = 'authenticated');

-- Algorithm tuning knobs
CREATE TABLE IF NOT EXISTS public.seating_settings (
  key   TEXT PRIMARY KEY,
  value NUMERIC NOT NULL
);

ALTER TABLE public.seating_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers manage seating_settings" ON public.seating_settings;
CREATE POLICY "Teachers manage seating_settings"
  ON public.seating_settings FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Authenticated read seating_settings" ON public.seating_settings;
CREATE POLICY "Authenticated read seating_settings"
  ON public.seating_settings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Default settings
INSERT INTO public.seating_settings (key, value) VALUES
  ('candidate_count',       900),
  ('top_k',                  40),
  ('temperature',             2),
  ('history_runs',            5),
  ('freshness_pair_weight', 1.5),
  ('freshness_seat_weight', 0.5)
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- Seed 27AH students (13 students)
-- ============================================
INSERT INTO public.seating_students (student_id, name, class_group, active, notes) VALUES
  ('julio',      'Julio',      '27AH', true, ''),
  ('nicolas',    'Nicolas',    '27AH', true, ''),
  ('gael',       'Gael',       '27AH', true, ''),
  ('minjun',     'Minjun',     '27AH', true, ''),
  ('camilla',    'Camilla',    '27AH', true, ''),
  ('pedro',      'Pedro',      '27AH', true, ''),
  ('salim',      'Salim',      '27AH', true, ''),
  ('wyatt',      'Wyatt',      '27AH', true, ''),
  ('seungjun',   'Seungjun',   '27AH', true, ''),
  ('carlos',     'Carlos',     '27AH', true, ''),
  ('luciana',    'Luciana',    '27AH', true, ''),
  ('alejandro',  'Alejandro',  '27AH', true, ''),
  ('gustavo',    'Gustavo',    '27AH', true, '')
ON CONFLICT (student_id) DO NOTHING;
