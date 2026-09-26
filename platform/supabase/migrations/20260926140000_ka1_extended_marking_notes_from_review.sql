-- Grade 9 Extended Key Assessment 1: marking notes for nine parts, from the
-- teacher's review of scripts that were marked from upside-down pages (24-25
-- Sep 2026).
--
-- On those pages the marker credited work that was not there -- a blank box
-- read as the scheme's answer, an erased term read as written, a 0 read as a
-- 3 -- and missed work that was: a final answer boxed after a first attempt,
-- a handwritten b read as a 6. Each ruling below settles one such call for
-- every later mark of this paper. The general reading rules now live in
-- grading_policies/reading_integrity_principles.md; these notes are the
-- part-by-part rulings behind them.
--
-- No mark changes here: this migration writes notes only. Marks already
-- accepted stay as they are, and a ClevMark is never lowered once the student
-- has self-assessed (the student_marks_keep_after_self_assessment migration).
--
-- Grader-only: test_items.marking_notes is read by the marker after the
-- part's mark scheme and wins where the two conflict. Students never see it.
-- Every ruling here agrees with the scheme text students do see, so that text
-- (test_items.markscheme_text and tests.custom_content) is unchanged.
--
-- 13(a) and 13(b) already carry notes; the new rulings are appended after a
-- blank line and the existing text is kept exactly. The block below checks
-- all nine notes are still exactly the ones this was written against and
-- raises, applying nothing, if any has changed; each update is also guarded by
-- the md5 of the note it extends. The block at the end checks every note is
-- within the 4000-character limit the marking-notes route enforces, and that
-- the two existing notes survive intact at the start.

do $pre$
begin
  if (
    select count(*)
    from public.test_items
    where test_id = 'ccfa0456-a7f7-4835-81d4-7983df021022'
      and (id, md5(coalesce(marking_notes, ''))) in (
        ('48c32c63-6b55-4db0-a7f7-ab0e08feaa10'::uuid, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('b302719c-837b-4712-914a-bf9d1676964b'::uuid, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('824bb8e9-5413-4902-91ec-71152b0e5e94'::uuid, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('9205a289-c950-432c-9dd3-80b13b3f45cf'::uuid, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('8cb0b467-229a-4822-8033-34d21c692768'::uuid, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('e0222598-4ce9-4666-ae1f-22c50e845a16'::uuid, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('5120153c-6a32-4aa7-8679-6aa6fd5c4efe'::uuid, '0c4c9b6f5eac1305a99b8138e35eb5fa'),
        ('d5c8e0f7-72aa-42d1-81a1-2146f0949366'::uuid, 'f244329f8f6561eadc710bf1375c43e3'),
        ('69928076-39a3-4ddd-9e64-20704496102e'::uuid, 'd41d8cd98f00b204e9800998ecf8427e')
      )
  ) <> 9 then
    raise exception 'Extended KA1 marking notes changed since this migration was written; nothing applied';
  end if;
end
$pre$;

-- 3.2(a), question 8(a)
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$A1 only for the value 3 itself: $w = 3$, or the restriction written as $w \neq 3$. Read the digit as written: a 0, or any value other than 3, earns 0 however it is set out, and a digit that is not clearly a 3 is not read as one. A blank answer area is no response: workFound false, 0 marks, no evidence box. Never take the value from the question, the mark scheme or part (c).$note$)
where id = '48c32c63-6b55-4db0-a7f7-ab0e08feaa10'
  and md5(coalesce(marking_notes, '')) = 'd41d8cd98f00b204e9800998ecf8427e';

-- 3.2(c), question 8(c)
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$R1 needs the reason the scheme gives, in the student's own words: at the stated value the denominator $w - 3$ is zero, so the equation is undefined there. An answer that says a value such as $w = 0$ makes the equation undefined "because you would divide by 0" earns R0: at $w = 0$ the denominator $w - 3$ is $-3$, not zero, so the reason is false. Mark only the argument the student wrote. Never complete a partial sentence into the scheme's reason, and never credit a reason that is only in the scheme.$note$)
where id = 'b302719c-837b-4712-914a-bf9d1676964b'
  and md5(coalesce(marking_notes, '')) = 'd41d8cd98f00b204e9800998ecf8427e';

-- 3.3(a), question 9(a)
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$Transcribe the student's own lines before marking, and never write the scheme's lines in their place. The full three marks need both steps visible: collecting, $px - rx = s - q$, and factoring, $x(p - r) = s - q$. Dividing by $p$ alone, without factoring, is the scheme's M1M0A0 whatever form it takes: $px = rx + s - q$ followed by $x = (rx + s - q)/p$ still has $x$ on both sides, and $x = (r + s - q)/p$ has lost it. Either earns 1 mark in total.$note$)
where id = '824bb8e9-5413-4902-91ec-71152b0e5e94'
  and md5(coalesce(marking_notes, '')) = 'd41d8cd98f00b204e9800998ecf8427e';

-- 3.3(b), question 9(b)
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$A blank answer box is A0 and workFound false: never supply $p \neq r$ (or $p - r \neq 0$) from the mark scheme. Follow-through applies only from a correctly factored (a). Where (a) divided by $p$ or $r$ alone, a condition such as "they can't be 0" is not the condition on $p - r$ and earns A0; there is nothing to follow through from.$note$)
where id = '9205a289-c950-432c-9dd3-80b13b3f45cf'
  and md5(coalesce(marking_notes, '')) = 'd41d8cd98f00b204e9800998ecf8427e';

-- 3.4(b), question 10(b)
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$Mark the final answer the student indicates. A first attempt such as $7(8y - 12)$ followed by a boxed, circled or labelled $28(2y - 3)$ earns A1: the indicated answer is the complete factorisation. The scheme's examples that earn 0 apply when one of them is the final answer.$note$)
where id = '8cb0b467-229a-4822-8033-34d21c692768'
  and md5(coalesce(marking_notes, '')) = 'd41d8cd98f00b204e9800998ecf8427e';

-- 3.4(c), question 10(c)
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$Read a handwritten b as b when it is shaped like the printed italic b, which in many hands looks like a 6. A final answer that reads "$6ab^2 + 56$" is $6ab^2 + 5b$ when its last character matches the b the student writes elsewhere on the page, and earns A1. Combining $ab^2$ terms with $b$ terms still earns 0, as the scheme says.$note$)
where id = 'e0222598-4ce9-4666-ae1f-22c50e845a16'
  and md5(coalesce(marking_notes, '')) = 'd41d8cd98f00b204e9800998ecf8427e';

-- 4.3(a), question 13(a): appended to the existing note
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$Products of the discount rates, such as $(c \times 0.2) \times 0.1$, take neither reduction from a price: M0A0. An expression that contains $0.9 \times 0.8c$ but is not the final price, such as $0.8c - 0.9(0.8c)$, earns M1 for the sequential reduction and A0. $\frac{72c}{100}$ is $0.72c$ written as a fraction and earns A1.$note$)
where id = '5120153c-6a32-4aa7-8679-6aa6fd5c4efe'
  and md5(coalesce(marking_notes, '')) = '0c4c9b6f5eac1305a99b8138e35eb5fa';

-- 4.3(b), question 13(b): appended to the existing note
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$The reason that the second discount is taken from the already-reduced price earns R1 in the student's own words; the scheme's wording is not required. "After the second discount the price is less" only restates that there are two discounts and earns R0. A numerical check earns R1 only when it models both reductions correctly: comparing $50 \times 0.2 \times 0.1 = 1$ with $50 \times 0.3 = 15$ multiplies the rates, which is not the price after either discount, and earns R0.$note$)
where id = 'd5c8e0f7-72aa-42d1-81a1-2146f0949366'
  and md5(coalesce(marking_notes, '')) = 'f244329f8f6561eadc710bf1375c43e3';

-- 4.4(a), question 14(a)
update public.test_items
set marking_notes = concat_ws(E'\n\n', nullif(marking_notes, ''), $note$Mark what is written, not what was rubbed out: a term erased so that only a faint trace remains is not part of the answer. $\frac{16(n + 4)}{n}$ with the $+ 96$ rubbed out has no correct total, so it earns M0A0. A correct total with only part of it divided by $n$, such as $\frac{16(n + 4)}{n} + 96$, earns M1A0, as the scheme says.$note$)
where id = '69928076-39a3-4ddd-9e64-20704496102e'
  and md5(coalesce(marking_notes, '')) = 'd41d8cd98f00b204e9800998ecf8427e';

do $post$
begin
  if (
    select count(*)
    from public.test_items
    where id in (
        '48c32c63-6b55-4db0-a7f7-ab0e08feaa10', 'b302719c-837b-4712-914a-bf9d1676964b',
        '824bb8e9-5413-4902-91ec-71152b0e5e94', '9205a289-c950-432c-9dd3-80b13b3f45cf',
        '8cb0b467-229a-4822-8033-34d21c692768', 'e0222598-4ce9-4666-ae1f-22c50e845a16',
        '5120153c-6a32-4aa7-8679-6aa6fd5c4efe', 'd5c8e0f7-72aa-42d1-81a1-2146f0949366',
        '69928076-39a3-4ddd-9e64-20704496102e'
      )
      and length(coalesce(marking_notes, '')) between 1 and 4000
  ) <> 9 then
    raise exception 'A KA1 marking note is empty or over 4000 characters after the update';
  end if;
  if (select md5(left(marking_notes, 697)) from public.test_items where id = '5120153c-6a32-4aa7-8679-6aa6fd5c4efe') is distinct from '0c4c9b6f5eac1305a99b8138e35eb5fa'
     or (select md5(left(marking_notes, 841)) from public.test_items where id = 'd5c8e0f7-72aa-42d1-81a1-2146f0949366') is distinct from 'f244329f8f6561eadc710bf1375c43e3'
  then
    raise exception 'An existing KA1 marking note was not kept intact';
  end if;
end
$post$;
