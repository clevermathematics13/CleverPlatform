/**
 * GET /api/formative-assessments/[testId] — reload a saved assessment into the creator
 *
 * The creator could not reopen its own work: `savedTestId` was only ever set
 * by a save in the same browser session, so closing the tab stranded the
 * draft even though `tests.custom_content` had held it all along. This route
 * is the read side of that, and returns everything the sandbox needs to come
 * back to the exact state it saved from -- the draft, the formatting it was
 * rendered with, the course, the self-assessment gate, and whether it is a
 * formative or a summative.
 *
 * Deliberately not GET /api/tests/[id], which serves the test detail form:
 * that one returns `test_items` (the lean grading projection) and none of the
 * authoring fields, so loading from it would silently drop the mark schemes
 * the creator edits.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { DEFAULT_ASSESSMENT_FORMATTING } from "@/lib/formative-assessment-pdf-body";
import { FormattingRequirementsSchema } from "@/lib/template-schema";
import { parseAssessmentKind } from "@/lib/assessment-kind";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ testId: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { testId } = await params;

  const { data: test, error } = await supabase
    .from("tests")
    .select(
      `id, name, course_id, total_marks, custom_content, assessment_formatting,
       require_self_assessment, assessment_kind, boundary_set_id,
       paper_pdf_storage_path, mark_scheme_pdf_storage_path, pdfs_generated_at`,
    )
    .eq("id", testId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  if (!test.custom_content) {
    // A real test, but not one the creator authored -- it has no draft to edit.
    return NextResponse.json(
      {
        error:
          "This test was not created in the assessment creator, so it has no draft to load.",
      },
      { status: 409 },
    );
  }

  // A draft saved before `assessment_formatting` existed carries none, and one
  // written by a client that sent something invalid must not strand the draft
  // behind a 500. Either way the defaults are what it was rendered with.
  const parsed = FormattingRequirementsSchema.safeParse(test.assessment_formatting);
  const formatting = parsed.success ? parsed.data : DEFAULT_ASSESSMENT_FORMATTING;

  return NextResponse.json({
    id: test.id,
    name: test.name,
    courseId: test.course_id,
    totalMarks: test.total_marks,
    draft: test.custom_content,
    formatting,
    formattingSource: parsed.success ? "stored" : "default",
    requireSelfAssessment: test.require_self_assessment !== false,
    assessmentKind: parseAssessmentKind(test.assessment_kind),
    // Null is a real answer here -- a summative without one reports a raw
    // score and an "~approx" band instead of a grade, and the creator says so.
    boundarySetId: test.boundary_set_id,
    pdfsArchived: Boolean(test.paper_pdf_storage_path && test.mark_scheme_pdf_storage_path),
    pdfsGeneratedAt: test.pdfs_generated_at,
  });
}
