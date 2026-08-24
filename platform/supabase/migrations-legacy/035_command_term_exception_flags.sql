ALTER TABLE public.question_parts
  ADD COLUMN IF NOT EXISTS is_hence BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hence_or_otherwise BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_using BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_deduce BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verify BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill from existing command_term and content_latex text where possible.
UPDATE public.question_parts
SET
  is_hence_or_otherwise = (
    command_term ILIKE 'Hence or otherwise'
    OR COALESCE(content_latex, '') ~* '\\mhence\\s+or\\s+otherwise\\M'
  ),
  is_hence = (
    command_term ILIKE 'Hence'
    OR command_term ILIKE 'Hence or otherwise'
    OR COALESCE(content_latex, '') ~* '\\mhence\\M'
  ),
  is_using = (
    command_term ILIKE 'Using'
    OR COALESCE(content_latex, '') ~* '\\musing\\M'
  ),
  is_deduce = (
    command_term ILIKE 'Deduce'
    OR COALESCE(content_latex, '') ~* '\\mdeduce\\M'
  ),
  is_verify = (
    command_term ILIKE 'Verify'
    OR COALESCE(content_latex, '') ~* '\\mverify\\M'
  );
