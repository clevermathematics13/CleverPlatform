-- 063: create the "27AH [L00] P2 BiStats" saved exam in ExamBuilder's own
-- storage shape, from the teacher-provided spreadsheet cross-checked against
-- the real exam PDF. hasQuestion/hasMarkscheme reflect current DB state
-- (images extracted but not yet OCR'd to LaTeX -- see migrations 061/062)
-- and should be re-synced once extraction/OCR is complete in the UI.

INSERT INTO public.saved_exams (id, teacher_id, name, curriculum, level, paper, course_id, exam_date, questions)
VALUES (
  gen_random_uuid(),
  '702750f6-be43-47d2-a422-a2f15b4d0bf9',
  '27AH [L00] P2 BiStats',
  'AA',
  'HL',
  2,
  '7abac7b1-2cf6-4c94-a12b-3e083ed139c3',
  '2026-06-19',
  '[
    {
      "id": "6287542d-93d4-41a0-9670-590c2da4473a",
      "code": "21N.2.AHL.TZ0.H_1",
      "marks": 7,
      "section": "A",
      "curriculum": ["AA"],
      "answerBoxMm": null,
      "hasQuestion": true,
      "hasMarkscheme": true,
      "partSubtopics": [{"partLabel": "", "codes": ["4.4"]}],
      "subtopicCodes": ["4.4"]
    },
    {
      "id": "879d01e0-5be1-402c-a3f5-92350a2f826a",
      "code": "15M.2.SL.TZ1.S_1",
      "marks": 7,
      "section": "A",
      "curriculum": ["AA"],
      "answerBoxMm": null,
      "hasQuestion": true,
      "hasMarkscheme": true,
      "partSubtopics": [{"partLabel": "", "codes": ["4.4"]}],
      "subtopicCodes": ["4.4"]
    },
    {
      "id": "53d5f42c-f9ce-424f-ad5b-20538670d75a",
      "code": "21M.2.SL.TZ2.S_1",
      "marks": 6,
      "section": "A",
      "curriculum": ["AA"],
      "answerBoxMm": null,
      "hasQuestion": true,
      "hasMarkscheme": true,
      "partSubtopics": [{"partLabel": "", "codes": ["4.4"]}],
      "subtopicCodes": ["4.4"]
    },
    {
      "id": "4fb4718b-1588-40e1-80fa-04584f05b6f6",
      "code": "18M.2.SL.TZ1.S_8",
      "marks": 13,
      "section": "B",
      "curriculum": ["AA"],
      "answerBoxMm": null,
      "hasQuestion": true,
      "hasMarkscheme": true,
      "partSubtopics": [
        {"partLabel": "a", "codes": ["4.4"]},
        {"partLabel": "b", "codes": ["4.4"]},
        {"partLabel": "c", "codes": ["4.4"]}
      ],
      "subtopicCodes": ["4.4"]
    }
  ]'::jsonb
);;
