import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PaperLayoutClient } from "./paper-layout-client";

export default async function PaperLayoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTeacher();
  const { id } = await params;

  const supabase = await createClient();
  const { data: test } = await supabase
    .from("tests")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!test) notFound();

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <a href={`/dashboard/tests/${test.id}/ai-grade`} className="text-sm text-blue-300 hover:underline">
          ← Back to marking
        </a>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          Paper layout
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">{test.name as string}</h1>
        <p className="mt-1 text-sm text-da-muted">
          Draw where each part&apos;s answer sits on the printed paper, once. Every
          student sat the same booklet, so one set of regions serves the whole class
          — instead of the marker guessing a position per student, which it does
          badly.
        </p>
      </div>

      <PaperLayoutClient testId={test.id as string} />
    </div>
  );
}
