-- 038: Safe backfill of command-term metadata on legacy production databases.
-- Applies the 035/036/037 intent with NULL-safe updates and a broader term backfill.

ALTER TABLE public.question_parts
  ADD COLUMN IF NOT EXISTS is_hence BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hence_or_otherwise BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_using BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_deduce BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verify BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS instructional_context_terms TEXT[] NOT NULL DEFAULT '{}';

-- NULL-safe boolean backfill from command_term + content_latex.
UPDATE public.question_parts
SET
  is_hence_or_otherwise = (
    COALESCE(command_term ILIKE 'Hence or otherwise', FALSE)
    OR COALESCE(content_latex, '') ~* '\\mhence\\s+or\\s+otherwise\\M'
  ),
  is_hence = (
    COALESCE(command_term ILIKE 'Hence', FALSE)
    OR COALESCE(command_term ILIKE 'Hence or otherwise', FALSE)
    OR COALESCE(content_latex, '') ~* '\\mhence\\M'
  ),
  is_using = (
    COALESCE(command_term ILIKE 'Using', FALSE)
    OR COALESCE(content_latex, '') ~* '\\musing\\M'
  ),
  is_deduce = (
    COALESCE(command_term ILIKE 'Deduce', FALSE)
    OR COALESCE(content_latex, '') ~* '\\mdeduce\\M'
  ),
  is_verify = (
    COALESCE(command_term ILIKE 'Verify', FALSE)
    OR COALESCE(content_latex, '') ~* '\\mverify\\M'
  );

-- Backfill instructional_context_terms from detected command/context terms in content_latex.
WITH term_catalog(term) AS (
  VALUES
    ('Calculate'),('Classify'),('Comment'),('Compare'),('Complete'),('Construct'),('Copy'),
    ('Deduce'),('Demonstrate'),('Describe'),('Determine'),('Differentiate'),('Distinguish'),
    ('Draw'),('Estimate'),('Evaluate'),('Expand'),('Explain'),('Express'),('Factorise'),
    ('Find'),('Give'),('Hence'),('Hence or otherwise'),('Identify'),('Integrate'),('Interpret'),
    ('Investigate'),('Justify'),('Label'),('Let'),('List'),('Mark'),('Measure'),('Outline'),
    ('Plot'),('Predict'),('Prove'),('Represent'),('Show'),('Show that'),('Simplify'),('Sketch'),
    ('Solve'),('State'),('Suggest'),('Trace'),('Using'),('Using your answer'),('Verify'),('Write down')
),
found_terms AS (
  SELECT
    qp.id,
    ARRAY_AGG(tc.term ORDER BY LENGTH(tc.term) DESC, tc.term) AS terms
  FROM public.question_parts qp
  JOIN term_catalog tc
    ON COALESCE(qp.content_latex, '') ~* ('\\m' || regexp_replace(tc.term, '\\s+', '\\\\s+', 'g') || '\\M')
  GROUP BY qp.id
)
UPDATE public.question_parts qp
SET instructional_context_terms = (
  SELECT COALESCE(array_agg(t), '{}')
  FROM (
    SELECT DISTINCT u AS t
    FROM UNNEST(COALESCE(ft.terms, '{}')) AS u
    WHERE qp.command_term IS NULL OR LOWER(BTRIM(u)) <> LOWER(BTRIM(qp.command_term))
  ) dedup
)
FROM found_terms ft
WHERE qp.id = ft.id;
