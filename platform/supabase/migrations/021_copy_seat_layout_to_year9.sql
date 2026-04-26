-- ============================================
-- 021. Copy 27AH seat layout → 9A, 9D, 9G
-- ============================================
-- Copies every seat from class_group '27AH' into 9A, 9D, and 9G.
-- seat_id is namespaced per class so each group can be customised
-- independently via the Layout tab.
-- Idempotent: ON CONFLICT (seat_id) DO NOTHING.
-- ============================================

INSERT INTO public.seating_seats (seat_id, class_group, pod_id, seat_role, x, y, active)
SELECT
  target.class_group || '-' || src.pod_id || '-' || src.seat_role AS seat_id,
  target.class_group,
  src.pod_id,
  src.seat_role,
  src.x,
  src.y,
  src.active
FROM public.seating_seats src
CROSS JOIN (VALUES ('9A'), ('9D'), ('9G')) AS target(class_group)
WHERE src.class_group = '27AH'
ON CONFLICT (seat_id) DO NOTHING;
