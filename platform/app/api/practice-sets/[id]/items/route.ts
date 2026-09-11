import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import { loadBankQuestionFacts, nextPosition } from "@/lib/practice-set-admin";
import { isPracticeTier } from "@/lib/practice-sets";
import {
  generatePracticeQuestion,
  PRACTICE_GENERATOR_MODEL,
} from "@/lib/practice-question-generator";

// Generating a question is a max-effort Opus call and takes a minute or two;
// the Vercel default would cut it off partway.
export const maxDuration = 300;

/**
 * POST /api/practice-sets/[id]/items
 *
 * Two modes, both keyed on a bank question the teacher names:
 *
 *   mode "bank"      add that question as it stands.
 *   mode "generate"  write a NEW question modelled on it and add that
 *                    instead, leaving the bank question unused and still
 *                    available to set as an assessment.
 *
 * A generated item is stored unapproved. It is invisible to students until a
 * teacher reads it and approves it -- enforced by RLS, not by this route --
 * because machine-written mathematics can be wrong and a student is the worst
 * possible place to discover that.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: setId } = await ctx.params;

  const body = (await request.json()) as {
    mode?: unknown;
    code?: unknown;
    tier?: unknown;
    teacherNote?: unknown;
  };

  const mode = body.mode === "generate" ? "generate" : "bank";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const tier = typeof body.tier === "string" && isPracticeTier(body.tier) ? body.tier : "medium";
  const teacherNote =
    typeof body.teacherNote === "string" && body.teacherNote.trim()
      ? body.teacherNote.trim()
      : null;

  if (!code) return NextResponse.json({ error: "A question code is required" }, { status: 400 });

  const facts = await loadBankQuestionFacts(code);
  if (!facts) {
    return NextResponse.json({ error: `No bank question with the code ${code}` }, { status: 404 });
  }
  if (facts.marks <= 0) {
    return NextResponse.json(
      { error: `${code} has no marks recorded in the bank, so there is no tariff to match.` },
      { status: 422 }
    );
  }

  const position = await nextPosition(setId);

  if (mode === "bank") {
    const { error } = await supabase.from("practice_set_items").insert({
      practice_set_id: setId,
      position,
      source: "bank",
      ib_question_code: facts.code,
      tier,
      marks: facts.marks,
      subtopic_codes: facts.subtopicCodes,
      teacher_note: teacherNote,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, position }, { status: 201 });
  }

  // ---- generate -----------------------------------------------------------

  if (facts.imagePaths.length === 0) {
    return NextResponse.json(
      {
        error: `${code} has no question image in the bank, and the image is what the question is written from.`,
      },
      { status: 422 }
    );
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from("question-images")
    .download(facts.imagePaths[0]);
  if (downloadError || !blob) {
    return NextResponse.json(
      { error: `Could not read the source image: ${downloadError?.message ?? "unknown error"}` },
      { status: 502 }
    );
  }

  let generated;
  try {
    generated = await generatePracticeQuestion({
      code: facts.code,
      subtopics: facts.subtopicLabels.length > 0 ? facts.subtopicLabels : ["(untagged)"],
      marks: facts.marks,
      paper: facts.paper,
      imageBase64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
      imageMediaType: "image/png",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The question could not be written." },
      { status: 502 }
    );
  }

  await recordUsage(supabase, {
    pipeline: "practice_question",
    model: generated.model,
    usage: generated.usage,
  });

  // The author's own notes ride along in teacher_note: what it changed, and
  // anything it was unsure about. That is the material a teacher needs in
  // front of them when deciding whether to approve, so it belongs on the row
  // rather than in a log nobody opens.
  const authorNotes = [
    `Modelled on ${facts.code}. ${generated.question.difference}`,
    ...generated.question.concerns.map((c) => `Flagged: ${c}`),
  ].join("\n\n");

  const { error } = await supabase.from("practice_set_items").insert({
    practice_set_id: setId,
    position,
    source: "generated",
    ib_question_code: null,
    question_latex: generated.question.questionLatex,
    answer_latex: generated.question.answerLatex,
    generated_from_code: facts.code,
    generator_model: generated.model || PRACTICE_GENERATOR_MODEL,
    tier,
    marks: facts.marks,
    subtopic_codes: facts.subtopicCodes,
    teacher_note: teacherNote ? `${teacherNote}\n\n${authorNotes}` : authorNotes,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { ok: true, position, concerns: generated.question.concerns },
    { status: 201 }
  );
}
