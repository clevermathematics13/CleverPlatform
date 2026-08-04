import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

const RECOMMEND_SYSTEM = `You are an IBDP Mathematics placement coordinator. You will be given a breakdown of a student's performance on a placement test — question by question, each with its inferred level (SL/HL), max marks, marks awarded, and percentage — and you must recommend which IBDP Mathematics course the student should be placed into.

The three possible recommendations are exactly:
- "AISL" — Applications & Interpretation, Standard Level
- "AASL" — Analysis & Approaches, Standard Level
- "AAHL" — Analysis & Approaches, Higher Level

This placement test is assumed to be an Analysis & Approaches style test (algebraic/analytical content, not primarily applications-and-modelling), so the real decision is almost always between AASL and AAHL, based on overall performance and especially performance on HL-flagged questions. Only recommend AISL if the pattern of errors strongly suggests the student would struggle with the analytical/proof-based demands of AA even at SL and would be better served by the more applied AI pathway — this should be a deliberate judgement call, not a default.

Guidance (use holistic judgement, not a rigid cutoff):
- Strong performance overall (broadly 70%+) with solid performance specifically on HL-flagged questions → AAHL.
- Solid performance overall but noticeably weaker on HL-flagged questions, or performance in the 50-70% range → AASL.
- Weak performance overall (broadly below 50%), especially with fundamental/procedural errors rather than just missing advanced technique → consider AASL still, and only drop to AISL if the errors suggest the analytical approach itself (not just this particular content) is the wrong fit.

Write reasoning (2-4 sentences) that a teacher could read and immediately understand the basis for the recommendation — mention specific strengths/weaknesses observed, not just the percentage.

Return ONLY a JSON object of this exact shape, no markdown fences, no explanation:
{
  "recommended_curriculum": "AA",
  "recommended_level": "HL",
  "recommended_label": "AAHL",
  "reasoning": "..."
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
    .select("id, teacher_id, student_name, status")
    .eq("id", id)
    .single();

  if (fetchErr || !test) {
    return NextResponse.json({ error: "Placement test not found" }, { status: 404 });
  }
  if (test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (test.status !== "graded" && test.status !== "complete") {
    return NextResponse.json(
      { error: `Placement test must be graded before a recommendation can be generated (current status: ${test.status}).` },
      { status: 409 }
    );
  }

  const { data: questions, error: qErr } = await supabase
    .from("placement_test_questions")
    .select("id, question_number, inferred_level_hint, inferred_max_marks")
    .eq("placement_test_id", id)
    .order("sort_order", { ascending: true });

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: "No questions found for this placement test." }, { status: 400 });
  }

  const questionIds = questions.map((q) => q.id);
  const { data: marks, error: mErr } = await supabase
    .from("placement_test_marks")
    .select("placement_test_question_id, marks_awarded, max_marks, confidence")
    .in("placement_test_question_id", questionIds);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  if (!marks || marks.length === 0) {
    return NextResponse.json({ error: "No marks found — run grading first." }, { status: 400 });
  }

  const marksByQuestion = new Map(marks.map((m) => [m.placement_test_question_id, m]));

  let totalAwarded = 0;
  let totalMax = 0;
  let lowConfidenceCount = 0;
  const breakdown: Array<{
    question_number: number;
    level_hint: string | null;
    marks_awarded: number;
    max_marks: number;
    confidence: string;
  }> = [];

  for (const q of questions) {
    const m = marksByQuestion.get(q.id);
    if (!m) continue;
    totalAwarded += Number(m.marks_awarded);
    totalMax += Number(m.max_marks);
    if (m.confidence === "low") lowConfidenceCount++;
    breakdown.push({
      question_number: q.question_number,
      level_hint: q.inferred_level_hint,
      marks_awarded: Number(m.marks_awarded),
      max_marks: Number(m.max_marks),
      confidence: m.confidence,
    });
  }

  if (totalMax === 0) {
    return NextResponse.json({ error: "Total marks across questions is zero — cannot compute a percentage." }, { status: 400 });
  }
  const overallPercentage = (totalAwarded / totalMax) * 100;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const breakdownText = breakdown
      .map(
        (b) =>
          `Q${b.question_number} (${b.level_hint ?? "level unknown"}): ${b.marks_awarded}/${b.max_marks} (${((b.marks_awarded / b.max_marks) * 100).toFixed(0)}%)${b.confidence === "low" ? " [low confidence mark]" : ""}`
      )
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: RECOMMEND_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Student: ${test.student_name}
Overall: ${totalAwarded}/${totalMax} (${overallPercentage.toFixed(1)}%)

Per-question breakdown:
${breakdownText}

Recommend a placement per the system instructions.`,
        },
      ],
    });

    const text =
      response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude did not return parseable JSON");
    const parsed = JSON.parse(jsonMatch[0]) as {
      recommended_curriculum: "AA" | "AI";
      recommended_level: "SL" | "HL";
      recommended_label: "AISL" | "AASL" | "AAHL";
      reasoning: string;
    };

    // Delete any prior recommendation for this test (unique constraint on
    // placement_test_id means a retry must clear first).
    await supabase.from("placement_recommendations").delete().eq("placement_test_id", id);

    const { data: inserted, error: insertErr } = await supabase
      .from("placement_recommendations")
      .insert({
        placement_test_id: id,
        recommended_curriculum: parsed.recommended_curriculum,
        recommended_level: parsed.recommended_level,
        recommended_label: parsed.recommended_label,
        overall_percentage: overallPercentage,
        reasoning: parsed.reasoning,
        subtopic_breakdown: breakdown,
        low_confidence_count: lowConfidenceCount,
      })
      .select(
        "id, recommended_curriculum, recommended_level, recommended_label, overall_percentage, reasoning, subtopic_breakdown, low_confidence_count, created_at"
      )
      .single();

    if (insertErr) throw new Error(insertErr.message);

    await supabase
      .from("placement_tests")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ recommendation: inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recommendation generation failed";
    await supabase
      .from("placement_tests")
      .update({ status: "error", error_message: message })
      .eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
