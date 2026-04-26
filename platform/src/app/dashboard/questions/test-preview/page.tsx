import { requireTeacher } from "@/lib/auth";
import { TestPreviewClient } from "./test-preview-client";

export default async function TestPreviewPage() {
  await requireTeacher();
  return <TestPreviewClient />;
}
