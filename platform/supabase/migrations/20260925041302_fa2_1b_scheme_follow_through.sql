-- Formative Assessment 2 (Grade 9 Standard Level, 9D), Q1(b): say plainly
-- that the last of the three marks is follow-through.
--
-- The seed (20260925040451) defined it as "working correctly to the end,
-- -5" and then said one carried sign error earns 2. A marking pass over a
-- synthetic script, through the request the platform sends, read the first
-- sentence over the second: -8 - 3(-1) = -8 - 3 = -11 came back 1 of 3, at
-- high confidence, with the note "one sign error carried correctly earns 1
-- mark per the scheme". The mark now reads as finishing the arithmetic from
-- the student's own line, and the scheme names which two marks that script
-- keeps. The marking it describes is unchanged. No student has been marked
-- on this paper yet.
--
-- Guarded by the md5 of the text it replaces, so a scheme the teacher has
-- since edited is left alone, and checked against the md5 of the text it
-- writes, which is platform/lib/fixtures/g9-standard-fa2.ts's.

update public.test_items
set markscheme_text = 'A full-mark response substitutes $x = -2$ in both places and keeps track of the negatives: $4(-2) - 3(-2 + 1) = -8 - 3(-1) = -8 + 3 = -5$. Answer: $-5$. 3 marks: one for the substitution, $4(-2) - 3(-2 + 1)$; one for the bracket term worked out with the right sign, $-3(-1) = +3$; one for finishing the arithmetic correctly from the student''s own line, which gives $-5$ when the sign is right. That last mark is follow-through, so one sign error costs only the sign mark: $-8 - 3(-1) = -8 - 3 = -11$ earns 2 of 3 (the substitution mark and the finishing mark), and so does expanding $-3(x + 1)$ as $-3x + 3$ and correctly reaching 1. Simplifying first is just as good: expanding $-3(x + 1)$ as $-3x - 3$ earns the sign mark ($4x - 3x - 3 = x - 3$), substituting to get $-2 - 3$ earns the substitution mark, and $-5$ the finishing mark. The paper''s instructions say "Show all work", so a bare $-5$ earns 1, for the value.'
where test_id = '739386b4-9b96-4695-8978-bc8ef8370d0c' and question_number = 1 and part_label = 'b'
  and md5(markscheme_text) = '708e820d3139eaf0235730ffea306fea';

do $check$
begin
  if not exists (
    select 1 from public.test_items
    where test_id = '739386b4-9b96-4695-8978-bc8ef8370d0c' and question_number = 1 and part_label = 'b'
      and md5(markscheme_text) = 'eaf929bd86bb778cd0c50bf0d41889ba'
  ) then
    raise exception 'Formative Assessment 2 Q1(b): the live scheme is not the seed''s text, so it was left alone; check it by hand';
  end if;
end
$check$;
