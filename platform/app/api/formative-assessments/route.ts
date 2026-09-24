/**
 * GET  /api/formative-assessments — list the saved ones, for the creator's picker
 * POST /api/formative-assessments — save an authored assessment as a gradeable test
 *
 * Formative or summative: both are authored the same way and graded through
 * the same pipeline, and `assessmentKind` is what separates them. The rules
 * that follow from it live in lib/assessment-kind.ts -- this route is where
 * they are applied to the draft before anything else reads it.
 *
 * An assessment is authored as an AssignmentDraft (title/sections/
 * questions, each with a mark scheme — see lib/assignments.ts and
 * lib/formative-assessment-prompt.ts) but graded through the existing
 * `tests` + lib/ai-grading.ts pipeline, unmodified. This route is what
 * closes that loop: it upserts a `tests` row (storing the full draft in
 * `custom_content` so it can be reloaded and re-edited) and derives
 * `test_items` rows from it via lib/formative-assessment-bridge.ts's
 * syncTestItems() — the same non-destructive-resync pattern used by
 * lib/na-rubric-bridge.ts for Nuanced Analysis packets.
 *
 * Once saved, the returned test id works with the existing test UI
 * unchanged: /dashboard/tests/[id]/ai-grade for batch AI grading of scanned
 * student papers, and /dashboard/gradebook for recorded marks.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { syncTestItems, computeTotalMarks } from "@/lib/formative-assessment-bridge";
import {
  validateRubric,
  summarizeRubricFindings,
  shouldHoldForRubricReview,
} from "@/lib/rubric-validator";
import { archiveFormativeAssessmentPdfs } from "@/lib/formative-assessment-pdf";
import { DEFAULT_ASSESSMENT_FORMATTING } from "@/lib/formative-assessment-pdf-body";
import { FormattingRequirementsSchema } from "@/lib/template-schema";
import {
  parseAssessmentKind,
  applyKindRules,
  SUMMATIVE_FORMATTING_DEFAULTS,
  countHints,
  resolveRequireSelfAssessment,
} from "@/lib/assessment-kind";
import type { AssignmentDraft } from "@/lib/assignments";

export const runtime = "nodejs";
// Two PDFs are rendered here, sharing one browser launch. The launch dominates,
// so this is barely more than the single-PDF routes, which use the same 60s.
export const maxDuration = 60;

type SaveBody = {
  testId?: unknown;
  courseId?: unknown;
  draft?: unknown;
  requireSelfAssessment?: unknown;
  /**
   * "formative" (the default, and what every existing saved paper is) or
   * "summative". See lib/assessment-kind.ts for everything that follows from
   * it -- exam conditions on both PDFs, no hints, a required boundary set,
   * forced self-assessment, and held low-confidence AI grades.
   */
  assessmentKind?: unknown;
  /**
   * The grade boundary set the mark reports against. Required for a
   * summative: without one the gradebook falls back to generic bands and
   * shows an "~approx" badge, which is not a grade to hand back.
   */
  boundarySetId?: unknown;
  /**
   * The formatting the sandbox is previewing with. Sent so the archived PDFs
   * are the paper the teacher actually sees rather than a default-formatted
   * lookalike. Invalid or absent falls back to DEFAULT_ASSESSMENT_FORMATTING --
   * never a reason to refuse a save.
   */
  formatting?: unknown;
  /**
   * Set once the teacher has seen the rubric findings and chosen to save
   * regardless. Deliberately not a "skip validation" flag: the findings are
   * still computed and returned, so the record of what was overridden is the
   * same either way.
   */
  acknowledgeRubricFindings?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The saved Formative Assessments, newest first.
 *
 * `custom_content is not null` is what makes a test one of these: it holds the
 * authored draft, and only this route's POST ever writes it. A test sourced
 * from the IB question bank or an external paper URL has none and is not
 * editable in the creator, so listing it would offer a teacher something that
 * cannot be loaded.
 *
 * Summaries only, deliberately -- a draft is tens of KB, and the picker needs
 * a name and a date. GET [testId] fetches the one actually chosen.
 */
export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  // courses!tests_course_id_fkey, not a bare courses(name) -- see
  // app/dashboard/tests/page.tsx for why the bare form fails.
  const { data, error } = await supabase
    .from("tests")
    .select(
      `id, name, course_id, total_marks, created_at, pdfs_generated_at, assessment_kind,
       courses!tests_course_id_fkey(name),
       test_items(count)`,
    )
    .not("custom_content", "is", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const assessments = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    courseId: t.course_id,
    courseName: (t.courses as unknown as { name: string } | null)?.name ?? "Unknown",
    totalMarks: t.total_marks,
    createdAt: t.created_at,
    assessmentKind: parseAssessmentKind(t.assessment_kind),
    // Null means the archive predates PDF archiving or its last save failed to
    // write one; the picker says so rather than offering a dead download link.
    pdfsGeneratedAt: t.pdfs_generated_at,
    itemCount: (t.test_items as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));

  return NextResponse.json({ assessments });
}

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "courseId is required and must be a UUID" }, { status: 400 });
  }

  if (!body.draft || typeof body.draft !== "object") {
    return NextResponse.json({ error: "draft is required" }, { status: 400 });
  }
  const submitted = body.draft as AssignmentDraft;
  if (!submitted.title || !Array.isArray(submitted.sections) || submitted.sections.length === 0) {
    return NextResponse.json(
      { error: "draft must have a title and a non-empty sections array" },
      { status: 400 },
    );
  }

  // -- Kind, and what it does to the draft -------------------------------
  // Applied here, before anything else reads the draft, so the rubric gate,
  // the mark total, the gradeable items and both archived PDFs all see the
  // same paper. A summative loses its hints -- a printed "Hint: try
  // substituting x = 2" on a paper that counts is marks given away, and the
  // renderer prints whatever it is handed.
  const assessmentKind = parseAssessmentKind(body.assessmentKind);
  const hintsRemoved = assessmentKind === "summative" ? countHints(submitted) : 0;
  const draft = applyKindRules(assessmentKind, submitted);

  // -- Boundary set --------------------------------------------------------
  // Required for a summative and optional for a formative. Without one the
  // gradebook falls back to generic bands and shows an "~approx" badge next
  // to the level, which is a guess -- fine on practice, not on a paper a
  // student is graded by. The creator offers the PRESETS as a starting point;
  // an assessment's own boundaries are decided on its Grade boundaries page
  // and are never re-pointed from here (checked below, once the test is known).
  const boundarySetId =
    typeof body.boundarySetId === "string" && UUID_RE.test(body.boundarySetId)
      ? body.boundarySetId
      : null;

  // -- Rubric quality gate -------------------------------------------------
  // A mark scheme that contradicts itself, or asks for units it never
  // requires, is only cheap to fix before a class sits the paper. Formative
  // Assessment 1 shipped with three such defects and they were not found
  // until fifty students had been marked against them.
  //
  // This stops a first save rather than forbidding one: the teacher sees the
  // findings, and may save anyway by re-posting with
  // acknowledgeRubricFindings. Warnings never stop anything. A rubric is
  // professional judgement, so the gate's job is to make sure a defect was
  // seen -- not to overrule the person who wrote it.
  // The time allowed lives on the formatting, which is parsed further down for
  // the archive. Rule 13 needs it HERE, before the gate decides -- a paper that
  // cannot be finished in its own time allowance is exactly the kind of defect
  // this gate exists to surface, and it is invisible from the draft alone.
  const timeAllowedMinutes =
    typeof (body.formatting as { timeAllowedMinutes?: unknown } | undefined)?.timeAllowedMinutes ===
    "number"
      ? ((body.formatting as { timeAllowedMinutes: number }).timeAllowedMinutes)
      : undefined;
  const rubricFindings = validateRubric(draft, { timeAllowedMinutes });
  const rubric = { findings: rubricFindings, summary: summarizeRubricFindings(rubricFindings) };
  if (shouldHoldForRubricReview(rubricFindings, body.acknowledgeRubricFindings)) {
    return NextResponse.json(
      {
        error:
          `${rubric.summary.blocking} mark scheme issue(s) would make this paper hard to mark ` +
          "consistently. Review them, or save anyway.",
        rubric,
      },
      { status: 422 },
    );
  }

  const testId =
    typeof body.testId === "string" && UUID_RE.test(body.testId) ? body.testId : null;
  const totalMarks = computeTotalMarks(draft.sections);
  // Defaults to required (true) to match tests.require_self_assessment's own
  // column default -- every other creation path leaves this untouched. A
  // summative is not asked: students self-assess before they see the marks
  // their teacher approved, and a toggle is a thing to forget.
  const requireSelfAssessment = resolveRequireSelfAssessment(
    assessmentKind,
    body.requireSelfAssessment !== false,
  );

  // An assessment with its own boundaries keeps them: the creator never
  // re-points it at a preset. A set that belongs to another assessment is
  // never a starting point.
  let existingSetId: string | null = null;
  let hasOwnSet = false;
  if (testId) {
    const [{ data: existing }, { data: own }] = await Promise.all([
      supabase.from("tests").select("boundary_set_id").eq("id", testId).maybeSingle(),
      supabase.from("grade_boundary_sets").select("id").eq("test_id", testId).maybeSingle(),
    ]);
    existingSetId = (existing?.boundary_set_id as string | null | undefined) ?? null;
    hasOwnSet = !!own;
  }
  if (boundarySetId && !hasOwnSet) {
    const { data: chosen } = await supabase
      .from("grade_boundary_sets")
      .select("id, test_id")
      .eq("id", boundarySetId)
      .maybeSingle();
    if (!chosen) {
      return NextResponse.json({ error: "That grade boundary set does not exist." }, { status: 400 });
    }
    if (chosen.test_id) {
      return NextResponse.json(
        { error: "That grade boundary set belongs to another assessment. Pick a preset." },
        { status: 400 },
      );
    }
  }
  if (assessmentKind === "summative" && !boundarySetId && !existingSetId) {
    return NextResponse.json(
      {
        error:
          "A summative needs a grade boundary set, or the mark reports as a raw score with an " +
          "approximate band instead of a grade. Pick one and save again.",
      },
      { status: 400 },
    );
  }
  const boundaryWrite = boundarySetId && !hasOwnSet ? { boundary_set_id: boundarySetId } : {};

  const saveResult = testId
    ? await supabase
        .from("tests")
        .update({
          name: draft.title,
          course_id: courseId,
          total_marks: totalMarks,
          custom_content: draft,
          require_self_assessment: requireSelfAssessment,
          assessment_kind: assessmentKind,
          // Only written when the creator sent a preset and the test has no
          // boundaries of its own, so a re-save never clears or overrides a
          // decision made on the Grade boundaries page.
          ...boundaryWrite,
        })
        .eq("id", testId)
        .select("id, name, total_marks")
        .single()
    : await supabase
        .from("tests")
        .insert({
          name: draft.title,
          course_id: courseId,
          teacher_id: profile.id,
          total_marks: totalMarks,
          custom_content: draft,
          require_self_assessment: requireSelfAssessment,
          assessment_kind: assessmentKind,
          ...boundaryWrite,
        })
        .select("id, name, total_marks")
        .single();

  const { data: saved, error: saveError } = saveResult;
  if (saveError || !saved) {
    return NextResponse.json({ error: saveError?.message ?? "Failed to save test" }, { status: 500 });
  }

  // -- Sync test_items -----------------------------------------------------
  // Reported separately rather than rolled back: the test is saved and the
  // teacher should not lose it because the item sync failed.
  const syncResult = await syncTestItems(supabase, saved.id, draft.sections);

  // -- Archive the PDFs ----------------------------------------------------
  // The whole point of doing this on save rather than offering a button: a
  // paper nobody remembered to archive is exactly how Formative Assessment 1
  // ended up with no retrievable copy after 50 students had sat it.
  //
  // Runs after the item sync (which is fast) so a sync error surfaces without
  // waiting on Chromium, but runs even when that sync failed -- the PDFs
  // depend only on the draft, and a test whose items need fixing still
  // deserves its paper kept. Re-saving regenerates both, so this is also its
  // own retry.
  const fmtParse = FormattingRequirementsSchema.safeParse(body.formatting);
  const parsedFormatting = fmtParse.success ? fmtParse.data : DEFAULT_ASSESSMENT_FORMATTING;
  // A summative always prints its exam conditions, whatever the client sent.
  // The creator fills these in, but the guarantee cannot depend on it: a paper
  // that counts must say what the student was allowed to compute with, and
  // "the form was blank" is not a reason for a cover that does not.
  const formatting =
    assessmentKind === "summative"
      ? {
          ...parsedFormatting,
          calculatorPolicy: parsedFormatting.calculatorPolicy ?? SUMMATIVE_FORMATTING_DEFAULTS.calculatorPolicy,
          timeAllowedMinutes: parsedFormatting.timeAllowedMinutes ?? SUMMATIVE_FORMATTING_DEFAULTS.timeAllowedMinutes,
          showTotalMarks: parsedFormatting.showTotalMarks ?? SUMMATIVE_FORMATTING_DEFAULTS.showTotalMarks,
          academicHonestyLine:
            parsedFormatting.academicHonestyLine?.trim() ||
            SUMMATIVE_FORMATTING_DEFAULTS.academicHonestyLine,
        }
      : parsedFormatting;
  const archive = await archiveFormativeAssessmentPdfs(supabase, saved.id, draft, formatting);
  const pdfs = archive.ok
    ? { pdfs: "archived" as const, archived: archive.archived }
    : { pdfs: "failed" as const, pdfsError: archive.error };

  const kindEcho = { assessmentKind, requireSelfAssessment, hintsRemoved };

  if (!syncResult.ok) {
    return NextResponse.json(
      {
        test: saved,
        testItems: "failed",
        testItemsError: syncResult.error,
        rubric,
        ...kindEcho,
        ...pdfs,
      },
      { status: 207 },
    );
  }

  // Findings ride along on success too: warnings never blocked the save, and
  // a teacher who overrode a blocking finding should still see what they
  // overrode rather than have it disappear on the way through.
  return NextResponse.json(
    {
      test: saved,
      testItems: "synced",
      synced: syncResult.synced,
      removed: syncResult.removed,
      // A part whose wording moved out from under marks already awarded
      // against it. syncTestItems allows this and names it; the creator says
      // so, because the teacher is the only one who can tell an intended
      // correction from a regenerated paper landing on the old part numbers.
      rewordedUnderStudentWork: syncResult.rewordedUnderStudentWork,
      rubric,
      ...kindEcho,
      ...pdfs,
    },
    { status: archive.ok ? 200 : 207 },
  );
}
