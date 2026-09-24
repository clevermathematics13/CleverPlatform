-- The packet generator's copy rule follows the rename of the marks
-- themselves: teacher-approved marks are "ClevMarks" in every piece of copy
-- now (CLAUDE.md), not "Clev's Marks".
--
-- lib/nuanced-analysis-spec.defaults.ts carries the same rule, but the code
-- default is only the fallback: loadCanonicalSpecForGeneration
-- (lib/nuanced-analysis-spec.load.ts) reads the stored spec row whenever it
-- validates, and that row is what every packet is generated from and what
-- Edit Template shows. Changing the code alone would change nothing that is
-- generated, so the stored rule is changed here, to the same text as the new
-- default.
--
-- Only the `rule` text of the entry whose id is copy-clevs-marks changes;
-- its id, the spec_version and every other rule are left alone. Where the
-- rule no longer mentions "Clev's Marks" -- the teacher has reworded it --
-- nothing matches and the row is unchanged. Packets already generated keep
-- the wording they were printed with; scripts/na_derive_anchors.py reads
-- both spellings off a printed page.

update public.nuanced_analysis_specs s
set spec = jsonb_set(
  s.spec,
  array['voiceAndCopy', 'copyRules', r.idx::text, 'rule'],
  to_jsonb(replace(r.rule, 'Clev''s Marks', 'ClevMarks'))
)
from (
  select sp.id, e.ord - 1 as idx, e.r ->> 'rule' as rule
  from public.nuanced_analysis_specs sp,
       jsonb_array_elements(sp.spec #> '{voiceAndCopy,copyRules}') with ordinality as e(r, ord)
  where e.r ->> 'id' = 'copy-clevs-marks'
    and e.r ->> 'rule' like '%Clev''s Marks%'
) r
where s.id = r.id;
