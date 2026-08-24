-- Step 1 of 2: insert the row with an empty-object placeholder for
-- draft_content. The real content is set in a follow-up UPDATE where the
-- ZQBACKSLASHZQ placeholder (standing in for literal backslash bytes in
-- Typst quoted-operator syntax, e.g. \"IQR\") is swapped back via
-- chr(92) BEFORE casting to jsonb -- casting straight from placeholder
-- text to jsonb fails because the swap must happen first so the backslash
-- is back in place to correctly escape the adjacent quote characters.
insert into assignment_templates (
  user_id,
  template_name,
  grade_level,
  document_kind,
  formatting_requirements,
  assignment_input,
  answer_line_height_mm,
  draft_content
)
values (
  '702750f6-be43-47d2-a422-a2f15b4d0bf9',
  'Data, Samples, and the Shape of Truth',
  'Grade 12',
  'investigation',
  '{"fontSize":11,"schoolName":"CleverPlatform Mathematics","answerStyle":"boxes","lineSpacing":"relaxed","teacherName":"","pageMarginsMm":16,"answerBoxLines":5,"numberingStyle":"numeric","includeDateLine":true,"includeNameLine":true,"includeAnswerKey":false,"includeMarksColumn":true}'::jsonb,
  '{"tone":"exam-style","title":"Data, Samples, and the Shape of Truth","topic":"Topic 4.1 — Collection of data and sampling; Topic 4.2 — Presentation of data (grouped frequency tables, histograms, quartiles, box-and-whisker plots, cumulative frequency curves, skewness and outliers)","gradeLevel":"Grade 12","challengeMix":"challenge-forward","contextNotes":"","documentKind":"investigation","learningGoals":"","questionCount":44,"includeRealWorldContext":true}'::jsonb,
  12,
  '{}'::jsonb
)
returning id;;
