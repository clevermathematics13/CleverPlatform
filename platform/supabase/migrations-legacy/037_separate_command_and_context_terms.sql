-- Ensure instructional_context_terms excludes the primary command_term.
UPDATE public.question_parts
SET instructional_context_terms = (
  SELECT COALESCE(array_agg(x), '{}')
  FROM unnest(COALESCE(instructional_context_terms, '{}')) AS x
  WHERE command_term IS NULL OR lower(btrim(x)) <> lower(btrim(command_term))
);
