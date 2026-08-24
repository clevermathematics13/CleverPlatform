
-- Command terms reference table
-- Single source of truth for all IB-approved command terms.
-- The codebase imports from platform/lib/command-terms.ts which must stay
-- in sync with this table (both seeded from the same canonical list).

CREATE TABLE IF NOT EXISTS public.command_terms (
  term        text PRIMARY KEY,
  sort_order  integer NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.command_terms IS
  'IB-approved command terms. term is the canonical display form (e.g. "Write down"). '
  'Modifications to this table must be mirrored in platform/lib/command-terms.ts.';

-- Seed all 48 approved terms in alphabetical order
INSERT INTO public.command_terms (term, sort_order) VALUES
  ('Calculate',     1),
  ('Classify',      2),
  ('Comment',       3),
  ('Compare',       4),
  ('Complete',      5),
  ('Construct',     6),
  ('Copy',          7),
  ('Deduce',        8),
  ('Demonstrate',   9),
  ('Describe',     10),
  ('Determine',    11),
  ('Differentiate',12),
  ('Distinguish',  13),
  ('Draw',         14),
  ('Estimate',     15),
  ('Evaluate',     16),
  ('Expand',       17),
  ('Explain',      18),
  ('Express',      19),
  ('Factorise',    20),
  ('Find',         21),
  ('Give',         22),
  ('Hence',        23),
  ('Identify',     24),
  ('Integrate',    25),
  ('Interpret',    26),
  ('Investigate',  27),
  ('Justify',      28),
  ('Label',        29),
  ('Let',          30),
  ('List',         31),
  ('Mark',         32),
  ('Measure',      33),
  ('Outline',      34),
  ('Plot',         35),
  ('Predict',      36),
  ('Prove',        37),
  ('Represent',    38),
  ('Show',         39),
  ('Simplify',     40),
  ('Sketch',       41),
  ('Solve',        42),
  ('State',        43),
  ('Suggest',      44),
  ('Trace',        45),
  ('Using',        46),
  ('Verify',       47),
  ('Write down',   48)
ON CONFLICT (term) DO NOTHING;

-- RLS: readable by all authenticated users, writable only by service role
ALTER TABLE public.command_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "command_terms_read_authenticated"
  ON public.command_terms
  FOR SELECT
  TO authenticated
  USING (true);
;
