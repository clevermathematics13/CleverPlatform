
-- Step 1: Fix case-insensitive matches on command_term (single value column)
-- e.g. "calculate" → "Calculate", "sketch" → "Sketch", "find" → "Find"
UPDATE question_parts qp
SET command_term = ct.term
FROM public.command_terms ct
WHERE is_active = true
  AND lower(qp.command_term) = lower(ct.term)
  AND qp.command_term <> ct.term;  -- only update if case differs

-- Step 2: Null out command_term values that are still not in the approved list
UPDATE question_parts
SET command_term = NULL
WHERE command_term IS NOT NULL
  AND command_term NOT IN (
    SELECT term FROM public.command_terms WHERE is_active = true
  );

-- Step 3: Clean command_terms array — remove non-approved entries, fix case variants
-- Replace each array with only the approved canonical forms (case-insensitive match)
UPDATE question_parts
SET command_terms = (
  SELECT array_agg(ct.term ORDER BY ct.sort_order)
  FROM unnest(command_terms) AS t(raw_term)
  JOIN public.command_terms ct
    ON lower(t.raw_term) = lower(ct.term)
    AND ct.is_active = true
)
WHERE command_terms IS NOT NULL
  AND array_length(command_terms, 1) > 0;

-- Step 4: Where command_terms array is now empty or null but command_term has a value,
-- re-sync command_terms from command_term
UPDATE question_parts
SET command_terms = ARRAY[command_term]
WHERE command_term IS NOT NULL
  AND (command_terms IS NULL OR array_length(command_terms, 1) = 0 OR command_terms = '{}');

-- Step 5: Where command_term is null but command_terms has values, sync back
UPDATE question_parts
SET command_term = command_terms[1]
WHERE command_term IS NULL
  AND command_terms IS NOT NULL
  AND array_length(command_terms, 1) > 0;
;
