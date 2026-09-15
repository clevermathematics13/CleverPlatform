-- test_items rows for a question with subparts carried only the subpart's own
-- prompt, so a part that leans on its question's stem reached the AI marker
-- without it. Key Assessment 1 Q9(a) arrived as "Rearrange the formula to make
-- $x$ the subject. Show every step." with the formula it names stored nowhere
-- in the row, and so nowhere in the unit the model was asked to mark against.
--
-- The stem gets its own column rather than being prepended to question_text,
-- because question_text is also what lib/rubric-validator.ts checks each part
-- against: its rule 10 self-numbering check is anchored to the start of the
-- prompt, and its WORKING_COMMAND and SUBSTITUTES_VALUES patterns match words
-- a stem may legitimately contain. Folding the stem in there would have
-- silently changed every one of those answers.
--
-- Mirrors the IB-bank path, which has always kept ib_questions.stem_latex
-- separate from question_parts.content_latex and joined the two only when
-- assembling a grading unit.
alter table test_items add column stem_text text;

comment on column test_items.stem_text is
  'For a custom (source = ''custom'') item derived from a question with subparts: that question''s stem, repeated on each subpart row of that question. Null when the question had no stem, and null when the item IS the whole question, whose text is already in question_text. lib/ai-grading.ts assembleMarkScheme joins stem_text and question_text with a blank line to build the grading unit, the same way the IB path joins ib_questions.stem_latex to question_parts.content_latex. Written only by lib/formative-assessment-bridge.ts syncTestItems.';
