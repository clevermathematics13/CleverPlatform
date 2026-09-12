import { getProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getReleasedPacketScansForStudent,
  getReleasedPacketScansForInvitedStudent,
  getPacketScanStatusesForInvitedStudent,
  getReleasedPacketScanForTeacher,
  getNaFeedbackForStudent,
  getNaFeedbackForPacketScan,
} from "@/lib/na-feedback-service";
import {
  getReleasedAnswersForStudent,
  getReleasedAnswersForPacketScan,
} from "@/lib/na-answer-service";
import { describeEmptyFeedbackPreview } from "@/lib/na-feedback-preview";
import { resolveViewAs } from "@/lib/view-as";
import { NaFeedbackClient } from "./na-feedback-client";

export default async function NaFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ scanId?: string; viewStudent?: string; viewAs?: string }>;
}) {
  await requireRole("student", "teacher");
  const profile = await getProfile();
  const params = await searchParams;
  const isTeacher = profile.role === "teacher";

  // Per-tab "view as this student" (?viewAs=<invitedStudentId>). Resolved
  // first: it is the sidebar picker's mechanism, and unlike ?viewStudent=
  // it works for a student who has never signed in, by finding their
  // released scan directly rather than going through a profiles.id that
  // does not exist yet.
  const viewAs = await resolveViewAs(params.viewAs);
  if (viewAs) {
    // Every released packet, not just the newest -- the picker below is what
    // the student themselves gets, and a preview that silently showed one of
    // two released packets is not the thing being previewed.
    const previewScans = await getReleasedPacketScansForInvitedStudent(viewAs.invitedStudentId);
    const requestedScanId = params.scanId ?? null;
    const previewScanId =
      requestedScanId && previewScans.some((s) => s.packetScanId === requestedScanId)
        ? requestedScanId
        : (previewScans[0]?.packetScanId ?? null);
    const items = previewScanId ? await getNaFeedbackForPacketScan(previewScanId) : [];
    // The preview is meant to be exactly the student's own page, so it gets
    // the answers on the same terms: the unchecked reader, because ownership
    // here comes from the teacher role rather than from student_profile_id.
    const answers = previewScanId ? await getReleasedAnswersForPacketScan(previewScanId) : [];

    // When there is nothing to show, say which nothing it is. "No feedback
    // has been released to you yet" is true of a student whose packet was
    // never scanned, of one whose packet is sitting half-marked, and of a
    // page that is simply broken -- and a teacher cannot tell those apart,
    // so a correct page reads as a bug. Only fetched on the empty path:
    // when there IS feedback the question does not arise.
    const emptyPreview =
      previewScans.length === 0
        ? describeEmptyFeedbackPreview({
            studentName: viewAs.name,
            scanStatuses: await getPacketScanStatusesForInvitedStudent(viewAs.invitedStudentId),
          })
        : null;

    return (
      <NaFeedbackClient
        key={previewScanId ?? "none"}
        isTeacher
        viewStudentId={null}
        viewStudentName={viewAs.name}
        scans={previewScans}
        selectedScanId={previewScanId}
        initialItems={items}
        answers={answers}
        readOnlyPreview
        previewViewAsId={viewAs.invitedStudentId}
        previewHasAccount={viewAs.hasAccount}
        emptyPreview={emptyPreview}
      />
    );
  }

  // Teacher previewing a specific student's feedback -- same convention as
  // /dashboard/reflection's own ?viewStudent= param.
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

  // A teacher can also preview by packet scan alone. That is the only
  // preview that works before a class has ever signed in: ?viewStudent=
  // takes a profiles.id, and na_packet_scans.student_profile_id stays
  // NULL until first sign-in backfills it, so a roster full of
  // never-logged-in students has no profile id to pass. Preferred over
  // the profile path whenever a scanId is supplied.
  if (isTeacher && params.scanId) {
    const preview = await getReleasedPacketScanForTeacher(params.scanId);
    if (preview) {
      const items = await getNaFeedbackForPacketScan(params.scanId);
      const answers = await getReleasedAnswersForPacketScan(params.scanId);
      return (
        <NaFeedbackClient
          key={params.scanId}
          isTeacher
          viewStudentId={viewStudentId}
          viewStudentName={preview.studentName}
          scans={[preview.scan]}
          selectedScanId={params.scanId}
          initialItems={items}
          answers={answers}
        />
      );
    }
  }

  const effectiveStudentId = viewStudentId ?? (isTeacher ? null : profile.id);

  const scans = effectiveStudentId ? await getReleasedPacketScansForStudent(effectiveStudentId) : [];
  const requestedScanId = params.scanId ?? null;
  const selectedScanId =
    requestedScanId && scans.some((s) => s.packetScanId === requestedScanId)
      ? requestedScanId
      : scans[0]?.packetScanId ?? null;

  const items =
    selectedScanId && effectiveStudentId
      ? await getNaFeedbackForStudent(selectedScanId, effectiveStudentId)
      : [];

  // na_rubric_items is teacher-only under RLS, so this reads with the service
  // key; the ownership and release tests live inside the service. See
  // lib/na-answer-service.
  const answers =
    selectedScanId && effectiveStudentId
      ? await getReleasedAnswersForStudent(selectedScanId, effectiveStudentId)
      : [];

  return (
    <NaFeedbackClient
      key={selectedScanId ?? "none"}
      isTeacher={isTeacher}
      viewStudentId={viewStudentId}
      viewStudentName={viewStudentName}
      scans={scans}
      selectedScanId={selectedScanId}
      initialItems={items}
      answers={answers}
    />
  );
}
