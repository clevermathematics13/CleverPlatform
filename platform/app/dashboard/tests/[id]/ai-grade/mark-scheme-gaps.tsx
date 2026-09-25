import type { SupabaseClient } from "@supabase/supabase-js";
import {
  markSchemeGapHeadline,
  markSchemeGapRows,
  marksLabel,
  summariseMarkSchemeReadiness,
  type MarkSchemeReadiness,
} from "@/lib/mark-scheme-readiness";
import { paperQuestionPrefixes } from "@/lib/paper-labels";
import type { TestDetail } from "./ai-grade-client";

/**
 * The parts of this assessment AI marking will skip because no mark scheme is
 * stored for them, listed above the roster before anything is marked (see
 * lib/mark-scheme-readiness.ts for why, and why only "none" counts).
 *
 * SERVER-ONLY. The load pulls in lib/ai-grading.ts, which reads its policy
 * files from disk as it loads; never import this file from ai-grade-client.tsx,
 * batch-grade-tab.tsx or anything else the browser runs.
 *
 * Nothing here may throw into the page: there is no error boundary under the
 * dashboard, so a throw inside a Suspense boundary would replace the whole
 * page with the error screen (load-initial.ts says the same). A failed load
 * shows no banner, which is how the page looked before this existed.
 */

export interface MarkSchemeGaps {
  readiness: MarkSchemeReadiness;
  /** ib_questions.id by code, for the LaTeX Review links; null when that lookup failed. */
  questionIdByCode: Map<string, string> | null;
}

/**
 * Starts the load. It needs only the test id, so the page starts it beside the
 * roster's own loads rather than after them. Never rejects; null means "show
 * nothing".
 */
export function startMarkSchemeGapsLoad(supabase: SupabaseClient, testId: string): Promise<MarkSchemeGaps | null> {
  return loadMarkSchemeGaps(supabase, testId).catch((e) => {
    console.warn("[mark-scheme-gaps] not shown:", e instanceof Error ? e.message : e);
    return null;
  });
}

async function loadMarkSchemeGaps(supabase: SupabaseClient, testId: string): Promise<MarkSchemeGaps> {
  // Lazy, so a grader that cannot load costs this banner and nothing else.
  const { assembleMarkScheme } = await import("@/lib/ai-grading");
  const { units } = await assembleMarkScheme(supabase, testId);
  const readiness = summariseMarkSchemeReadiness(units);
  const codes = [...new Set(readiness.missing.map((q) => q.questionCode).filter(Boolean))];
  if (codes.length === 0) return { readiness, questionIdByCode: new Map() };
  const { data, error } = await supabase.from("ib_questions").select("id, code").in("code", codes);
  if (error) return { readiness, questionIdByCode: null };
  return {
    readiness,
    questionIdByCode: new Map((data ?? []).map((q) => [q.code as string, q.id as string])),
  };
}

export async function MarkSchemeGapsBanner({
  gaps,
  test,
}: {
  gaps: Promise<MarkSchemeGaps | null>;
  test: TestDetail;
}) {
  const loaded = await gaps;
  if (!loaded) return null;
  const { readiness } = loaded;
  const headline = markSchemeGapHeadline(readiness);
  if (!headline) return null;

  // Printed the way the roster prints a part: the paper's own "2.3" on a
  // Formative Assessment, else "Q5" (itemLabel in ai-grade-client.tsx).
  const rows = markSchemeGapRows(readiness, {
    questionIdByCode: loaded.questionIdByCode,
    prefixBySortOrder: paperQuestionPrefixes(test.custom_content),
    sortOrderByItemId: new Map((test.test_items ?? []).map((i) => [i.id, i.sort_order])),
  });
  // Every part missing means marking is refused outright, not partial.
  const blocked = readiness.totalParts > 0 && readiness.missingParts === readiness.totalParts;
  const tone = blocked
    ? "border-red-400/60 bg-red-500/15 text-red-200"
    : "border-amber-400/40 bg-amber-500/15 text-amber-300";

  return (
    <section
      aria-label="Parts with no mark scheme"
      role={blocked ? "alert" : undefined}
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${tone}`}
    >
      <p className="font-semibold">{headline}</p>
      {rows.some((r) => r.link.kind !== "none") && (
        <p className="mt-1">
          Open each question in LaTeX Review and use &quot;Extract &amp; apply&quot; on its mark scheme, which
          splits it into parts, then reload this page.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">
                {row.label}
                {row.parts && ` ${row.parts}`}
              </span>
              {row.questionCode && <span className="font-mono text-xs">{row.questionCode}</span>}
              <span className="text-xs opacity-80">{marksLabel(row.marks)}</span>
              {row.link.kind === "review" && (
                <a
                  href={row.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium underline"
                >
                  LaTeX Review →
                </a>
              )}
              {row.link.kind === "bank" && (
                <>
                  {row.link.notInBank && <span className="text-xs">not in the PPQ bank</span>}
                  <a
                    href={row.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium underline"
                  >
                    PPQ Bank →
                  </a>
                </>
              )}
              {row.link.kind === "none" && (
                <span className="text-xs">no mark scheme text was saved with this assessment</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
