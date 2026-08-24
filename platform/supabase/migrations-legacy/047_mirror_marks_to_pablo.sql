-- Migration 047: Mirror student marks from Camilla to Pablo (test account)
-- Backfills existing K06 marks and sets up a trigger for all future assessments.

-- ─── Step 1: Backfill existing marks ───────────────────────────────────────
-- student_marks.student_id is profiles.id directly (no students table needed)

INSERT INTO public.student_marks (student_id, test_item_id, marks_awarded)
SELECT
  pablo_prof.id  AS student_id,
  sm.test_item_id,
  sm.marks_awarded
FROM public.student_marks sm
JOIN public.profiles camilla_prof ON camilla_prof.id = sm.student_id
  AND lower(camilla_prof.display_name) ILIKE '%camilla%'
JOIN public.test_items ti ON ti.id = sm.test_item_id
JOIN public.tests t ON t.id = ti.test_id
  AND t.name ILIKE '%K06%'
CROSS JOIN (
  SELECT id FROM public.profiles WHERE email = 'pcleveng@amersol.edu.pe'
) AS pablo_prof
ON CONFLICT (test_item_id, student_id) DO UPDATE
  SET marks_awarded = EXCLUDED.marks_awarded;


-- ─── Step 2: Trigger function ───────────────────────────────────────────────

-- student_marks.student_id IS profiles.id — no students table lookup needed
CREATE OR REPLACE FUNCTION public.mirror_marks_to_pablo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pablo_profile UUID;
BEGIN
  -- Look up Pablo's profile id
  SELECT id INTO v_pablo_profile
    FROM public.profiles
   WHERE email = 'pcleveng@amersol.edu.pe';

  -- Skip if Pablo doesn't exist or the mark is already for Pablo
  IF v_pablo_profile IS NULL OR NEW.student_id = v_pablo_profile THEN
    RETURN NEW;
  END IF;

  -- Only mirror from Camilla
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = NEW.student_id
       AND lower(display_name) ILIKE '%camilla%'
  ) THEN
    RETURN NEW;
  END IF;

  -- Mirror the mark to Pablo
  INSERT INTO public.student_marks (student_id, test_item_id, marks_awarded)
  VALUES (v_pablo_profile, NEW.test_item_id, NEW.marks_awarded)
  ON CONFLICT (test_item_id, student_id) DO UPDATE
     SET marks_awarded = EXCLUDED.marks_awarded;

  RETURN NEW;
END;
$$;


-- ─── Step 3: Attach trigger ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS mirror_marks_to_pablo_trigger ON public.student_marks;

CREATE TRIGGER mirror_marks_to_pablo_trigger
  AFTER INSERT OR UPDATE ON public.student_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.mirror_marks_to_pablo();
