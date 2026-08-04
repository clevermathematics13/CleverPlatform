import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
// Vision + reasoning over a full scanned test can take a while — same
// ceiling class as the OCR routes' Claude vision fallback passes.
export const maxDuration = 280;

const SEGMENT_SYSTEM = `You are analysing a scanned IBDP Mathematics placement test — a PDF of a student's handwritten answer sheet, possibly with the original question prompts printed on it too.

Your job is to identify each distinct question on the paper and, for each one, infer what a correct IB-style mark scheme would look like — even though no official mark scheme was provided. This is a placement test (not from the official IB question bank), so you must construct the mark scheme yourself from mathematical first principles, in authentic IB mark-scheme style (M1/A1/R1 method and answer marks, "OE" for or-equivalent, FT for follow-through).

For each question you find, determine:
- question_number: the printed/implied question number (integer, in order of appearance)
- page_numbers: which 1-indexed PDF page(s) the question (prompt + student's working) appears on
- inferred_question_latex: the question prompt, transcribed as LaTeX ($ for inline math, \\[ \\] for display math). If the prompt itself isn't legible or wasn't printed (i.e. only working is visible), reconstruct the likely prompt from context and prefix with "[Reconstructed from student work] ".
- inferred_markscheme_latex: a mark scheme you construct yourself, IB-style, with mark codes (M1, A1, etc.) and a total.
- inferred_max_marks: total marks you assigned in the mark scheme (integer)
- inferred_level_hint: "SL" or "HL" — your best judgement of whether this question's difficulty/content sits at IB Analysis & Approaches SL or HL (topics like proof by induction, complex numbers in polar form, more demanding calculus, vectors in 3D with planes, etc. skew HL; more procedural/foundational content skews SL). If genuinely ambiguous, pick your best single guess — never null.

Return ONLY a JSON object of this exact shape, no markdown fences, no explanation:
{
  "questions": [
    {
      "question_number": 1,
      "page_numbers": [1],
      "inferred_question_latex": "...",
      "inferred_markscheme_latex": "...",
      "inferred_max_marks": 4,
      "inferred_level_hint": "SL"
    }
  ]
}`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id } = await params;

  const { data: test, error: fetchErr } = await supabase
    .from("placement_tests")
    .select("id, teacher_id, storage_path, status")
    .eq("id", id)
    .single();

  if (fetchErr || !test) {
    return NextResponse.json({ error: "Placement test not found" }, { status: 404 });
  }
  if (test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (test.status === "segmenting" || test.status === "grading") {
    return NextResponse.json(
      { error: `Placement test is currently ${test.status} — please wait for it to finish.` },
      { status: 409 }
    );
  }

  // Retrying segmentation (e.g. after an error) — clear any partial results
  // from a previous attempt so we don't duplicate questions.
  await supabase.from("placement_test_questions").delete().eq("placement_test_id", id);
  await supabase.from("placement_tests").update({ status: "segmenting", error_message: null }).eq("id", id);

  try {
    const { data: signedData, error: signErr } = await supabase.storage
      .from("uploads")
      .createSignedUrl(test.storage_path, 300);
    if (signErr || !signedData?.signedUrl) {
      throw new Error(`Failed to sign URL: ${signErr?.message ?? "unknown error"}`);
    }

    const pdfRes = await fetch(signedData.signedUrl, { cache: "no-store" });
    if (!pdfRes.ok) throw new Error(`Failed to download PDF: ${pdfRes.status}`);
    const pdfBuffer = await pdfRes.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      system: SEGMENT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: "Segment this placement test into questions and infer a mark scheme for each, per the system instructions.",
            },
          ],
        },
      ],
    });

    const text =
      response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text.trim() ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude did not return parseable JSON");

    const parsed = JSON.parse(jsonMatch[0]) as {
      questions: Array<{
        question_number: number;
        page_numbers: number[];
        inferred_question_latex: string;
        inferred_markscheme_latex: string;
        inferred_max_marks: number;
        inferred_level_hint: "SL" | "HL";
      }>;
    };

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw new Error("No questions detected in this PDF");
    }

    const rows = parsed.questions.map((q, i) => ({
      placement_test_id: id,
      question_number: q.question_number,
      page_numbers: q.page_numbers ?? [],
      inferred_question_latex: q.inferred_question_latex ?? "",
      inferred_markscheme_latex: q.inferred_markscheme_latex ?? "",
      inferred_max_marks: q.inferred_max_marks ?? 0,
      inferred_level_hint: q.inferred_level_hint ?? null,
      sort_order: i,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from("placement_test_questions")
      .insert(rows)
      .select("id, question_number, page_numbers, inferred_question_latex, inferred_max_marks, inferred_level_hint, sort_order");

    if (insertErr) throw new Error(insertErr.message);

    await supabase
      .from("placement_tests")
      .update({ status: "segmented" }) // segmentation complete; ready for the grading step next
      .eq("id", id);

    return NextResponse.json({ questions: inserted ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Segmentation failed";
    await supabase
      .from("placement_tests")
      .update({ status: "error", error_message: message })
      .eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
