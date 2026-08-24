-- ============================================
-- 016. SEED seating_students — 27AH (13 students)
-- ============================================
-- Hard-coded from marks data. student_id = first name (lower-case).
-- Update student_id to email once students register.
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
