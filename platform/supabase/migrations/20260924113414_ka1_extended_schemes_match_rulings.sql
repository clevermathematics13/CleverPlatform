-- Grade 9 Extended Key Assessment 1: the mark scheme text of the eleven parts
-- that carry marking notes brought into line with those notes, as
-- 20260923163545, 20260923164639 and 20260923184029 did for the Standard
-- Level paper.
--
-- Students read this text while they self-assess (the student mark scheme
-- page, and the same text under each part of the self-grade form), and on
-- every one of these parts the marking had moved away from it: more lenient
-- on 2.1(a), 2.2(a), 3.1, 3.4(a), 4.1, 4.3(b) and 4.2(a) (which every
-- student is awarded in full, as material not yet assessed in class),
-- stricter or more exact on 1.3(a), 2.1(b), 3.2(b) and 4.3(a).
--
-- This paper was written in the Formative Assessment creator, so the same
-- text lives in two places that must agree: tests.custom_content (the draft,
-- which the student page reads) and test_items.markscheme_text (which the
-- grader reads alongside marking_notes). Both are updated here, in place.
-- Re-saving through the creator would instead recreate test_items with new
-- ids and cut the accepted marks loose from them.
--
-- The marking does not change: the grader already follows marking_notes where
-- they conflict with the scheme, and the notes are untouched. Each part keeps
-- its leading M1/A1/R1 structure, which is what the grader itemises; outcomes
-- are stated in words, so the text still reads cleanly once the student page
-- strips the codes.
--
-- The block below checks that all 22 texts are still exactly the ones this
-- migration was written against and raises, applying nothing, if any has
-- changed; each update is also guarded by the md5 of the text it replaces.
-- The archived teacher mark scheme PDF (tests.mark_scheme_pdf_storage_path)
-- is not regenerated and still shows the earlier wording.

do $pre$
begin
  if false
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 3 and part_label = 'a') is distinct from '727375c354e4860bed3b8327acf0f3fe'
     or (select md5(custom_content #>> '{sections,0,questions,2,subparts,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '727375c354e4860bed3b8327acf0f3fe'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 4 and part_label = 'a') is distinct from '29762dfd56a8ef461b58a9601dcfdaf8'
     or (select md5(custom_content #>> '{sections,1,questions,0,subparts,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '29762dfd56a8ef461b58a9601dcfdaf8'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 4 and part_label = 'b') is distinct from 'e8bbb876b669d0d808eb1bbfd97d519b'
     or (select md5(custom_content #>> '{sections,1,questions,0,subparts,1,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from 'e8bbb876b669d0d808eb1bbfd97d519b'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 5 and part_label = 'a') is distinct from '7e55151b57c36762541f3853e67df3af'
     or (select md5(custom_content #>> '{sections,1,questions,1,subparts,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '7e55151b57c36762541f3853e67df3af'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 7 and part_label = '') is distinct from '44785b0ec20f9622ca11d769ac212a3c'
     or (select md5(custom_content #>> '{sections,2,questions,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '44785b0ec20f9622ca11d769ac212a3c'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 8 and part_label = 'b') is distinct from '2bd233b811dd3106130dd9428d3ddc38'
     or (select md5(custom_content #>> '{sections,2,questions,1,subparts,1,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '2bd233b811dd3106130dd9428d3ddc38'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 10 and part_label = 'a') is distinct from '3fdc3fd903323c8702e2fd9ced9f67a4'
     or (select md5(custom_content #>> '{sections,2,questions,3,subparts,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '3fdc3fd903323c8702e2fd9ced9f67a4'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 11 and part_label = '') is distinct from '523a84a78b822344c048c3a205c7f0a4'
     or (select md5(custom_content #>> '{sections,3,questions,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '523a84a78b822344c048c3a205c7f0a4'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 12 and part_label = 'a') is distinct from 'fccc03140d9c018bf2ca7584080b81d0'
     or (select md5(custom_content #>> '{sections,3,questions,1,subparts,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from 'fccc03140d9c018bf2ca7584080b81d0'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 13 and part_label = 'a') is distinct from 'd1e29c2d97fba19c355f59e0a5dbec85'
     or (select md5(custom_content #>> '{sections,3,questions,2,subparts,0,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from 'd1e29c2d97fba19c355f59e0a5dbec85'
     or (select md5(markscheme_text) from public.test_items where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 13 and part_label = 'b') is distinct from '8397b3f5acda073bab9462bc0594a33c'
     or (select md5(custom_content #>> '{sections,3,questions,2,subparts,1,markScheme}') from public.tests where id = 'ccfa0456-a7f7-4835-81d4-7983df021022') is distinct from '8397b3f5acda073bab9462bc0594a33c'
  then
    raise exception 'Extended KA1 mark scheme text changed since this migration was written; nothing applied';
  end if;
end
$pre$;

-- 1.3(a)
update public.test_items set markscheme_text = 'A1. Both parts are needed for the single mark: the inverse, $-n$ (or an equivalent such as $(-1)n$), and the value of the sum, $0$, in either order and any layout. Writing the sum only as $n + (-n)$ or $n - n$, without evaluating it to $0$, does not earn the mark.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 3 and part_label = 'a'
  and md5(markscheme_text) = '727375c354e4860bed3b8327acf0f3fe';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,0,questions,2,subparts,0,markScheme}', to_jsonb('A1. Both parts are needed for the single mark: the inverse, $-n$ (or an equivalent such as $(-1)n$), and the value of the sum, $0$, in either order and any layout. Writing the sum only as $n + (-n)$ or $n - n$, without evaluating it to $0$, does not earn the mark.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,0,questions,2,subparts,0,markScheme}') = '727375c354e4860bed3b8327acf0f3fe';

-- 2.1(a)
update public.test_items set markscheme_text = 'R1. Requires units and ''per'' or ''each'' (or ''for every''). A word such as ''cost'', ''charge'' or ''price'' supplies the units, so ''the cost per adult'' earns the mark without a dollar sign. ''\$32'' alone, ''the coefficient of a'', or an answer with no ''per'' or ''each'', such as ''\$32 for adults'', earns 0.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 4 and part_label = 'a'
  and md5(markscheme_text) = '29762dfd56a8ef461b58a9601dcfdaf8';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,1,questions,0,subparts,0,markScheme}', to_jsonb('R1. Requires units and ''per'' or ''each'' (or ''for every''). A word such as ''cost'', ''charge'' or ''price'' supplies the units, so ''the cost per adult'' earns the mark without a dollar sign. ''\$32'' alone, ''the coefficient of a'', or an answer with no ''per'' or ''each'', such as ''\$32 for adults'', earns 0.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,1,questions,0,subparts,0,markScheme}') = '29762dfd56a8ef461b58a9601dcfdaf8';

-- 2.1(b)
update public.test_items set markscheme_text = 'R1. Requires ''total'' (or an equivalent such as ''altogether'' or ''for all c children'') and the units written in the answer itself, as ''dollars'' or ''\$'': ''the total cost in dollars for the children'' earns the mark, but ''the total cost for the children'' earns 0, because the units cannot be taken from the question. ''19 times c'', or any answer that only reads the algebra aloud, earns 0, as does naming the cost of one child, even with dollars stated.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 4 and part_label = 'b'
  and md5(markscheme_text) = 'e8bbb876b669d0d808eb1bbfd97d519b';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,1,questions,0,subparts,1,markScheme}', to_jsonb('R1. Requires ''total'' (or an equivalent such as ''altogether'' or ''for all c children'') and the units written in the answer itself, as ''dollars'' or ''\$'': ''the total cost in dollars for the children'' earns the mark, but ''the total cost for the children'' earns 0, because the units cannot be taken from the question. ''19 times c'', or any answer that only reads the algebra aloud, earns 0, as does naming the cost of one child, even with dollars stated.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,1,questions,0,subparts,1,markScheme}') = 'e8bbb876b669d0d808eb1bbfd97d519b';

-- 2.2(a)
update public.test_items set markscheme_text = 'A1 for the answer $6m - 8$ or any equivalent form, such as $-8 + 6m$, $6 \times m - 8$ or $6m + (-8)$. ''8 - 6m'' (or ''-6m + 8'') is the subtraction-order reversal and earns 0.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 5 and part_label = 'a'
  and md5(markscheme_text) = '7e55151b57c36762541f3853e67df3af';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,1,questions,1,subparts,0,markScheme}', to_jsonb('A1 for the answer $6m - 8$ or any equivalent form, such as $-8 + 6m$, $6 \times m - 8$ or $6m + (-8)$. ''8 - 6m'' (or ''-6m + 8'') is the subtraction-order reversal and earns 0.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,1,questions,1,subparts,0,markScheme}') = '7e55151b57c36762541f3853e67df3af';

-- 3.1
update public.test_items set markscheme_text = 'M1 for the distributive step (6x/5) - 6 = x/2 + 1, or for multiplying every term by 10 to clear both denominators. M1 for collecting variable terms on one side and constants on the other, reaching 7x = 70 or equivalent. A1 for the answer x = 10. A bare ''x = 10'' with no working earns the answer mark only (1 of 3); no method marks are available retrospectively. Multiplying only some terms by the common denominator is the common error: no method mark for that line, but follow-through on the rest. A slip that is not conceptual (a mis-copied term, or a denominator dropped and carried forward) costs one mark only: the method marks are still earned where the working shows the right process, and the slip costs the answer mark. For example, copying x/2 as x but then collecting the terms correctly earns both method marks, and the wrong final answer loses only the answer mark.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 7 and part_label = ''
  and md5(markscheme_text) = '44785b0ec20f9622ca11d769ac212a3c';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,2,questions,0,markScheme}', to_jsonb('M1 for the distributive step (6x/5) - 6 = x/2 + 1, or for multiplying every term by 10 to clear both denominators. M1 for collecting variable terms on one side and constants on the other, reaching 7x = 70 or equivalent. A1 for the answer x = 10. A bare ''x = 10'' with no working earns the answer mark only (1 of 3); no method marks are available retrospectively. Multiplying only some terms by the common denominator is the common error: no method mark for that line, but follow-through on the rest. A slip that is not conceptual (a mis-copied term, or a denominator dropped and carried forward) costs one mark only: the method marks are still earned where the working shows the right process, and the slip costs the answer mark. For example, copying x/2 as x but then collecting the terms correctly earns both method marks, and the wrong final answer loses only the answer mark.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,2,questions,0,markScheme}') = '44785b0ec20f9622ca11d769ac212a3c';

-- 3.2(b)
update public.test_items set markscheme_text = 'M1 for multiplying EVERY term by (w - 3): (w + 1) + 4(w - 3) = 2w + 7. M1 for expanding and collecting to 3w = 18 or equivalent. A1 for the answer w = 6, supported by valid working. Multiplying the fractions but not the 4 (a line like w + 1 + 4 = 2w + 7) is the common error: no mark for the first step, then follow-through, so the second method mark is earned if that equation is collected correctly; the answer mark is for w = 6 only, so that route scores 1 of 3. An answer of w = 6 with no working, or with steps that do not lead to it, earns no answer mark.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 8 and part_label = 'b'
  and md5(markscheme_text) = '2bd233b811dd3106130dd9428d3ddc38';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,2,questions,1,subparts,1,markScheme}', to_jsonb('M1 for multiplying EVERY term by (w - 3): (w + 1) + 4(w - 3) = 2w + 7. M1 for expanding and collecting to 3w = 18 or equivalent. A1 for the answer w = 6, supported by valid working. Multiplying the fractions but not the 4 (a line like w + 1 + 4 = 2w + 7) is the common error: no mark for the first step, then follow-through, so the second method mark is earned if that equation is collected correctly; the answer mark is for w = 6 only, so that route scores 1 of 3. An answer of w = 6 with no working, or with steps that do not lead to it, earns no answer mark.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,2,questions,1,subparts,1,markScheme}') = '2bd233b811dd3106130dd9428d3ddc38';

-- 3.4(a)
update public.test_items set markscheme_text = 'M1 for all four products: 5x - 15 - x^2 + 3x. A single slip in one product (a lost sign, as in -x times -3, or a lost power, writing -x for -x times x) still earns the method mark when the other three products are correct; two or more wrong products, fewer than four products, or no expansion shown earns no method mark. A1 for the answer -x^2 + 8x - 15 exactly (accept 8x - x^2 - 15); a slipped product loses the answer mark, with no follow-through.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 10 and part_label = 'a'
  and md5(markscheme_text) = '3fdc3fd903323c8702e2fd9ced9f67a4';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,2,questions,3,subparts,0,markScheme}', to_jsonb('M1 for all four products: 5x - 15 - x^2 + 3x. A single slip in one product (a lost sign, as in -x times -3, or a lost power, writing -x for -x times x) still earns the method mark when the other three products are correct; two or more wrong products, fewer than four products, or no expansion shown earns no method mark. A1 for the answer -x^2 + 8x - 15 exactly (accept 8x - x^2 - 15); a slipped product loses the answer mark, with no follow-through.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,2,questions,3,subparts,0,markScheme}') = '3fdc3fd903323c8702e2fd9ced9f67a4';

-- 4.1
update public.test_items set markscheme_text = 'M1 for a correct distributive step, named. M1 for a correct regrouping step, named as associative and/or commutative. A1 for reaching 8x - 15 by a chain in which every line is a named legal move. Accept ''combine like terms'' or ''collect like terms'' for the step that gathers 5x and 3x -- it is the distributive property underneath, and a student who names the operation has identified the move. R1 for a closing sentence stating that the two expressions are equivalent, or equal, for example ''5(x - 3) + 3x is equivalent to 8x - 15''; it need not add ''for every value of x'', since ''equivalent'' already says that. No closing sentence, or one that only repeats the last line of algebra, earns no mark for the conclusion. A correct chain with no property names earns at most 2 of the 4 marks, for reaching 8x - 15 and for the conclusion. Substituting one or more values of x is not a proof and earns no mark for the conclusion, however many values are used.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 11 and part_label = ''
  and md5(markscheme_text) = '523a84a78b822344c048c3a205c7f0a4';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,3,questions,0,markScheme}', to_jsonb('M1 for a correct distributive step, named. M1 for a correct regrouping step, named as associative and/or commutative. A1 for reaching 8x - 15 by a chain in which every line is a named legal move. Accept ''combine like terms'' or ''collect like terms'' for the step that gathers 5x and 3x -- it is the distributive property underneath, and a student who names the operation has identified the move. R1 for a closing sentence stating that the two expressions are equivalent, or equal, for example ''5(x - 3) + 3x is equivalent to 8x - 15''; it need not add ''for every value of x'', since ''equivalent'' already says that. No closing sentence, or one that only repeats the last line of algebra, earns no mark for the conclusion. A correct chain with no property names earns at most 2 of the 4 marks, for reaching 8x - 15 and for the conclusion. Substituting one or more values of x is not a proof and earns no mark for the conclusion, however many values are used.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,3,questions,0,markScheme}') = '523a84a78b822344c048c3a205c7f0a4';

-- 4.2(a)
update public.test_items set markscheme_text = 'Not marked on its mathematics: this part covers material not yet assessed in class, so every student receives both marks, whatever is written, including a blank. For reference, the intended answer: M1 for factoring the numerator as (x - 5)(x + 5). A1 for the simplified form x + 5 together with the restriction x != 5.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 12 and part_label = 'a'
  and md5(markscheme_text) = 'fccc03140d9c018bf2ca7584080b81d0';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,3,questions,1,subparts,0,markScheme}', to_jsonb('Not marked on its mathematics: this part covers material not yet assessed in class, so every student receives both marks, whatever is written, including a blank. For reference, the intended answer: M1 for factoring the numerator as (x - 5)(x + 5). A1 for the simplified form x + 5 together with the restriction x != 5.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,3,questions,1,subparts,0,markScheme}') = 'fccc03140d9c018bf2ca7584080b81d0';

-- 4.3(a)
update public.test_items set markscheme_text = 'M1 for both reductions applied in sequence: 0.90 x 0.80c, or an equivalent that takes the second reduction from the already-reduced price, such as (c - 0.2c) - 0.1(c - 0.2c). A1 for the simplified 0.72c, written down: a correct expression left unsimplified does not earn this mark, since the question asks for it to be simplified. Subtracting the percentages in one step (c - 0.30c, or 0.70c) earns 0.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 13 and part_label = 'a'
  and md5(markscheme_text) = 'd1e29c2d97fba19c355f59e0a5dbec85';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,3,questions,2,subparts,0,markScheme}', to_jsonb('M1 for both reductions applied in sequence: 0.90 x 0.80c, or an equivalent that takes the second reduction from the already-reduced price, such as (c - 0.2c) - 0.1(c - 0.2c). A1 for the simplified 0.72c, written down: a correct expression left unsimplified does not earn this mark, since the question asks for it to be simplified. Subtracting the percentages in one step (c - 0.30c, or 0.70c) earns 0.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,3,questions,2,subparts,0,markScheme}') = 'd1e29c2d97fba19c355f59e0a5dbec85';

-- 4.3(b)
update public.test_items set markscheme_text = 'R1 for showing why the two reductions do not come to 30% off, by any one of three routes: reading 0.72c as a 28% reduction; giving the reason that the second discount is taken from the already-reduced price; or a correct comparison showing the two are different, such as ''90% of 80% of c is not 70% of c'' (0.9 x 0.8c is not 0.7c, or 0.72c is not 0.7c). Any one alone earns the mark. The part as printed asked only ''explain why the student is wrong'', so none of them can be required of an answer to it. A bare verdict with no support (''the student is wrong'', ''you cannot add the percentages'') earns 0. Follow-through from an incorrect (a) that is correctly interpreted.'
where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022' and question_number = 13 and part_label = 'b'
  and md5(markscheme_text) = '8397b3f5acda073bab9462bc0594a33c';

update public.tests set custom_content = jsonb_set(custom_content, '{sections,3,questions,2,subparts,1,markScheme}', to_jsonb('R1 for showing why the two reductions do not come to 30% off, by any one of three routes: reading 0.72c as a 28% reduction; giving the reason that the second discount is taken from the already-reduced price; or a correct comparison showing the two are different, such as ''90% of 80% of c is not 70% of c'' (0.9 x 0.8c is not 0.7c, or 0.72c is not 0.7c). Any one alone earns the mark. The part as printed asked only ''explain why the student is wrong'', so none of them can be required of an answer to it. A bare verdict with no support (''the student is wrong'', ''you cannot add the percentages'') earns 0. Follow-through from an incorrect (a) that is correctly interpreted.'::text), false)
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
  and md5(custom_content #>> '{sections,3,questions,2,subparts,1,markScheme}') = '8397b3f5acda073bab9462bc0594a33c';
