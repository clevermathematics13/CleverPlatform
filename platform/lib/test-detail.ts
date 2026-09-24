/**
 * The columns GET /api/tests/[id] serves for one test, with its parts. The
 * AI-grade page reads the same row on the server for its first render, and
 * one select for both is what keeps that render and a later refresh through
 * the route showing the same test.
 *
 * courses!tests_course_id_fkey, not a bare courses(name) -- see
 * app/dashboard/tests/page.tsx for why the bare form fails.
 */
export const TEST_DETAIL_SELECT = `
  id, name, short_name, test_date, exam_time, release_at, total_marks, course_id, hidden, hidden_from_gradebook, custom_content, require_self_assessment,
  boundary_set_id, paper_url, mark_scheme_url, assessment_kind, standards_rubric,
  courses!tests_course_id_fkey(name),
  test_items(id, question_number, part_label, max_marks, subtopic_codes, sort_order, stem_text, question_text, marking_notes)
`;
