ALTER TABLE public.question_parts
  ADD COLUMN IF NOT EXISTS instructional_context_terms TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.question_parts
SET instructional_context_terms = ARRAY_REMOVE(ARRAY[
  CASE WHEN command_term IS NOT NULL AND btrim(command_term) <> '' THEN command_term END,
  CASE WHEN is_hence_or_otherwise THEN 'Hence or otherwise' END,
  CASE WHEN is_hence THEN 'Hence' END,
  CASE WHEN is_using THEN 'Using' END,
  CASE WHEN is_deduce THEN 'Deduce' END,
  CASE WHEN is_verify THEN 'Verify' END
], NULL)
WHERE instructional_context_terms = '{}'::text[];
