import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  StandardsAssessmentDraftSchema,
  hasBlockingFindings,
  validateStandardsDraft,
} from "@/lib/standards-import";

/**
 * POST /api/standards-assessments
 *   Body: { courseId, draft: StandardsAssessmentDraft, hidden?: boolean }
 *   -> { testId, findings }
 *
 * Saves a reviewed Standard Level draft (from POST .../extract, edited on the
 * importer page) as a gradeable test: one `tests` row carrying the strand
 * rubric, and one `test_items` row per part with its question and mark
 * scheme inline (`source = 'custom'`), which lib/ai-grading.ts's
 * assembleMarkScheme reads directly.
 *
 * Always a new test. There is no upsert here on purpose: students' marks hang
 * off test_items rows by id, and re-saving a draft over a test that has been
 * marked would orphan them. Editing an existing test's rubric is
 * PUT /api/tests/[id]/standards-rubric; its parts are not editable once
 * marks exist, the same rule the test detail page states.
 *
 * Summative, self-assessment required, no boundary set: a Standard Level
 * paper reports performance levels from its rubric, not a 1-7 level. Hidden
 * from students by default, so the teacher decides when it appears in their
 * reflection list.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const body = (await req.json().catch(() => null)) as
    | { courseId?: unknown; draft?: unknown; hidden?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "courseId is required and must be a UUID" }, { status: 400 });
  }

  const parsed = StandardsAssessmentDraftSchema.safeParse(body.draft);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `The draft is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` },
      { status: 400 }
    );
  }
  const draft = parsed.data;

  const findings = validateStandardsDraft(draft);
  if (hasBlockingFindings(findings)) {
    return NextResponse.json(
      { error: "The draft has problems that would make it ungradeable. Fix them and save again.", findings },
      { status: 422 }
    );
  }

  const totalMarks = draft.items.reduce((s, it) => s + it.maxMarks, 0);

  const { data: test, error: testError } = await supabase
    .from("tests")
    .insert({
      name: draft.name,
      course_id: courseId,
      teacher_id: profile.id,
      test_date: draft.testDate,
      total_marks: totalMarks,
      assessment_kind: "summative",
      require_self_assessment: true,
      hidden: body.hidden === undefined ? true : body.hidden === true,
      standards_rubric: draft.rubric,
    })
    .select("id")
    .single();
  if (testError || !test) {
    return NextResponse.json({ error: testError?.message ?? "Failed to create the test" }, { status: 500 });
  }

  const rows = draft.items.map((it, i) => ({
    test_id: test.id,
    question_number: it.questionNumber,
    part_label: it.partLabel,
    max_marks: it.maxMarks,
    // A whole-question item's text is already question_text; the column
    // comment on test_items.stem_text reserves it for lettered parts.
    stem_text: it.partLabel ? (it.stemText ?? null) : null,
    question_text: it.questionText,
    markscheme_text: it.markschemeText,
    source: "custom",
    sort_order: i,
  }));
  const { error: itemsError } = await supabase.from("test_items").insert(rows);
  if (itemsError) {
    // A test with no parts is worse than no test: it would list as gradeable
    // and grade nothing. Take it back out.
    await supabase.from("tests").delete().eq("id", test.id);
    return NextResponse.json({ error: `Could not save the parts: ${itemsError.message}` }, { status: 500 });
  }

  return NextResponse.json({ testId: test.id, findings });
}
