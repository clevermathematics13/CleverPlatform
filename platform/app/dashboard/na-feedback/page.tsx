import { getProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getReleasedPacketScansForStudent, getNaFeedbackForStudent } from "@/lib/na-feedback-service";
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
      isTeacher={isTeacher}
      viewStudentId={viewStudentId}
      viewStudentName={viewStudentName}
      scans={scans}
      selectedScanId={selectedScanId}
      initialItems={items}
    />
  );
}
