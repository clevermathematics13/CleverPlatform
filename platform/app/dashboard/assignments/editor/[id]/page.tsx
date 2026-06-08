import { requireTeacher } from "@/lib/auth";
import { NuancedAnalysisEditorClient } from "./editor-client";
import Link from "next/link";

export default async function NuancedAnalysisEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTeacher();
  const { id } = await params;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Link
          href="/dashboard/assignments"
          className="flex items-center gap-1.5 rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-sm text-da-muted transition-colors hover:bg-da-hover hover:text-da-text"
        >
          ← Assignments Studio
        </Link>
        <div>
          <h1 className="text-xl font-bold text-da-text font-serif">Nuanced Analysis Editor</h1>
          <p className="text-xs text-da-muted mt-0.5">Edit and download your saved analysis</p>
        </div>
      </header>

      <NuancedAnalysisEditorClient id={id} />
    </div>
  );
}
