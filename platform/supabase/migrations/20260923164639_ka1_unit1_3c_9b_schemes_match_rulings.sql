-- KA1 Unit 1 (Grade 9 Standard Level): the mark scheme text of 3(c) and 9(b)
-- brought into line with the rulings already in their marking notes, as
-- 20260923163545 did for 2(a) and 6(d).
--
-- Students read this text while they self-assess, and on these two parts it
-- named less than the marking accepts: 3(c) listed only separating odd and
-- even positions, or a rule for the even positions, as "using the
-- structure", where the ruling also counts listing the terms and the
-- alternating -1 then +4 step, even when the arithmetic goes wrong; 9(b)
-- asked for an explanation from the structure, where the ruling accepts a
-- sketch of Figure 5 showing about 16 tiles with no words at all.
--
-- The marking does not change: the grader already follows marking_notes where
-- they conflict with the scheme, and the notes are untouched. 3(c) keeps its
-- "2 marks: one for ..., one for ..." line, which is what the grader itemises
-- (section 2 of the Standard Level policy); 9(b) is one mark, whose
-- criterion is the descriptor itself.
--
-- Each update only applies over the exact text it replaces (md5 of the old
-- markscheme_text), so an edit made in the meantime is never overwritten.
-- platform/lib/fixtures/g9-standard-ka1-unit1.ts is not updated; see HANDOFF
-- section 26 on why it no longer matches the live paper.

update public.test_items
set markscheme_text = 'A full-mark response uses the structure of the sequence to find the 40th term: the even-position terms are 11, 14, 17, ... (start 11, add 3), so the 40th term is the 20th even term, $11 + 3(19) = 68$. Answer: 68. 2 marks: one for using the structure, one for the correct value. The structure mark is for any working that shows how the pattern moves: separating odd and even positions, a rule for the even positions, listing the terms, or the alternating step itself ($-1$ then $+4$, "take away 1, then add 4", written on the list or used to build the terms). It is earned even if the arithmetic then goes wrong. The value mark is for 68 only. So listing all 40 terms correctly earns both marks, and a list or pattern that shows the structure but goes off track earns 1.'
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 3 and part_label = 'c'
  and md5(markscheme_text) = 'e23737f95dcd3adda8e6b2125dd577aa';

update public.test_items
set markscheme_text = 'A full-mark response gives 16 squares, explained from the structure: Figure 3 has 10, so Figure 4 has 13 and Figure 5 has 16 (adding 3 each time), or from a row of 11 and a line of 5 meeting it. Answer: 16. A sketch of Figure 5 on the grid counts as the explanation: a drawing that shows about 16 tiles (typically a row of 11 with a line of 5 meeting it) earns the mark with no words, even if the hand-drawn squares cannot be counted exactly, and without writing 16 or the $+3$ separately. A sketch that clearly shows a different number of tiles (13, which is Figure 4, or a count well away from 16) earns 0. Follow-through: an answer that follows consistently from a wrong description in part (a) earns the mark.'
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 9 and part_label = 'b'
  and md5(markscheme_text) = '973e700ff39009338f3c9f3509f722e2';
