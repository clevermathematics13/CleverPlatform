-- Key Assessment 1, Unit 1 (test a1c0f4e2-9d00-4b7e-8c21-000000000001) was seeded
-- by 20260915165036 with each multi-part question's shared lead-in pasted into
-- every part's question_text and stem_text left null: the column
-- (20260915122310) already existed, the seed simply did not use it. The
-- AI-grade marking screen now shows the stem
-- as its own minimised block on every part's Expand panel, which needs it in
-- stem_text; and the row header, which prints the stem once per question,
-- was printing nothing for this paper.
--
-- Moves the lead-in of Q2, Q3, Q4, Q6, Q7 and Q9 into stem_text and leaves the
-- part's own wording in question_text. What the marker reads is unchanged:
-- lib/ai-grading.ts composeQuestionText joins stem_text and question_text
-- with a blank line when it builds the grading unit.
--
-- Q1 is left alone on purpose. Its lead-in ("Evaluate the algebraic
-- expression for the given variable value. Show all work.") is the command
-- each part's mark depends on -- a bare value with no substitution earns 0 --
-- and rule A6 of lib/ask-what-you-mark.ts says a demand made only in a stem
-- does not carry into a part. Q5 and Q8 have no parts.
--
-- Idempotent: each update matches only rows whose stem_text is still null
-- and whose question_text still begins with the stem. The fixture
-- lib/fixtures/g9-standard-ka1-unit1.ts mirrors the rows as they stand
-- after this runs.

update public.test_items
set stem_text = 'Consider the sequence: position 1, 2, 3, 4, 5, ... has terms 88, 82, 76, 70, 64, ...',
    question_text = ltrim(substr(question_text, length('Consider the sequence: position 1, 2, 3, 4, 5, ... has terms 88, 82, 76, 70, 64, ...') + 1))
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 2
  and stem_text is null
  and starts_with(question_text, 'Consider the sequence: position 1, 2, 3, 4, 5, ... has terms 88, 82, 76, 70, 64, ... ');

update public.test_items
set stem_text = 'Consider the alternating sequence: position 1, 2, 3, 4, 5, 6, 7, ... has terms 12, 11, 15, 14, 18, 17, 21, ...',
    question_text = ltrim(substr(question_text, length('Consider the alternating sequence: position 1, 2, 3, 4, 5, 6, 7, ... has terms 12, 11, 15, 14, 18, 17, 21, ...') + 1))
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 3
  and stem_text is null
  and starts_with(question_text, 'Consider the alternating sequence: position 1, 2, 3, 4, 5, 6, 7, ... has terms 12, 11, 15, 14, 18, 17, 21, ... ');

update public.test_items
set stem_text = 'Maya buys a city commuter bus pass. The pass card costs a one-time fee of $10, paid in week 1. She then pays $4 per day to ride the bus on weekdays (Mon-Fri; no bus Sat or Sun).',
    question_text = ltrim(substr(question_text, length('Maya buys a city commuter bus pass. The pass card costs a one-time fee of $10, paid in week 1. She then pays $4 per day to ride the bus on weekdays (Mon-Fri; no bus Sat or Sun).') + 1))
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 4
  and stem_text is null
  and starts_with(question_text, 'Maya buys a city commuter bus pass. The pass card costs a one-time fee of $10, paid in week 1. She then pays $4 per day to ride the bus on weekdays (Mon-Fri; no bus Sat or Sun). ');

update public.test_items
set stem_text = 'Consider the repeating sequence: position 1, 2, 3, 4, 5, 6, 7, 8, 9, ... has terms $-3, 0, 3, -3, 0, 3, -3, 0, 3, \ldots$ (the block $-3, 0, 3$ repeats forever).',
    question_text = ltrim(substr(question_text, length('Consider the repeating sequence: position 1, 2, 3, 4, 5, 6, 7, 8, 9, ... has terms $-3, 0, 3, -3, 0, 3, -3, 0, 3, \ldots$ (the block $-3, 0, 3$ repeats forever).') + 1))
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 6
  and stem_text is null
  and starts_with(question_text, 'Consider the repeating sequence: position 1, 2, 3, 4, 5, 6, 7, 8, 9, ... has terms $-3, 0, 3, -3, 0, 3, -3, 0, 3, \ldots$ (the block $-3, 0, 3$ repeats forever). ');

update public.test_items
set stem_text = 'The 84 students in fifth grade are gathering in the auditorium. The teachers choose $x$ students to perform a skit, and then split the remaining students into equal groups of 5 for a project activity.',
    question_text = ltrim(substr(question_text, length('The 84 students in fifth grade are gathering in the auditorium. The teachers choose $x$ students to perform a skit, and then split the remaining students into equal groups of 5 for a project activity.') + 1))
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 7
  and stem_text is null
  and starts_with(question_text, 'The 84 students in fifth grade are gathering in the auditorium. The teachers choose $x$ students to perform a skit, and then split the remaining students into equal groups of 5 for a project activity. ');

update public.test_items
set stem_text = 'Look at the pattern made from arrangements of $1 \times 1$ square tiles. [Marker''s note, describing the figures PRINTED on the paper. The student read no such sentence, so none of its words are required in any answer: Figure 1 is a row of 3 tiles with 1 further tile meeting the row at its centre (4 tiles); Figure 2 is a row of 5 with a line of 2 (7 tiles); Figure 3 is a row of 7 with a line of 3 (10 tiles).]',
    question_text = ltrim(substr(question_text, length('Look at the pattern made from arrangements of $1 \times 1$ square tiles. [Marker''s note, describing the figures PRINTED on the paper. The student read no such sentence, so none of its words are required in any answer: Figure 1 is a row of 3 tiles with 1 further tile meeting the row at its centre (4 tiles); Figure 2 is a row of 5 with a line of 2 (7 tiles); Figure 3 is a row of 7 with a line of 3 (10 tiles).]') + 1))
where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
  and question_number = 9
  and stem_text is null
  and starts_with(question_text, 'Look at the pattern made from arrangements of $1 \times 1$ square tiles. [Marker''s note, describing the figures PRINTED on the paper. The student read no such sentence, so none of its words are required in any answer: Figure 1 is a row of 3 tiles with 1 further tile meeting the row at its centre (4 tiles); Figure 2 is a row of 5 with a line of 2 (7 tiles); Figure 3 is a row of 7 with a line of 3 (10 tiles).] ');
