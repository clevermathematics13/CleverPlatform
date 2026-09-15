import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StandardsImportClient } from "./standards-import-client";

/**
 * Set up a Grade 9 Standard Level assessment from its two PDFs.
 *
 * The paper and the Teacher Marking Rubric are written outside the platform,
 * and every Standard Level paper may be laid out differently from the last.
 * So instead of a hand-written seed per paper, the two PDFs are read into a
 * draft (POST /api/standards-assessments/extract), the teacher checks it
 * here -- parts, marks, mark schemes, strands -- and saves it as a gradeable
 * test (POST /api/standards-assessments).
 */
export default async function StandardsImportPage() {
  await requireTeacher();
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .eq("archived", false)
    .order("name");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link href="/dashboard/tests" className="text-sm text-blue-300 hover:underline">
          ← Back to tests
        </Link>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          Grade 9 Standard Level
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">Import a Standard Level paper</h1>
        <p className="mt-1 text-sm text-da-muted">
          Upload the paper and its Teacher Marking Rubric. Clev reads both into the parts, their mark
          schemes and the strand rubric; you check every line, then save it as a test to mark scans
          against. Nothing is saved until you press Save.
        </p>
      </div>
      <StandardsImportClient courses={(courses ?? []) as { id: string; name: string }[]} />
    </div>
  );
}
