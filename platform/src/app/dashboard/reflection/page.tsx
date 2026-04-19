import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getTestsForStudent,
  getAllTests,
  getReflectionItems,
  getPdfUpload,
} from "@/lib/exam-service";
import { ReflectionClient } from "./reflection-client";

export default async function ReflectionPage({
  searchParams,
}: {
  searchParams: Promise<{ testId?: string; viewStudent?: string }>;
}) {
  const profile = await getProfile();
  const params = await searchParams;
  const isTeacher = profile.role === "teacher";

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

  const selectedTestId = params.testId ?? tests[0]?.id ?? null;

  // For student or teacher-viewing-student, fetch items
  const effectiveStudentId = viewStudentId ?? (isTeacher ? null : profile.id);

  let items = null;
  let pdfUpload = null;

  if (selectedTestId && effectiveStudentId) {
    items = await getReflectionItems(selectedTestId, effectiveStudentId);
    pdfUpload = await getPdfUpload(effectiveStudentId, selectedTestId);
  }

  return (
    <ReflectionClient
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
