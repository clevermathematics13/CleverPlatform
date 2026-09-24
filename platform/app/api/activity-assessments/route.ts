import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  ActivityDraftSchema,
  hasBlockingFindings,
  validateActivityDraft,
} from "@/lib/activity-import";
import { allowedActivityCourses } from "@/lib/activity-rubric";

/**
 * POST /api/activity-assessments
 *   Body: { courseId, draft: ActivityDraft, showInGradebook?: boolean }
 *   -> { testId, findings }
 *
 * Saves a reviewed Exploration or homework draft (from POST .../extract,
 * edited on the importer page) as a gradeable activity: one `tests` row
 * carrying the learning-target rubric, and one `test_items` row per part with
 * its question and answer inline (`source = 'custom'`), which
 * lib/ai-grading.ts's assembleMarkScheme reads directly.
 *
 * Always a new test, for the same reason the Standard Level save route is:
 * marks hang off test_items rows by id, and re-saving a draft over an activity
 * that has been marked would orphan them.
 *
 * FORMATIVE, no self-assessment, and OUT OF THE GRADEBOOK unless the teacher
 * says otherwise. An Exploration is sat before the lesson and being wrong on
 * it is the design; a student asked to self-assess against a mark they were
 * never meant to earn learns the wrong thing from it, and a column of those
 * marks in the grid is a grade the activity was never supposed to produce.
 * `showInGradebook: true` is the per-activity opt-in.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const body = (await req.json().catch(() => null)) as
    | { courseId?: unknown; draft?: unknown; showInGradebook?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "courseId is required and must be a UUID" }, { status: 400 });
  }

  // The course gate is enforced here as well as in the page's dropdown: the
  // dropdown is a convenience, this is the rule. See ACTIVITY_COURSE_NAMES.
  const { data: courseRows, error: courseError } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId);
  if (courseError) {
    return NextResponse.json({ error: `Could not check the course: ${courseError.message}` }, { status: 500 });
  }
  const course = (courseRows ?? [])[0];
  if (!course) {
    return NextResponse.json({ error: "That course does not exist" }, { status: 404 });
  }
  if (allowedActivityCourses([course]).length === 0) {
    return NextResponse.json(
      { error: `Explorations and homework are not set up for ${course.name} yet.` },
      { status: 422 }
    );
  }

  const parsed = ActivityDraftSchema.safeParse(body.draft);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `The draft is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` },
      { status: 400 }
    );
  }
  const draft = parsed.data;

  const findings = validateActivityDraft(draft);
  if (hasBlockingFindings(findings)) {
    return NextResponse.json(
      { error: "The draft has problems that would make it unmarkable. Fix them and save again.", findings },
      { status: 422 }
    );
  }

  const totalMarks = draft.items.reduce((s, it) => s + it.maxMarks, 0);
  const showInGradebook = body.showInGradebook === true;

  const { data: test, error: testError } = await supabase
    .from("tests")
    .insert({
      name: draft.name,
      course_id: courseId,
      teacher_id: profile.id,
      test_date: draft.activityDate,
      total_marks: totalMarks,
      assessment_kind: "formative",
      require_self_assessment: false,
      hidden: true,
      hidden_from_gradebook: !showInGradebook,
      activity_rubric: draft.rubric,
    })
    .select("id")
    .single();
  if (testError || !test) {
    return NextResponse.json({ error: testError?.message ?? "Failed to create the activity" }, { status: 500 });
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
    // An activity with no parts is worse than no activity: it would list as
    // gradeable and grade nothing. Take it back out.
    await supabase.from("tests").delete().eq("id", test.id);
    return NextResponse.json({ error: `Could not save the parts: ${itemsError.message}` }, { status: 500 });
  }

  return NextResponse.json({ testId: test.id, findings });
}
