import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 280;

const GRADE_SYSTEM = `You are grading a student's handwritten working on an IBDP Mathematics placement test question, against a mark scheme (which may be teacher-authored or AI-inferred — grade it exactly as if it were an official IB mark scheme either way).

You will be given:
1. The full scanned PDF of the placement test (for visual context / page layout).
2. Which page(s) this specific question appears on.
3. The question prompt (LaTeX).
4. The mark scheme (LaTeX, IB-style: M1/A1/R1 marks, total).

Your job:
- Locate the student's handwritten working for THIS question on the specified page(s).
- Transcribe the student's working faithfully (student_work_transcription) — a plain-text description of what they wrote, including any answers, working steps, and errors. If handwriting is illegible in places, say so explicitly rather than guessing silently.
- Award marks strictly according to the mark scheme's M1/A1/R1 breakdown — method marks for valid method even if the final answer is wrong (unless the mark scheme says otherwise), accuracy marks only for correct results that follow correct or follow-through method, exactly as IB convention requires.
- marks_awarded: the total you award (can be a whole number or, rarely, a IB-style half mark — but default to whole numbers unless the mark scheme itself uses halves).
- confidence: "high" if the handwriting is clear and the mark scheme criteria map unambiguously onto what the student wrote; "medium" if there is some legibility or interpretation ambiguity but you are reasonably confident; "low" if the handwriting is hard to read, the work is ambiguous, partially cut off, or you are genuinely unsure the mark is correct. Use "low" liberally — it exists specifically to flag things for teacher review, so err toward flagging rather than guessing confidently.
- confidence_notes: ONLY populate this when confidence is "medium" or "low" — briefly explain what was uncertain (e.g. "final line illegible", "unclear whether student intended method A or B"). Leave empty string for "high" confidence.

Return ONLY a JSON object of this exact shape, no markdown fences, no explanation:
{
  "marks_awarded": 3,
  "confidence": "high",
  "confidence_notes": "",
  "student_work_transcription": "..."
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
  if (test.status !== "segmented" && test.status !== "error") {
    return NextResponse.json(
      {
        error:
          test.status === "grading"
            ? "This placement test is already grading — please wait for it to finish."
            : `Placement test must be segmented before grading (current status: ${test.status}).`,
      },
      { status: 409 }
    );
  }

  const { data: questions, error: qErr } = await supabase
    .from("placement_test_questions")
    .select("id, question_number, page_numbers, inferred_question_latex, inferred_markscheme_latex, inferred_max_marks")
    .eq("placement_test_id", id)
    .order("sort_order", { ascending: true });

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }
  if (!questions || questions.length === 0) {
    return NextResponse.json(
      { error: "No segmented questions found — run segmentation first." },
      { status: 400 }
    );
  }

  // Clear any partial marks from a previous attempt so retries don't duplicate.
  await supabase
    .from("placement_test_marks")
    .delete()
    .in("placement_test_question_id", questions.map((q) => q.id));
  await supabase.from("placement_tests").update({ status: "grading", error_message: null }).eq("id", id);

  try {
    const { data: signedData, error: signErr } = await supabase.storage
      .from("uploads")
      .createSignedUrl(test.storage_path, 600);
    if (signErr || !signedData?.signedUrl) {
      throw new Error(`Failed to sign URL: ${signErr?.message ?? "unknown error"}`);
    }
    const pdfRes = await fetch(signedData.signedUrl, { cache: "no-store" });
    if (!pdfRes.ok) throw new Error(`Failed to download PDF: ${pdfRes.status}`);
    const pdfBuffer = await pdfRes.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Grade each question with its own call — keeps context focused (one
    // question's mark scheme at a time) and means one bad response doesn't
    // sink the whole batch.
    const results: Array<{
      questionId: string;
      marks_awarded: number;
      max_marks: number;
      confidence: "high" | "medium" | "low";
      confidence_notes: string | null;
      student_work_transcription: string | null;
    }> = [];

    for (const q of questions) {
      const userText = `Question ${q.question_number}, found on page(s) ${JSON.stringify(q.page_numbers)}.

Question prompt (LaTeX):
${q.inferred_question_latex}

Mark scheme (LaTeX):
${q.inferred_markscheme_latex}

Max marks: ${q.inferred_max_marks}

Grade this question per the system instructions.`;

      let parsed: {
        marks_awarded: number;
        confidence: "high" | "medium" | "low";
        confidence_notes: string;
        student_work_transcription: string;
      };

      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-5",
          max_tokens: 4096,
          system: GRADE_SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
                },
                { type: "text", text: userText },
              ],
            },
          ],
        });

        const text =
          response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text.trim() ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Claude did not return parseable JSON");
        parsed = JSON.parse(jsonMatch[0]);
      } catch (perQuestionErr) {
        // Don't let one question's failure sink the whole grading run —
        // record it as a low-confidence zero and flag clearly for review.
        const msg = perQuestionErr instanceof Error ? perQuestionErr.message : "Grading failed";
        parsed = {
          marks_awarded: 0,
          confidence: "low",
          confidence_notes: `Automatic grading failed for this question: ${msg}. Please grade manually.`,
          student_work_transcription: "",
        };
      }

      const clampedMarks = Math.max(0, Math.min(q.inferred_max_marks, Number(parsed.marks_awarded) || 0));

      results.push({
        questionId: q.id,
        marks_awarded: clampedMarks,
        max_marks: q.inferred_max_marks,
        confidence: parsed.confidence ?? "low",
        confidence_notes: parsed.confidence_notes || null,
        student_work_transcription: parsed.student_work_transcription || null,
      });
    }

    const rows = results.map((r) => ({
      placement_test_question_id: r.questionId,
      marks_awarded: r.marks_awarded,
      max_marks: r.max_marks,
      confidence: r.confidence,
      confidence_notes: r.confidence_notes,
      student_work_transcription: r.student_work_transcription,
    }));

    const { error: insertErr } = await supabase.from("placement_test_marks").insert(rows);
    if (insertErr) throw new Error(insertErr.message);

    await supabase.from("placement_tests").update({ status: "graded" }).eq("id", id);

    return NextResponse.json({ marks: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Grading failed";
    await supabase
      .from("placement_tests")
      .update({ status: "error", error_message: message })
      .eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
