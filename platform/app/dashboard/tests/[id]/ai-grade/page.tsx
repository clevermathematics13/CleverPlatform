import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AiGradeClient } from "./ai-grade-client";
import { parseAssessmentKind } from "@/lib/assessment-kind";
import { assembleMarkScheme, summarizeCoverage } from "@/lib/ai-grading";

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
    .select("id, name, test_date, assessment_kind")
    .eq("id", id)
    .maybeSingle();

  if (!test) notFound();

  // Pre-flight: a teacher should know BEFORE spending a grading call whether
  // this paper's mark scheme is fully covered by the PPQ bank. Reuses the
  // exact same join assembleMarkScheme() runs at grading time, so this can
  // never disagree with what a run actually does.
  let coverage = null;
  try {
    const { units } = await assembleMarkScheme(supabase, id);
    coverage = summarizeCoverage(units);
  } catch {
    // A broken assembly is reported once the teacher tries to grade (the
    // route already surfaces that error); the page itself still renders.
  }

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

        <p className="mt-3 text-sm">
          <a
            href={`/dashboard/tests/${test.id}/paper-layout`}
            className="text-blue-300 hover:underline"
          >
            Paper layout →
          </a>{" "}
          <span className="text-da-muted">
            — draw where each part&apos;s answer sits on the printed paper, once for
            the whole class.
          </span>
        </p>
      </div>

      <AiGradeClient
        testId={test.id as string}
        assessmentKind={parseAssessmentKind(test.assessment_kind)}
        coverage={coverage}
      />
    </div>
  );
}
