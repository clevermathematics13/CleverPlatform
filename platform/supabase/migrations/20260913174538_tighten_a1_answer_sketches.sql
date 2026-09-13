-- Tighten A.1's answer sketches so the student answers view reads as answers.
--
-- na_anchors.answer_sketch has three readers, and this change is safe only
-- because of which one it is not:
--
--   1. lib/na-assessment builds the AI marking prompt from
--      `questionAnswer || answerSketch` -- the sketch is the key the model
--      marks against ONLY where question_answer is null. Every anchor updated
--      below has question_answer set, so none of this text has ever reached
--      the grader and none of it reaches it now. The four A.1 anchors where
--      the sketch IS the grading key (Q3, Q4, Q29, Q30) are deliberately not
--      touched; they are also the four the student view never shows, because
--      their rubric rows carry no answer_key.
--   2. /dashboard/na-review/[anchorId] shows the sketch to a teacher as
--      "Answer key". Each replacement below is condensed FROM that anchor's
--      own question_answer -- the richer authored key the AI actually marks
--      against -- so the teacher's screen moves closer to what the model saw,
--      not further from it. Marking guidance is kept wherever the authored key
--      states it (Q14's expansion line, Q18's diagram route).
--   3. The student answers view added in #201, which is what prompted this.
--
-- Three kinds of fix, all of them sourced from question_answer:
--
--   * Boxes that shared one blob now answer their own part. Q6/Q6(f),
--     Q7/Q7(b), Q13/Q13(b)/Q13(c), Q19/Q19(b)/Q19(c) and Q26(a)/(b)/(c) each
--     repeated the whole question's text in every box, so a student reading
--     three boxes read the same paragraph three times and a teacher marking
--     part (b) was shown (a) and (c) as well.
--   * Pointers become answers. Q6 said "same structure as Q5 for the harder
--     expression" and Q10 described a generic picture; neither answered the
--     question it was attached to. Q9 carried a garbled half-row --
--     "(2,4)... [row reads 1 adult, total 180 -> c=4]" -- where the authored
--     key simply has (4,4) -> 360.
--   * Text that belongs to another column comes out. Q13 and Q19 restated
--     their misconception_context inside the sketch, which the review screen
--     already shows separately as "Planted-error target" and the grading
--     prompt already receives as its own section.
--
--   * Q1(e) is the smallest change and the one with history: the sketch read
--     "they agree", which is prescriptive, where the authored key says
--     "Accept any observation that (c) and (d) agree". lib/na-assessment
--     records a real student marked down against the former who should have
--     passed against the latter. The grader already prefers the permissive
--     wording; this stops the teacher's own screen from showing the other one.
--
-- 5833 characters of sketch become 2721 across 26 anchors. Nothing removed is
-- lost: every fact still stands in question_answer or misconception_context.


update na_anchors set answer_sketch = '(c) 750 (d) 30 x 25 = 750 (e) any observation that (c) and (d) agree.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q1(e)';

update na_anchors set answer_sketch = '(a) 4 terms (b) pi, pi r^2, -(1/3)r^3 h, -6x (c) pi, -1/3, -6 (d) pi (e) r, h, x.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q6';

update na_anchors set answer_sketch = '(f) pi is a fixed number, about 3.14159, that cannot take another value; r and h can.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q6(f)';

update na_anchors set answer_sketch = '(a) any eight of 1,2,3,4,5,6,10,12,15,20,30,60, and the same twelve each multiplied by a.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q7';

update na_anchors set answer_sketch = '(b) 24. 60 = 2^2 x 3 x 5 has (2+1)(1+1)(1+1) = 12 divisors, and each factor of 60a either includes a or does not, so 12 x 2 = 24.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q7(b)';

update na_anchors set answer_sketch = '(a) the price of one adult ticket, $60 (b) the number of adult tickets (c) total spent on adult tickets (d) on child tickets (e) on all tickets.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q8';

update na_anchors set answer_sketch = '(2,3) -> 210; (5,0) -> 300; (1,4) -> 180; (4,4) -> 360; (0,9) -> 270.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q9';

update na_anchors set answer_sketch = 'Adult rectangle 4 wide, 6 tall = 24 squares = $240. Child rectangle 6 wide, 3 tall = 18 squares = $180. Total $420. Heights carry the price.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q10';

update na_anchors set answer_sketch = 'The combined area is the group''s total cost. Side by side matches the + because the two amounts are added, not combined -- the areas do not overlap.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q11';

update na_anchors set answer_sketch = '(a) 5 - 12 = -7, and you cannot buy -7 packages. The correct value is 7.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q13';

update na_anchors set answer_sketch = '(b) the order of the subtraction was reversed.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q13(b)';

update na_anchors set answer_sketch = '(c) ''fewer than'' reverses the order the quantities are heard in -- find the starting amount first, it always goes at the front.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q13(c)';

update na_anchors set answer_sketch = '2.50(p-5) + 3.00p = 2.50p - 12.50 + 3.00p = 5.50p - 12.50. Full marks require the expansion line to be visible.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q14';

update na_anchors set answer_sketch = '(a) fifteen more than six times a number (b) six times the result of adding fifteen to a number (c) 6n+15 vs 6n+90: always 75 apart, never equal.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q15';

update na_anchors set answer_sketch = '30(2a+c) = 30 x 2a + 30 x c = 60a + 30c, equivalent for every a and c. The diagram route (re-cutting Q10 into 30-tall strips) is equally acceptable.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q18';

update na_anchors set answer_sketch = '(a) the true total is 150; the student''s 90ac gives 180.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q19';

update na_anchors set answer_sketch = '(b) they added the coefficients and multiplied the variables, treating unlike terms as like.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q19(b)';

update na_anchors set answer_sketch = '(c) factoring removes a common factor without combining terms; this combined unlike terms illegally.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q19(c)';

update na_anchors set answer_sketch = 'k must divide gcd(60,30) = 30, so k is one of 2, 3, 5, 6, 10, 15, 30.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q20';

update na_anchors set answer_sketch = '2a+c counts the $30 units the group buys: one adult is worth two child tickets, so any group can be priced by counting units and multiplying by 30.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q21';

update na_anchors set answer_sketch = '60a+30c=570 -> 30(2a+c)=570 -> 2a+c=19, so a runs 0 to 9: (0,19),(1,17),(2,15),(3,13),(4,11),(5,9),(6,7),(7,5),(8,3),(9,1).'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q24';

update na_anchors set answer_sketch = 'Every total is 30(2a+c), a multiple of 30; 575 is not, so no whole-number combination gives exactly $575.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q25';

update na_anchors set answer_sketch = 'Ten separate points satisfying 2a+c=19: (0,19),(1,17),(2,15),(3,13),(4,11),(5,9),(6,7),(7,5),(8,3),(9,1). Points only, no connecting line.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q26(a)';

update na_anchors set answer_sketch = '(b) a straight, evenly spaced line of separate dots -- down 2 for every 1 across -- not a continuous line.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q26(b)';

update na_anchors set answer_sketch = '(c) a=2.5 satisfies the equation but not the situation: half an adult cannot enter the park.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q26(c)';

update na_anchors set answer_sketch = 'a+c=5 and 60a+30c <= 210. Substituting c=5-a gives 30a <= 60, so a is 0, 1 or 2.'
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff' and qid = 'Q27';