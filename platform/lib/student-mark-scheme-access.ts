import type { SupabaseClient } from "@supabase/supabase-js";
import { computeReleaseTimestamp } from "@/lib/exam-service";
import { releasesStudentMarkScheme } from "@/lib/student-mark-scheme";

/**
 * Whether the signed-in viewer may read a test's student mark scheme page
 * (app/mark-scheme/[id]). The teacher always may. Anyone else only when:
 *
 *  - the scheme is RELEASED: the test is not hidden (the flag that keeps it
 *    out of the self-assess list) and its mark_scheme_url is the platform's
 *    own page (releasesStudentMarkScheme -- the same test the self-grade
 *    form uses before it shows a part's scheme). RLS lets a student read
 *    every test in their track family, hidden or not, so without this the
 *    page would hand any of them a mark scheme for the typing of its URL;
 *  - their OWN class has sat it. A track test's classes can sit it on
 *    different days (test_course_dates, e.g. 9G a day after 9A/9C on Key
 *    Assessment 1), so the gate is computed from the viewer's class date,
 *    the same fix applied to the self-assess list in lib/exam-service.ts.
 *    A student in two classes with different dates waits for the later one.
 *
 * The test row is read by the caller in the viewer's own session, so a
 * test outside their track family never reaches this function at all.
 */
export type MarkSchemeAccess = { ok: true } | { ok: false; message: string };

export async function studentMarkSchemeAccess(
  supabase: SupabaseClient,
  viewer: { id: string; role: string },
  test: {
    id: string;
    hidden: boolean | null;
    mark_scheme_url: string | null;
    test_date: string | null;
    exam_time: string | null;
    release_at: string | null;
  },
): Promise<MarkSchemeAccess> {
  if (viewer.role === "teacher") return { ok: true };

  if (test.hidden || !releasesStudentMarkScheme(test)) {
    return { ok: false, message: "The mark scheme for this test hasn't been released yet." };
  }

  const { data: enrollments } = await supabase.from("students").select("course_id").eq("profile_id", viewer.id);
  const courseIds = (enrollments ?? []).map((e) => e.course_id as string);

  let effectiveTestDate = test.test_date;
  if (courseIds.length > 0) {
    const { data: overrides } = await supabase
      .from("test_course_dates")
      .select("test_date")
      .eq("test_id", test.id)
      .in("course_id", courseIds);
    const dates = (overrides ?? []).map((o) => o.test_date as string | null).filter((d): d is string => !!d).sort();
    if (dates.length > 0) effectiveTestDate = dates[dates.length - 1];
  }

  const unlockAt = computeReleaseTimestamp(effectiveTestDate, test.exam_time, test.release_at);
  if (unlockAt !== null && unlockAt > Date.now()) {
    return { ok: false, message: "The mark scheme for this test isn't available yet. It opens once your class has sat the test." };
  }
  return { ok: true };
}
