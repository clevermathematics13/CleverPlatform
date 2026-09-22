/**
 * GET /api/tests/[id]/mark-scheme
 *
 * Student-facing "Mark Scheme" link for the CleverReflection self-assess
 * page (components/reflection/NativeForm.tsx renders the button whenever
 * tests.mark_scheme_url is set, and points it at this route).
 *
 * Renders a SEPARATE, student-appropriate document (lib/student-mark-scheme.ts)
 * built from the same tests.custom_content the teacher's Formative Assessment
 * creator authored -- answers and plain-language marking notes, with the
 * internal M1/A1/R1 shorthand stripped and none of the teacher-only
 * marking-principles/reteach-guide sections. It deliberately does NOT hand
 * out the archived teacher PDF (tests.mark_scheme_pdf_storage_path): that
 * document is teacher-only by storage RLS policy, and stays that way -- see
 * the comment on that column and the incident fixed by migration
 * 20260911142419_restrict_student_markscheme_images.sql, which closed
 * exactly this kind of leak for question-bank mark schemes.
 *
 * This route runs the SELECT under the caller's own session, so Postgres
 * RLS ("Students can view their tests", migration
 * student_track_family_test_access) already confines a student to tests in
 * their own track family; a caller with no access gets no row.
 *
 * A student additionally cannot see it before their OWN class has actually
 * sat the test: a track test's classes can sit it on different days
 * (test_course_dates, e.g. 9G a day after 9A/9C on Key Assessment 1), so the
 * gate is computed from that per-class date rather than tests.test_date,
 * the same fix applied to the self-assess list itself in lib/exam-service.ts.
 */

import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { computeReleaseTimestamp } from "@/lib/exam-service";
import { buildStudentMarkSchemeHtml, type StudentMarkSchemeSection } from "@/lib/student-mark-scheme";

export const runtime = "nodejs";

interface AssessmentContent {
  title?: string;
  subtitle?: string;
  sections?: StudentMarkSchemeSection[];
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;
  const { id: testId } = await params;

  const { data: test, error } = await supabase
    .from("tests")
    .select("id, name, test_date, exam_time, release_at, custom_content")
    .eq("id", testId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  if (profile.role === "student") {
    const { data: enrollments } = await supabase
      .from("students")
      .select("course_id")
      .eq("profile_id", profile.id);
    const courseIds = (enrollments ?? []).map((e) => e.course_id as string);

    let effectiveTestDate = test.test_date as string | null;
    if (courseIds.length > 0) {
      const { data: override } = await supabase
        .from("test_course_dates")
        .select("test_date")
        .eq("test_id", test.id)
        .in("course_id", courseIds)
        .maybeSingle();
      if (override?.test_date) effectiveTestDate = override.test_date;
    }

    const unlockAt = computeReleaseTimestamp(effectiveTestDate, test.exam_time, test.release_at);
    if (unlockAt !== null && unlockAt > Date.now()) {
      return NextResponse.json(
        { error: "The mark scheme for this test isn't available yet." },
        { status: 403 },
      );
    }
  }

  const content = test.custom_content as AssessmentContent | null;
  if (!content || !Array.isArray(content.sections) || content.sections.length === 0) {
    return NextResponse.json(
      { error: "No mark scheme has been written for this test yet." },
      { status: 404 },
    );
  }

  const html = buildStudentMarkSchemeHtml({
    title: content.title ?? test.name ?? "Assessment",
    subtitle: content.subtitle,
    sections: content.sections,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
