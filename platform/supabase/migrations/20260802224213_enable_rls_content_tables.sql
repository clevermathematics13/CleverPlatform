-- Enable RLS on tables that were fully exposed to anon/authenticated roles
ALTER TABLE public.nuanced_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_boundary_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_boundaries ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to read (matches prior open-read behavior for logged-in app users)
CREATE POLICY "Authenticated users can read nuanced_analyses"
  ON public.nuanced_analyses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read grade_boundary_sets"
  ON public.grade_boundary_sets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read grade_boundaries"
  ON public.grade_boundaries FOR SELECT
  TO authenticated
  USING (true);

-- No insert/update/delete policies added: writes are expected to go through
-- the service role (server-side), which bypasses RLS entirely.
;
