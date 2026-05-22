-- Migration 047: Mirror student marks from Camilla to Pablo (test account)
-- Backfills existing K06 marks and sets up a trigger for all future assessments.

-- ─── Step 1: Backfill existing marks ───────────────────────────────────────

INSERT INTO public.student_marks (student_id, test_item_id, marks_awarded, recorded_at, recorded_by)
SELECT
  pablo_stud.id          AS student_id,
  sm.test_item_id,
  sm.marks_awarded,
  sm.recorded_at,
  sm.recorded_by
FROM public.student_marks sm

-- source student (Camilla)
JOIN public.students camilla_stud ON camilla_stud.id = sm.student_id
JOIN public.profiles camilla_prof ON camilla_prof.id = camilla_stud.profile_id
  AND lower(camilla_prof.display_name) ILIKE '%camilla%'

-- test must belong to a K06 course
JOIN public.tests t ON t.id = (
  SELECT ti.test_id FROM public.test_items ti WHERE ti.id = sm.test_item_id LIMIT 1
)
WHERE t.name ILIKE '%K06%'

-- Pablo's student row in the same course
JOIN public.students pablo_stud
  ON pablo_stud.course_id = camilla_stud.course_id
JOIN public.profiles pablo_prof ON pablo_prof.id = pablo_stud.profile_id
  AND pablo_prof.email = 'pcleveng@amersol.edu.pe'

ON CONFLICT (student_id, test_item_id) DO UPDATE
  SET marks_awarded = EXCLUDED.marks_awarded,
      recorded_at   = EXCLUDED.recorded_at;


-- ─── Step 2: Trigger function ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mirror_marks_to_pablo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id      UUID;
  v_source_profile UUID;
  v_pablo_profile  UUID;
  v_pablo_student  UUID;
BEGIN
  -- Resolve the course and profile of the student being marked
  SELECT s.course_id, s.profile_id
    INTO v_course_id, v_source_profile
    FROM public.students s
   WHERE s.id = NEW.student_id;

  -- Resolve Pablo's profile id (constant, but we look it up to be safe)
  SELECT p.id INTO v_pablo_profile
    FROM public.profiles p
   WHERE p.email = 'pcleveng@amersol.edu.pe';

  -- Skip if Pablo doesn't exist or if this mark IS already for Pablo
  IF v_pablo_profile IS NULL OR v_source_profile = v_pablo_profile THEN
    RETURN NEW;
  END IF;

  -- Only mirror from Camilla
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_source_profile
       AND lower(display_name) ILIKE '%camilla%'
  ) THEN
    RETURN NEW;
  END IF;

  -- Find Pablo's student row for the same course
  SELECT s.id INTO v_pablo_student
    FROM public.students s
   WHERE s.profile_id = v_pablo_profile
     AND s.course_id  = v_course_id;

  IF v_pablo_student IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mirror the mark to Pablo
  INSERT INTO public.student_marks
        (student_id,     test_item_id,   marks_awarded,   recorded_at,   recorded_by)
  VALUES (v_pablo_student, NEW.test_item_id, NEW.marks_awarded, NEW.recorded_at, NEW.recorded_by)
  ON CONFLICT (student_id, test_item_id) DO UPDATE
     SET marks_awarded = EXCLUDED.marks_awarded,
         recorded_at   = EXCLUDED.recorded_at;

  RETURN NEW;
END;
$$;


-- ─── Step 3: Attach trigger ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS mirror_marks_to_pablo_trigger ON public.student_marks;

CREATE TRIGGER mirror_marks_to_pablo_trigger
  AFTER INSERT OR UPDATE ON public.student_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.mirror_marks_to_pablo();
