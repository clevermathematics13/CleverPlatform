-- Formative Assessment creator/grader: lets a teacher author custom question
-- content + a free-text mark scheme directly on a test, as an alternative to
-- sourcing content from the IB question bank (ib_question_code) or an
-- external paper/mark-scheme URL.
--
-- ib_question_code was NOT NULL with no default, which meant the existing
-- manual "+ Create Test" form (app/api/tests/route.ts, which never sets this
-- column) could never have successfully inserted a test_items row. Relaxing
-- it fixes that latent bug as a side effect and is what makes a "custom"
-- item (no bank code at all) possible.
alter table test_items
  alter column ib_question_code drop not null,
  add column question_text text,
  add column markscheme_text text,
  add column source text not null default 'bank' check (source in ('bank', 'custom'));

comment on column test_items.question_text is
  'Inline teacher-authored question text, used when source = ''custom'' (not sourced from the IB question bank).';
comment on column test_items.markscheme_text is
  'Inline free-text mark scheme (M/A/R/FT-style), used when source = ''custom''. Consumed directly by lib/ai-grading.ts assembleMarkScheme() as the GradingUnit markscheme text.';
comment on column test_items.source is
  'Provenance of this item''s content: ''bank'' (default, resolved via ib_question_code against ib_questions/question_parts) or ''custom'' (inline content authored via the Formative Assessment creator).';

alter table tests
  add column custom_content jsonb;

comment on column tests.custom_content is
  'Full authored draft (title/sections/questions/marking principles/achievement bands/reteach guide) for a test created via the Formative Assessment creator. Null for tests sourced from the IB question bank or an external paper/mark-scheme URL. test_items is the lean, grading-facing projection of this for assembleMarkScheme().';
