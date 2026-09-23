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
 * marking-principles/reteach-guide sections. A paper with no such draft (a
 * Grade 9 Standard Level paper imported from its PDFs) is built from its
 * test_items instead: each part's markscheme_text, never its marking_notes,
 * which are the teacher's rulings written to the AI marker.
 *
 * It deliberately does NOT hand out the archived teacher PDF
 * (tests.mark_scheme_pdf_storage_path): that document is teacher-only by
 * storage RLS policy, and stays that way -- see the comment on that column
 * and the incident fixed by migration
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
 *
 * And nobody but the teacher sees one that has not been RELEASED: the test
 * must not be hidden (the flag that keeps it out of the self-assess list)
 * and must have a mark_scheme_url (what puts the Mark Scheme button on the
 * self-grade form at all). RLS lets a student read every test in their
 * track family, hidden or not, so without this the route handed any of
 * them a mark scheme for the typing of its URL -- and once it could build
 * one from test_items, that reached every imported paper, not just the one
 * the teacher had chosen to release.
 */

import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { computeReleaseTimestamp } from "@/lib/exam-service";
import {
  buildStudentMarkSchemeHtml,
  buildStudentMarkSchemeHtmlFromItems,
  type StudentMarkSchemeItem,
  type StudentMarkSchemeSection,
} from "@/lib/student-mark-scheme";

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
    .select("id, name, test_date, exam_time, release_at, hidden, mark_scheme_url, custom_content")
    .eq("id", testId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  if (profile.role !== "teacher") {
    if (test.hidden || !test.mark_scheme_url) {
      return NextResponse.json(
        { error: "The mark scheme for this test hasn't been released." },
        { status: 403 },
      );
    }

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
  if (content && Array.isArray(content.sections) && content.sections.length > 0) {
    const html = buildStudentMarkSchemeHtml({
      title: content.title ?? test.name ?? "Assessment",
      subtitle: content.subtitle,
      sections: content.sections,
    });
    return htmlResponse(html);
  }

  const { data: items, error: itemsError } = await supabase
    .from("test_items")
    .select("question_number, part_label, max_marks, markscheme_text")
    .eq("test_id", test.id)
    .order("sort_order", { ascending: true });
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });
  const rows = (items ?? []) as StudentMarkSchemeItem[];
  if (!rows.some((item) => item.markscheme_text?.trim())) {
    return NextResponse.json(
      { error: "No mark scheme has been written for this test yet." },
      { status: 404 },
    );
  }

  return htmlResponse(
    buildStudentMarkSchemeHtmlFromItems({ title: test.name ?? "Assessment", items: rows }),
  );
}

function htmlResponse(html: string): NextResponse {
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
