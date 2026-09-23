-- KA1 Unit 1 (Grade 9 Standard Level): the mark scheme text of 2(a) and 6(d)
-- brought into line with the rulings already in their marking notes.
--
-- Students now read this text while they self-assess (the student mark
-- scheme page, and the same text under each part of the self-grade form),
-- and on these two parts it was stricter than the marking: 2(a) said the
-- first term 88 AND the change of -6 were both needed, where the ruling
-- awards the mark for the change alone; 6(d) said a bare "k is not a
-- multiple of 3" earns 1, where the ruling gives 2 to any conclusion framed
-- in threes. A student following the page claimed fewer marks than Clev's
-- Marks gave, and the Compare step showed a disagreement they could not
-- explain from the scheme.
--
-- The marking does not change: the grader already follows marking_notes where
-- they conflict with the scheme, and the notes are untouched. 6(d) keeps its
-- "3 marks: one for ..., one for ..., one for ..." line, because that is what
-- the grader itemises into R1-R3 (section 2 of the Standard Level policy),
-- and states the ruling after it.
--
-- Each update only applies over the exact text it replaces (md5 of the old
-- markscheme_text), so an edit made in the meantime is never overwritten.
-- platform/lib/fixtures/g9-standard-ka1-unit1.ts is NOT updated: it already
-- differs from the live rows on 7(d), 8 and 9(a)-(c), and is not read at
-- runtime.

update public.test_items
set markscheme_text = 'A full-mark response gives how the sequence changes: it goes down by 6 each term (a change of $-6$). The question asks for the first term as well, and "starts at 88 and goes down by 6" is the complete description, but the mark is for the change: "it goes down by 6" earns it on its own, in any wording, and so does a correct change of $-6$ given with a wrong first term. "Starts at 88" alone, a change of the wrong size or sign ("goes up by 6", "subtracts 8"), or only continuing the list of terms ($88, 82, 76, 70, 64, 58, \ldots$) earns 0.'
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 2 and part_label = 'a'
  and md5(markscheme_text) = '0297e82aacad1108c5c303334a202456';

update public.test_items
set markscheme_text = 'A full-mark response gives the general rule with reasons: each group of three terms adds to 0, so the sum of the first $k$ terms is 0 when $k$ is a multiple of 3, and $-3$ when $k$ is one or two more than a multiple of 3 (the leftover terms are $-3$, or $-3 + 0$). So $k$ is NOT a multiple of 3 (accept: $k$ leaves a remainder of 1 or 2 when divided by 3; $k = 3m + 1$ or $3m + 2$). 3 marks: one for the observation that each cycle of three sums to 0, one for identifying which leftover positions give $-3$ (the 1st or 2nd term of a cycle), one for the correct general conclusion about $k$ with that reason. Any conclusion stated in terms of multiples of 3 (groups of three, "every third term", dividing $k$ by 3) shows the three-term structure and earns the first two marks, even with nothing else written and even the wrong way round ("$k$ must be a multiple of 3"). The third mark needs the correct conclusion, that $k$ is NOT a multiple of 3, together with the reason: each cycle sums to 0 and the leftover terms are $-3$ or $-3 + 0$. So a bare "$k$ is not a multiple of 3" with no reasoning earns 2, a conclusion the wrong way round earns at most 2, and a response that only lists examples ($k = 1, 2, 4, 5, 7, 8$) without the general rule earns at most 2. A response that says nothing about threes earns the first two marks only if it shows that structure some other way.'
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 6 and part_label = 'd'
  and md5(markscheme_text) = '4e7313d7d12edd061702ac404191aa80';
