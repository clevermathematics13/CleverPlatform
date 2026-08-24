ALTER TABLE public.nuanced_analyses
  ALTER COLUMN vocabulary DROP DEFAULT;

ALTER TABLE public.nuanced_analyses
  ALTER COLUMN vocabulary TYPE jsonb
  USING COALESCE(to_jsonb(vocabulary), '[]'::jsonb);

ALTER TABLE public.nuanced_analyses
  ALTER COLUMN vocabulary SET DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.nuanced_analyses.vocabulary IS 'Array of {student_speak, ib_rigor} pairs for the glossary/tear-off strip (Layer 3, Command-Term Accessibility). Was text[]; migrated to jsonb to support structured pairs.';
;
