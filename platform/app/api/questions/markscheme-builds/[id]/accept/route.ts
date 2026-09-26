import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiTeacher } from "@/lib/auth";
import { decideAcceptance, readStoredTranscription } from "@/lib/markscheme-build";
import { loadExistingParts, loadQuestionUse } from "@/lib/markscheme-builds-service";

// The fields LaTeX Review's cards hold for a part (app/dashboard/questions/review/page.tsx).
const REVIEW_PART_FIELDS =
  "id, part_label, marks, subtopic_codes, command_term, command_terms, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified, mark_attributions";

const BodySchema = z.object({
  parts: z
    .array(
      z.object({
        label: z.string().max(20),
        marks: z.number().int().min(0).max(100).nullable(),
        latex: z.string().max(50_000),
      })
    )
    .min(1)
    .max(40),
});

// POST /api/questions/markscheme-builds/[id]/accept
// A teacher accepts a flagged build, with their corrections. The corrected
// parts are planned again against the question as it is now
// (decideAcceptance, lib/markscheme-build.ts): the teacher may accept past
// the flags they have read, never past a blocking one. The write is
// apply_markscheme_build() under the teacher's own session, which checks the
// rows once more and records the build as accepted by them.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Send the parts as { parts: [{ label, marks, latex }] }." }, { status: 400 });
  }

  const { data: build, error: buildError } = await supabase
    .from("markscheme_builds")
    .select("id, question_id, status, transcription")
    .eq("id", id)
    .maybeSingle();
  if (buildError) return NextResponse.json({ error: buildError.message }, { status: 500 });
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  if (build.status !== "flagged") {
    return NextResponse.json({ error: `This build is ${build.status}, not waiting for review.` }, { status: 409 });
  }
  const transcription = readStoredTranscription(build.transcription);
  if (!transcription) return NextResponse.json({ error: "This build has no readable transcription." }, { status: 409 });

  const { data: question, error: questionError } = await supabase
    .from("ib_questions")
    .select("id, code")
    .eq("id", build.question_id)
    .maybeSingle();
  if (questionError) return NextResponse.json({ error: questionError.message }, { status: 500 });
  if (!question) return NextResponse.json({ error: "Its question is no longer in the bank." }, { status: 409 });

  let existing;
  let use;
  try {
    existing = (await loadExistingParts(supabase, [question.id])).get(question.id) ?? [];
    use = (await loadQuestionUse(supabase, [question])).get(question.id) ?? null;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const decision = decideAcceptance({
    transcription,
    edits: body.parts,
    existing,
    inUse: use?.target ?? null,
    inUseConflicts: use?.conflicts ?? [],
  });
  if (!decision.ok) {
    const error =
      decision.reason === "invalid"
        ? "Some parts cannot be saved as they are."
        : decision.reason === "blocked"
          ? "This cannot be accepted here."
          : "There is nothing to change.";
    return NextResponse.json({ error, problems: decision.problems }, { status: decision.reason === "invalid" ? 422 : 409 });
  }

  const { error: applyError } = await supabase.rpc("apply_markscheme_build", { p_build_id: id, p_plan: decision.plan });
  if (applyError) return NextResponse.json({ error: applyError.message }, { status: 409 });

  const { data: parts, error: partsError } = await supabase
    .from("question_parts")
    .select(REVIEW_PART_FIELDS)
    .eq("question_id", question.id)
    .order("sort_order");
  if (partsError) return NextResponse.json({ error: partsError.message }, { status: 500 });
  return NextResponse.json({ parts: parts ?? [] });
}
