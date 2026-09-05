import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getTestsForStudent,
  getTestsForInvitedStudent,
  getAllTests,
  getReflectionItems,
  getReflectionItemsForInvitedStudent,
  getPdfUpload,
} from "@/lib/exam-service";
import { resolveViewAs } from "@/lib/view-as";
import type { ReflectionItem } from "@/lib/reflection-types";
import { ReflectionClient } from "./reflection-client";

export default async function ReflectionPage({
  searchParams,
}: {
  searchParams: Promise<{ testId?: string; viewStudent?: string; viewAs?: string }>;
}) {
  const profile = await getProfile();
  const params = await searchParams;
  const isTeacher = profile.role === "teacher";

  // Per-tab "view as this student" (?viewAs=<invitedStudentId>) -- the
  // sidebar picker's mechanism (lib/view-as.ts). Resolved first and handled
  // as its own branch because, unlike ?viewStudent= below, it works for a
  // student who has never signed in: course access and marks are looked up
  // through their invited_students row directly (getTestsForInvitedStudent,
  // getReflectionItemsForInvitedStudent), the same invited_student_id
  // fallback student_marks itself already carries. This branch is a
  // read-only preview of exactly what the student will see once they do
  // sign in -- it never writes to student_self_scores/pdf_uploads on their
  // behalf, unlike the ?viewStudent= branch below (an older, separate
  // mechanism kept as-is here).
  const viewAs = isTeacher ? await resolveViewAs(params.viewAs) : null;

  if (viewAs) {
    const tests = viewAs.courseId ? await getTestsForInvitedStudent(viewAs.courseId) : [];

    const requestedTestId = params.testId ?? null;
    const selectedTestId =
      requestedTestId && tests.some((t) => t.id === requestedTestId)
        ? requestedTestId
        : (tests[0]?.id ?? null);

    let items: ReflectionItem[] | null = null;
    let pdfUpload = null;

    if (selectedTestId) {
      items =
        viewAs.hasAccount && viewAs.profileId
          ? await getReflectionItems(selectedTestId, viewAs.profileId)
          : await getReflectionItemsForInvitedStudent(selectedTestId, viewAs.invitedStudentId);

      // Same gate a real student hits: Clev's Marks stay hidden until they
      // submit their own self-assessment for this test. The preview must
      // show this, not the teacher's own ungated grading view, since the
      // whole point is showing exactly what the student sees.
      const hasSelfAssessed = items.some((i) => i.self_marks !== null);
      if (!hasSelfAssessed) {
        items = items.map((i) => ({ ...i, marks_awarded: null }));
      }

      if (viewAs.hasAccount && viewAs.profileId) {
        pdfUpload = await getPdfUpload(viewAs.profileId, selectedTestId);
      }
    }

    const stateKey = [
      "viewAs",
      viewAs.invitedStudentId,
      selectedTestId ?? "none",
      pdfUpload?.id ?? "no-upload",
      ...(items ?? []).map((i) => `${i.test_item_id}:${i.self_marks ?? "-"}:${i.marks_awarded ?? "-"}`),
    ].join("|");

    return (
      <ReflectionClient
        key={stateKey}
        profile={{ id: profile.id, role: profile.role, display_name: profile.display_name }}
        tests={tests}
        selectedTestId={selectedTestId}
        initialItems={items}
        initialUpload={pdfUpload}
        isTeacher={isTeacher}
        viewStudentId={viewAs.invitedStudentId}
        viewStudentName={viewAs.name}
        readOnlyPreview
        previewHasAccount={viewAs.hasAccount}
      />
    );
  }

  // Teacher viewing a specific student's reflection
  const viewStudentId = isTeacher ? params.viewStudent ?? null : null;
  let viewStudentName: string | null = null;

  if (viewStudentId) {
    const supabase = await createClient();
    const { data: studentProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", viewStudentId)
      .single();
    viewStudentName = studentProfile?.display_name ?? "Student";
  }

  const tests = isTeacher
    ? await getAllTests()
    : await getTestsForStudent(profile.id);

  const requestedTestId = params.testId ?? null;
  const selectedTestId =
    !isTeacher && requestedTestId && !tests.some((t) => t.id === requestedTestId)
      ? tests[0]?.id ?? null
      : requestedTestId ?? tests[0]?.id ?? null;

  // For student or teacher-viewing-student, fetch items
  const effectiveStudentId = viewStudentId ?? (isTeacher ? null : profile.id);

  let items = null;
  let pdfUpload = null;

  if (selectedTestId && effectiveStudentId) {
    items = await getReflectionItems(selectedTestId, effectiveStudentId);
    pdfUpload = await getPdfUpload(effectiveStudentId, selectedTestId);

    // Students must self-assess before seeing teacher marks -- unless the
    // teacher has marked this specific test's self-assessment step optional
    // (tests.require_self_assessment), in which case marks are visible
    // immediately regardless of whether the student has self-assessed.
    const selectedTest = tests.find((t) => t.id === selectedTestId);
    const viewerIsStudent = !isTeacher;
    const selfAssessmentRequired = selectedTest?.require_self_assessment ?? true;
    if (viewerIsStudent && selfAssessmentRequired && items) {
      const hasSelfAssessed = items.some((i) => i.self_marks !== null);
      if (!hasSelfAssessed) {
        items = items.map((i) => ({ ...i, marks_awarded: null }));
      }
    }
  }

  // Key the client on the data it seeds its state from. After a student
  // submits self-marks the client calls router.refresh(); the server then
  // re-renders with Clev's Marks unlocked, but a client component keeps its
  // useState across a refresh, so without this key the page kept showing the
  // pre-submit copy (marks blanked, self-marks null) and told the student to
  // wait for the teacher. A changed key remounts it from the fresh props.
  const stateKey = [
    selectedTestId ?? "none",
    effectiveStudentId ?? "none",
    pdfUpload?.id ?? "no-upload",
    ...(items ?? []).map((i) => `${i.test_item_id}:${i.self_marks ?? "-"}:${i.marks_awarded ?? "-"}`),
  ].join("|");

  return (
    <ReflectionClient
      key={stateKey}
      profile={{ id: profile.id, role: profile.role, display_name: profile.display_name }}
      tests={tests}
      selectedTestId={selectedTestId}
      initialItems={items}
      initialUpload={pdfUpload}
      isTeacher={isTeacher}
      viewStudentId={viewStudentId}
      viewStudentName={viewStudentName}
    />
  );
}
