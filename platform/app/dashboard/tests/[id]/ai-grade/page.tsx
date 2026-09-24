import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AiGradeClient } from "./ai-grade-client";
import type { TestDetail } from "./ai-grade-client";
import { loadAiGradeInitial, startAiGradeInitialLoads } from "./load-initial";
import type { AiGradeInitialLoads } from "./load-initial";
import { parseAssessmentKind } from "@/lib/assessment-kind";
import type { AssessmentKind } from "@/lib/assessment-kind";
import { parseStandardsRubric } from "@/lib/standards-rubric";
import type { StandardsRubric } from "@/lib/standards-rubric";
import { TEST_DETAIL_SELECT } from "@/lib/test-detail";

export default async function AiGradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireTeacher();
  const { id } = await params;

  const supabase = await createClient();
  // Started before the test row is read, so the roster's own loads run
  // alongside it rather than after it (see load-initial.ts).
  const loads = startAiGradeInitialLoads(supabase, id, profile.id);
  // The whole test, with its parts -- the row GET /api/tests/[id] serves --
  // since the roster below needs all of it and the header only a little.
  const { data: test } = await supabase
    .from("tests")
    .select(TEST_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!test) notFound();

  // Parsed here so the parser, and zod with it, stays out of the page's
  // JavaScript.
  const rubric = parseStandardsRubric(test.standards_rubric ?? null);

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

      {/* The header above goes out at once; the roster follows the moment
          its loads finish, in place of the line the page used to show while
          it fetched them from the browser. */}
      <Suspense fallback={<p className="text-sm text-da-muted">Loading this assessment…</p>}>
        <AiGradeRoster
          supabase={supabase}
          test={test as unknown as TestDetail}
          loads={loads}
          assessmentKind={parseAssessmentKind(test.assessment_kind)}
          standardsRubric={rubric.ok ? rubric.rubric : null}
        />
      </Suspense>
    </div>
  );
}

async function AiGradeRoster({
  supabase,
  test,
  loads,
  assessmentKind,
  standardsRubric,
}: {
  supabase: SupabaseClient;
  test: TestDetail;
  loads: AiGradeInitialLoads;
  assessmentKind: AssessmentKind;
  standardsRubric: StandardsRubric | null;
}) {
  const initial = await loadAiGradeInitial(supabase, test, loads);
  return (
    <AiGradeClient
      testId={test.id}
      // Only read if the client has to load the roster itself (initial is
      // null): it lets that request start alongside the test detail's.
      courseId={test.course_id ?? null}
      assessmentKind={assessmentKind}
      initial={initial}
      standardsRubric={standardsRubric}
    />
  );
}
