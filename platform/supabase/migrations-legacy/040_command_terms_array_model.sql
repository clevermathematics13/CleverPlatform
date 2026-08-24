-- 040: Move from single command_term to command_terms[] model (with compatibility sync).

ALTER TABLE public.question_parts
  ADD COLUMN IF NOT EXISTS command_terms TEXT[] NOT NULL DEFAULT '{}';

-- Backfill array from legacy single field where empty.
UPDATE public.question_parts
SET command_terms = CASE
  WHEN command_term IS NULL OR btrim(command_term) = '' THEN '{}'::TEXT[]
  ELSE ARRAY[command_term]
END
WHERE COALESCE(array_length(command_terms, 1), 0) = 0;

CREATE OR REPLACE FUNCTION public.normalize_command_terms(
  p_command_term TEXT,
  p_command_terms TEXT[]
)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  terms TEXT[] := '{}';
  t TEXT;
BEGIN
  -- Prefer explicit array; fallback to single field.
  IF p_command_terms IS NULL OR COALESCE(array_length(p_command_terms, 1), 0) = 0 THEN
    IF p_command_term IS NULL OR btrim(p_command_term) = '' THEN
      RETURN '{}'::TEXT[];
    END IF;
    RETURN ARRAY[btrim(p_command_term)];
  END IF;

  FOREACH t IN ARRAY p_command_terms LOOP
    t := btrim(COALESCE(t, ''));
    IF t = '' THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM unnest(terms) AS e WHERE lower(e) = lower(t)
    ) THEN
      terms := array_append(terms, t);
    END IF;
  END LOOP;

  IF COALESCE(array_length(terms, 1), 0) = 0 THEN
    RETURN '{}'::TEXT[];
  END IF;

  RETURN terms;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_question_parts_sync_command_terms()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.command_terms := public.normalize_command_terms(NEW.command_term, NEW.command_terms);
  NEW.command_term := CASE
    WHEN COALESCE(array_length(NEW.command_terms, 1), 0) > 0 THEN NEW.command_terms[1]
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS question_parts_sync_command_terms ON public.question_parts;

CREATE TRIGGER question_parts_sync_command_terms
BEFORE INSERT OR UPDATE OF command_term, command_terms
ON public.question_parts
FOR EACH ROW
EXECUTE FUNCTION public.trg_question_parts_sync_command_terms();

-- Ensure all existing rows are normalized through the trigger logic.
UPDATE public.question_parts
SET command_terms = public.normalize_command_terms(command_term, command_terms),
    command_term = CASE
      WHEN COALESCE(array_length(public.normalize_command_terms(command_term, command_terms), 1), 0) > 0
        THEN (public.normalize_command_terms(command_term, command_terms))[1]
      ELSE NULL
    END;

-- Backfill secondary command terms from content_latex while keeping the
-- primary command term as first element.
WITH term_catalog(term) AS (
  VALUES
    ('Calculate'),('Classify'),('Comment'),('Compare'),('Complete'),('Construct'),('Copy'),
    ('Deduce'),('Demonstrate'),('Describe'),('Determine'),('Differentiate'),('Distinguish'),
    ('Draw'),('Estimate'),('Evaluate'),('Expand'),('Explain'),('Express'),('Factorise'),
    ('Find'),('Give'),('Hence'),('Identify'),('Integrate'),('Interpret'),('Investigate'),
    ('Justify'),('Label'),('Let'),('List'),('Mark'),('Measure'),('Outline'),('Plot'),
    ('Predict'),('Prove'),('Represent'),('Show'),('Simplify'),('Sketch'),('Solve'),('State'),
    ('Suggest'),('Trace'),('Using'),('Verify'),('Write down')
),
detected AS (
  SELECT
    qp.id,
    ARRAY_AGG(tc.term ORDER BY LENGTH(tc.term) DESC, tc.term) AS terms
  FROM public.question_parts qp
  JOIN term_catalog tc
    ON COALESCE(qp.content_latex, '') ~* ('\\m' || regexp_replace(tc.term, '\\s+', '\\\\s+', 'g') || '\\M')
  GROUP BY qp.id
)
UPDATE public.question_parts qp
SET command_terms = public.normalize_command_terms(
  qp.command_term,
  CASE
    WHEN qp.command_term IS NULL OR btrim(qp.command_term) = '' THEN COALESCE(detected.terms, '{}'::TEXT[])
    ELSE ARRAY[qp.command_term] || ARRAY(
      SELECT t
      FROM UNNEST(COALESCE(detected.terms, '{}'::TEXT[])) AS t
      WHERE LOWER(t) <> LOWER(qp.command_term)
    )
  END
)
FROM detected
WHERE qp.id = detected.id;
