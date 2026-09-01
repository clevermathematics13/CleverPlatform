import { getProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getReleasedPacketScansForStudent,
  getReleasedPacketScanForTeacher,
  getNaFeedbackForStudent,
  getNaFeedbackForPacketScan,
} from "@/lib/na-feedback-service";
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
    const supabase = await createClient();
    const { data: scan } = await supabase
      .from("na_packet_scans")
      .select("id")
      .eq("invited_student_id", viewAs.invitedStudentId)
      .eq("status", "released")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const items = scan ? await getNaFeedbackForPacketScan(scan.id) : [];
    const preview = scan ? await getReleasedPacketScanForTeacher(scan.id) : null;
    return (
      <NaFeedbackClient
        key={scan?.id ?? "none"}
        isTeacher
        viewStudentId={null}
        viewStudentName={viewAs.name}
        scans={preview ? [preview.scan] : []}
        selectedScanId={scan?.id ?? null}
        initialItems={items}
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
