import { getProfile } from "@/lib/auth";
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
  searchParams: Promise<{ testId?: string }>;
}) {
  const profile = await getProfile();
  const params = await searchParams;
  const isTeacher = profile.role === "teacher";

  const tests = isTeacher
    ? await getAllTests()
    : await getTestsForStudent(profile.id);

  const selectedTestId = params.testId ?? tests[0]?.id ?? null;

  let items = null;
  let pdfUpload = null;

  if (selectedTestId && !isTeacher) {
    items = await getReflectionItems(selectedTestId, profile.id);
    pdfUpload = await getPdfUpload(profile.id, selectedTestId);
  }

  return (
    <ReflectionClient
      profile={{ id: profile.id, role: profile.role, display_name: profile.display_name }}
      tests={tests}
      selectedTestId={selectedTestId}
      initialItems={items}
      initialUpload={pdfUpload}
      isTeacher={isTeacher}
    />
  );
}
