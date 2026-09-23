-- KA1 Unit 1 (Grade 9 Standard Level): 6(d)'s marking note tidied after
-- 20260923163545 rewrote the part's mark scheme to state its ruling.
--
-- The note said a bare "k is not a multiple of 3" earns 2, "not the 1 the
-- scheme states", and that "the scheme's other cap is unchanged". The scheme
-- now says 2 itself, so both phrases described a disagreement that no longer
-- exists. Only those two phrases change; every ruling in the note, and so
-- every mark the grader gives on 6(d), is the same.
--
-- Applies only over the exact note it replaces (md5 of the old
-- marking_notes), so an edit made in the meantime is never overwritten.

update public.test_items
set marking_notes = 'Ruling on responses framed in terms of threes. Any answer that expresses its conclusion in terms of multiples of three / divisibility by $3$ (groups of three, "every third term", "$k$ divided by $3$") has recognised the three-term cycle structure and that the position within the cycle is what matters: award R1 and R2, i.e. $2$ marks, even when nothing else is written down and even when the direction is stated backwards ("$k$ must be divisible by $3$"). Do not drop these two marks because the divisibility statement is inverted.

R3 is the only mark that tests the direction and the general reason. Award it only for the correct conclusion that $k$ is NOT a multiple of $3$ (or $k = 3m + 1$ or $3m + 2$, or "$k$ leaves remainder $1$ or $2$ on division by $3$") supported by the reason that each cycle of three sums to $0$ and the leftover terms are $-3$ or $-3 + 0$. An inverted conclusion earns R3 $= 0$, so the ceiling for such a script is $2$ of $3$.

For consistency with the ruling above, a bare correct "$k$ is not a multiple of $3$" with no reasoning earns $2$ (R1 and R2), as the scheme states; the third mark still requires the reason to be given. A response that only lists examples ($k = 1, 2, 4, 5, 7, 8$) without any general rule earns at most $2$. A response that says nothing about threes at all -- no cycle, no groups, no divisibility -- earns R1 and R2 only if that structure is visible some other way, and otherwise $0$ for them.

Maximum remains $3$.'
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 6 and part_label = 'd'
  and md5(marking_notes) = '7e7b229ea107efaf1e3f4a595e5038d2';
