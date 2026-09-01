import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AiGradeClient } from "./ai-grade-client";

export default async function AiGradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTeacher();
  const { id } = await params;

  const supabase = await createClient();
  const { data: test } = await supabase
    .from("tests")
    .select("id, name, test_date")
    .eq("id", id)
    .maybeSingle();

  if (!test) notFound();

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <a href="/dashboard/tests" className="text-sm text-blue-300 hover:underline">
          ← Back to tests
        </a>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          AI-assisted marking
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">{test.name}</h1>
        <p className="mt-1 text-sm text-da-muted">
          Mark scanned student work against the mark scheme held in the PPQ bank.
          Suggestions are staged for your review — nothing enters Clev&apos;s Marks
          until you accept it.
        </p>
      </div>

      <AiGradeClient testId={test.id as string} />
    </div>
  );
}
