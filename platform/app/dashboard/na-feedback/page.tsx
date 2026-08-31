import { getProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getReleasedPacketScansForStudent,
  getReleasedPacketScanForTeacher,
  getNaFeedbackForStudent,
  getNaFeedbackForPacketScan,
} from "@/lib/na-feedback-service";
import { NaFeedbackClient } from "./na-feedback-client";

export default async function NaFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ scanId?: string; viewStudent?: string }>;
}) {
  await requireRole("student", "teacher");
  const profile = await getProfile();
  const params = await searchParams;
  const isTeacher = profile.role === "teacher";

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
      return (
        <NaFeedbackClient
          key={params.scanId}
          isTeacher
          viewStudentId={viewStudentId}
          viewStudentName={preview.studentName}
          scans={[preview.scan]}
          selectedScanId={params.scanId}
          initialItems={items}
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

  return (
    <NaFeedbackClient
      key={selectedScanId ?? "none"}
      isTeacher={isTeacher}
      viewStudentId={viewStudentId}
      viewStudentName={viewStudentName}
      scans={scans}
      selectedScanId={selectedScanId}
      initialItems={items}
    />
  );
}
