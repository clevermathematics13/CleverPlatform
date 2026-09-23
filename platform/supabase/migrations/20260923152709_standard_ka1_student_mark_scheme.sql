-- Give Grade 9 Standard Level Key Assessment 1 (Unit 1, 9D) a student mark
-- scheme for self-assess, as 20260922182232 did for Grade 9 Extended's.
--
-- tests.mark_scheme_url is what puts the "Mark Scheme" button on the
-- self-grade form (components/reflection/NativeForm.tsx). This paper was
-- imported from its PDFs, not written in the Formative Assessment creator,
-- so it has no tests.custom_content for app/api/tests/[id]/mark-scheme to
-- walk; that route now builds the student page from its test_items instead
-- -- each part's markscheme_text, never its marking_notes.
--
-- Deliberately NOT unhidden here. The test stays hidden until that route
-- is deployed: unhiding first would put the paper in 9D's self-assess list
-- with a Mark Scheme button that fails, and submitting a self-assessment is
-- what reveals Clev's Marks, so a student who self-graded without the scheme
-- could not then do it properly. Releasing it is the "Hide this exam from
-- student reflection dropdown" checkbox on the Tests page, or
--   update tests set hidden = false
--   where id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001';

update tests
set mark_scheme_url = '/api/tests/a1c0f4e2-9d00-4b7e-8c21-000000000001/mark-scheme'
where id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001';
