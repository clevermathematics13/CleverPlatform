-- 039: Enforce strict exclusivity between command_term and instructional_context_terms.
-- A term must be either command or context, never both.

CREATE OR REPLACE FUNCTION public.normalize_instructional_context_terms(
  p_command_term TEXT,
  p_terms TEXT[]
)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  WITH command_terms(term) AS (
    VALUES
      ('calculate'),('classify'),('comment'),('compare'),('complete'),('construct'),('copy'),
      ('deduce'),('demonstrate'),('describe'),('determine'),('differentiate'),('distinguish'),
      ('draw'),('estimate'),('evaluate'),('expand'),('explain'),('express'),('factorise'),
      ('find'),('give'),('hence'),('identify'),('integrate'),('interpret'),('investigate'),
      ('justify'),('label'),('let'),('list'),('mark'),('measure'),('outline'),('plot'),
      ('predict'),('prove'),('represent'),('show'),('simplify'),('sketch'),('solve'),('state'),
      ('suggest'),('trace'),('using'),('verify'),('write down')
  ),
  cleaned AS (
    SELECT DISTINCT BTRIM(t) AS term
    FROM UNNEST(COALESCE(p_terms, '{}'::TEXT[])) AS t
    WHERE BTRIM(t) <> ''
  )
  SELECT COALESCE(
    ARRAY(
      SELECT c.term
      FROM cleaned c
      WHERE LOWER(c.term) <> LOWER(COALESCE(BTRIM(p_command_term), ''))
        AND LOWER(c.term) NOT IN (SELECT term FROM command_terms)
      ORDER BY c.term
    ),
    '{}'::TEXT[]
  );
$$;

-- Backfill existing rows to normalized terms.
UPDATE public.question_parts
SET instructional_context_terms = public.normalize_instructional_context_terms(
  command_term,
  instructional_context_terms
)
WHERE instructional_context_terms IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_question_parts_normalize_context_terms()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.instructional_context_terms := public.normalize_instructional_context_terms(
    NEW.command_term,
    NEW.instructional_context_terms
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS question_parts_normalize_context_terms ON public.question_parts;

CREATE TRIGGER question_parts_normalize_context_terms
BEFORE INSERT OR UPDATE OF command_term, instructional_context_terms
ON public.question_parts
FOR EACH ROW
EXECUTE FUNCTION public.trg_question_parts_normalize_context_terms();
