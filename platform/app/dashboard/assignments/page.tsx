import { requireTeacher } from "@/lib/auth";
import { Grade9PdfSandbox } from "./grade9-pdf-sandbox";

export default async function AssignmentsPage() {
  await requireTeacher();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-da-text font-serif">Assignments Studio</h1>
        <p className="max-w-4xl text-sm text-da-muted">
          Build cleanly formatted assignment sheets with AI-assisted drafting. This first sandbox
          focuses on Grade 9 static PDFs and gives you full control over formatting requirements.
        </p>
      </header>

      <Grade9PdfSandbox />
    </div>
  );
}
