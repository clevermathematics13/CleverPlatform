import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  canExplain,
  explanationPartSources,
  explanationSourceHash,
  explanationState,
  type ExplanationPartSource,
} from "@/lib/mark-scheme-explanation";
import { loadStoredExplanations } from "@/lib/mark-scheme-explanation-store";
import { EXPLANATION_MODEL, EXPLANATION_PROMPT_VERSION, writeExplanation } from "@/lib/mark-scheme-explanation-prompt";
import { releasesStudentMarkScheme, studentMarkSchemePagePath, type StudentMarkSchemeItem } from "@/lib/student-mark-scheme";

/**
 * GET    /api/tests/[id]/mark-scheme/explanations   each part and the state of its explanation
 * POST   /api/tests/[id]/mark-scheme/explanations   Body: { key } -- write (or rewrite) one part's
 * DELETE /api/tests/[id]/mark-scheme/explanations   Body: { key } -- take one part's down
 *
 * Teacher only. The written explanations the student mark scheme leads with
 * (lib/mark-scheme-explanation.ts): one model call per part, so the page
 * drives the whole paper a few parts at a time and shows progress, and a
 * part that fails can be tried again on its own. A POST writes the part from
 * its current answer and scheme, checks it, and stores it with the hash of
 * what it was written from; students see it from then on, for as long as
 * that hash matches. A part whose draft keeps failing its checks is
 * reported, never stored.
 *
 * Every read and write runs in the teacher's own session: the table's
 * policies admit the teacher of the test and nobody else.
 */

export const runtime = "nodejs";
// One part is one call at high effort, tried again (at most twice) when a
// draft fails its checks or the API is busy. writeExplanation starts no new
// attempt after START_BY_MS and lets no call run past FINISH_BY_MS, so the
// route answers inside its own limit even when a call hangs.
export const maxDuration = 300;
const START_BY_MS = 150_000;
const FINISH_BY_MS = 280_000;

type Loaded =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      test: { id: string; name: string; hidden: boolean; mark_scheme_url: string | null; courseName: string | null };
      sources: ExplanationPartSource[];
    };

type TeacherClient = Extract<Awaited<ReturnType<typeof getApiTeacher>>, { ok: true }>["supabase"];

async function loadTest(supabase: TeacherClient, testId: string): Promise<Loaded> {
  const { data: test, error } = await supabase
    .from("tests")
    .select("id, name, hidden, mark_scheme_url, custom_content, courses!tests_course_id_fkey(name)")
    .eq("id", testId)
    .maybeSingle();
  if (error) return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!test) return { ok: false, response: NextResponse.json({ error: "Test not found" }, { status: 404 }) };

  const { data: items, error: itemsError } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks, sort_order, stem_text, question_text, markscheme_text")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });
  if (itemsError) return { ok: false, response: NextResponse.json({ error: itemsError.message }, { status: 500 }) };

  const course = test.courses as unknown as { name?: string } | { name?: string }[] | null;
  const courseName = (Array.isArray(course) ? course[0]?.name : course?.name) ?? null;
  return {
    ok: true,
    test: {
      id: test.id as string,
      name: (test.name as string | null) ?? "Assessment",
      hidden: !!test.hidden,
      mark_scheme_url: (test.mark_scheme_url as string | null) ?? null,
      courseName,
    },
    sources: explanationPartSources(test.custom_content, (items ?? []) as StudentMarkSchemeItem[]),
  };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const loaded = await loadTest(supabase, testId);
  if (!loaded.ok) return loaded.response;
  const { test, sources } = loaded;

  // Told apart from "nothing written yet": before the migration is applied
  // every part would otherwise read as missing, and the button would fail
  // on every one of them.
  const probe = await supabase.from("mark_scheme_explanations").select("id").eq("test_id", testId).limit(1);
  const stored = await loadStoredExplanations(supabase, testId);

  return NextResponse.json({
    tableReady: !probe.error,
    released: releasesStudentMarkScheme(test) && !test.hidden,
    markSchemeReleased: releasesStudentMarkScheme(test),
    hidden: test.hidden,
    pagePath: studentMarkSchemePagePath(testId),
    parts: sources.map((source) => {
      const row = stored.get(source.key);
      return {
        key: source.key,
        label: source.label,
        maxMarks: source.maxMarks,
        explainable: canExplain(source),
        state: explanationState(source, row),
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  });
}

async function readKey(request: NextRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { key?: unknown };
    return typeof body.key === "string" && body.key.length <= 80 ? body.key : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: testId } = await params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on this deployment" }, { status: 500 });
  }
  const key = await readKey(request);
  if (!key) return NextResponse.json({ error: "Say which part to write: { key }" }, { status: 400 });

  const loaded = await loadTest(supabase, testId);
  if (!loaded.ok) return loaded.response;
  const { test, sources } = loaded;
  const source = sources.find((s) => s.key === key);
  if (!source) return NextResponse.json({ error: "That part is not on this test" }, { status: 404 });
  if (!canExplain(source)) {
    return NextResponse.json({ error: `${source.label} has no answer or mark scheme to explain` }, { status: 409 });
  }

  const started = Date.now();
  // Retries are writeExplanation's, inside its time budget, not the SDK's.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  const result = await writeExplanation(
    anthropic,
    {
      assessmentName: test.name,
      courseName: test.courseName,
      source,
      siblings: sources.filter((s) => s.questionNumber === source.questionNumber),
    },
    (usage) =>
      recordUsage(supabase, {
        pipeline: "mark_scheme_explanation",
        model: EXPLANATION_MODEL,
        usage,
        ref: { type: "test", id: testId },
      }),
    { startBy: started + START_BY_MS, finishBy: started + FINISH_BY_MS },
  );
  if (!result.ok) {
    return NextResponse.json({ error: `${source.label}: ${result.error}`, problems: result.problems }, { status: 502 });
  }

  const { data: saved, error: saveError } = await supabase
    .from("mark_scheme_explanations")
    .upsert(
      {
        test_id: testId,
        question_number: source.questionNumber,
        part_label: source.partLabel,
        source_hash: explanationSourceHash(source),
        content: result.explanation,
        model: EXPLANATION_MODEL,
        prompt_version: EXPLANATION_PROMPT_VERSION,
        generated_by: user.id,
      },
      { onConflict: "test_id,question_number,part_label" },
    )
    .select("updated_at")
    .single();
  if (saveError) {
    return NextResponse.json({ error: `${source.label} was written but could not be saved: ${saveError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    part: {
      key: source.key,
      label: source.label,
      maxMarks: source.maxMarks,
      explainable: true,
      state: "current" as const,
      updatedAt: (saved?.updated_at as string | undefined) ?? new Date().toISOString(),
    },
    attempts: result.attempts,
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const key = await readKey(request);
  if (!key) return NextResponse.json({ error: "Say which part to remove: { key }" }, { status: 400 });
  const separator = key.indexOf("|");
  const questionNumber = Number(key.slice(0, separator));
  if (separator < 1 || !Number.isInteger(questionNumber)) {
    return NextResponse.json({ error: "Unrecognised part" }, { status: 400 });
  }

  const { error } = await supabase
    .from("mark_scheme_explanations")
    .delete()
    .eq("test_id", testId)
    .eq("question_number", questionNumber)
    .eq("part_label", key.slice(separator + 1));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
