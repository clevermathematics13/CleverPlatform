import { requireTeacher } from "@/lib/auth";
import { AssignmentsClient } from "./assignments-client";

export default async function AssignmentsPage() {
  await requireTeacher();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-da-text font-serif">Assignments Studio</h1>
        <p className="max-w-4xl text-sm text-da-muted">
          Build cleanly formatted assignment sheets with AI-assisted drafting across Grade levels.
          Select your grade to access formatting sandboxes, save reusable templates, and export to PDF.
        </p>
      </header>

      <AssignmentsClient />
    </div>
  );
}
