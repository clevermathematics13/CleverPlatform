
-- Sync command_terms table to the official IB Mathematics: Analysis and Approaches guide (36 terms).
-- Removes 16 non-IB terms, adds 4 missing terms, resets sort_order to alphabetical.

-- Step 1: Remove terms not in the official IB AA guide
DELETE FROM public.command_terms
WHERE term IN (
  'Classify', 'Complete', 'Copy', 'Evaluate', 'Expand', 'Express',
  'Factorise', 'Give', 'Let', 'Mark', 'Measure', 'Outline',
  'Represent', 'Simplify', 'Trace', 'Using'
);

-- Step 2: Add the 4 missing official terms
INSERT INTO public.command_terms (term, sort_order) VALUES
  ('Compare and contrast', 0),
  ('Contrast',             0),
  ('Hence or otherwise',   0),
  ('Show that',            0)
ON CONFLICT (term) DO NOTHING;

-- Step 3: Reset sort_order for all 36 terms in alphabetical order
UPDATE public.command_terms SET sort_order = v.sort_order
FROM (VALUES
  ('Calculate',           1),
  ('Comment',             2),
  ('Compare',             3),
  ('Compare and contrast',4),
  ('Construct',           5),
  ('Contrast',            6),
  ('Deduce',              7),
  ('Demonstrate',         8),
  ('Describe',            9),
  ('Determine',          10),
  ('Differentiate',      11),
  ('Distinguish',        12),
  ('Draw',               13),
  ('Estimate',           14),
  ('Explain',            15),
  ('Find',               16),
  ('Hence',              17),
  ('Hence or otherwise', 18),
  ('Identify',           19),
  ('Integrate',          20),
  ('Interpret',          21),
  ('Investigate',        22),
  ('Justify',            23),
  ('Label',              24),
  ('List',               25),
  ('Plot',               26),
  ('Predict',            27),
  ('Prove',              28),
  ('Show',               29),
  ('Show that',          30),
  ('Sketch',             31),
  ('Solve',              32),
  ('State',              33),
  ('Suggest',            34),
  ('Verify',             35),
  ('Write down',         36)
) AS v(term, sort_order)
WHERE public.command_terms.term = v.term;
;
