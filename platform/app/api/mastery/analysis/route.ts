import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

/**
 * POST /api/mastery/analysis
 * Body: { studentId: string }
 *
 * Teacher or the student themselves can request a generation.
 * Generates a nuanced analysis via Claude Haiku, upserts it to
 * mastery_analyses (one row per student — latest always wins),
 * and returns { analysis_text, generated_at }.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const body = await request.json() as { studentId?: string };
  const studentId = body.studentId ?? profile.id;

  // Students can only generate for themselves.
  if (profile.role === "student" && studentId !== profile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 1. Fetch mastery data ─────────────────────────────────────────────────
  const { data: marks } = await supabase
    .from("student_marks")
    .select("marks_awarded, test_item_id, test_items(max_marks, subtopic_codes)")
    .eq("student_id", studentId);

  const { data: selfScores } = await supabase
    .from("student_self_scores")
    .select("self_marks, test_item_id, test_items(max_marks, subtopic_codes)")
    .eq("student_id", studentId);

  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("code, descriptor, section");

  const subtopicMap = new Map(
    (subtopics ?? []).map((s) => [s.code, { descriptor: s.descriptor, section: s.section as number }])
  );

  // Aggregate marks by subtopic
  const agg = new Map<string, { total: number; awarded: number; self: number }>();
  for (const m of marks ?? []) {
    const item = m.test_items as unknown as { max_marks: number; subtopic_codes: string[] } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.total += item.max_marks;
      cur.awarded += m.marks_awarded;
      agg.set(code, cur);
    }
  }
  for (const s of selfScores ?? []) {
    const item = s.test_items as unknown as { max_marks: number; subtopic_codes: string[] } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.self += s.self_marks;
      if (!agg.has(code) || cur.total === 0) cur.total += item.max_marks;
      agg.set(code, cur);
    }
  }

  if (agg.size === 0) {
    return NextResponse.json({ error: "No mastery data available yet" }, { status: 400 });
  }

  // ── 2. Build a compact mastery summary for the prompt ─────────────────────
  const SECTION_NAMES: Record<number, string> = {
    1: "Number & Algebra",
    2: "Functions",
    3: "Geometry & Trig",
    4: "Stats & Probability",
    5: "Calculus",
  };

  // Group by section, sort by percentage ascending (weakest first for prominence)
  type MasteryLine = { code: string; descriptor: string; section: number; pct: number; selfPct: number; total: number };
  const lines: MasteryLine[] = [];
  for (const [code, data] of agg) {
    if (data.total === 0) continue;
    const meta = subtopicMap.get(code);
    lines.push({
      code,
      descriptor: meta?.descriptor ?? code,
      section: meta?.section ?? 0,
      pct: Math.round((100 * data.awarded) / data.total),
      selfPct: Math.round((100 * data.self) / data.total),
      total: data.total,
    });
  }
  lines.sort((a, b) => a.pct - b.pct);

  // Build section summary table
  const bySec: Record<number, MasteryLine[]> = {};
  for (const l of lines) {
    if (!bySec[l.section]) bySec[l.section] = [];
    bySec[l.section].push(l);
  }

  const summaryLines: string[] = [];
  for (const sec of [1, 2, 3, 4, 5]) {
    const rows = bySec[sec];
    if (!rows?.length) continue;
    summaryLines.push(`\n### ${SECTION_NAMES[sec] ?? `Section ${sec}`}`);
    for (const r of rows) {
      const gap = r.selfPct - r.pct;
      const gapStr = gap > 5 ? ` (self ${r.selfPct}%, gap +${gap}pp)` : gap < -5 ? ` (self ${r.selfPct}%, gap ${gap}pp)` : "";
      summaryLines.push(`- ${r.code} ${r.descriptor}: ${r.pct}%${gapStr}`);
    }
  }

  const overallAw = lines.reduce((s, l) => s + (l.pct / 100) * l.total, 0);
  const overallTot = lines.reduce((s, l) => s + l.total, 0);
  const overallPct = overallTot > 0 ? Math.round((overallAw / overallTot) * 100) : 0;

  const prompt = `You are an experienced IB Mathematics AA HL teacher writing a personalised mastery analysis for one of your students.

Overall mastery: ${overallPct}% across ${lines.length} assessed subtopics.

Subtopic breakdown (teacher-marked %; self-assessed gap noted when significant):
${summaryLines.join("\n")}

Write a concise, honest, and encouraging nuanced analysis (250–350 words) covering:
1. Strengths to celebrate (highest-performing subtopics and sections).
2. Priority areas for improvement (lowest-performing subtopics — be specific about what exactly needs work).
3. Any significant self-assessment gaps (where the student over- or under-rates themselves).
4. One or two concrete next-step recommendations.

Write in second person ("you", "your") as if speaking directly to the student. Use precise IB mathematical language. Do NOT list raw percentages — synthesise them into insight. Be warm but honest.`;

  // ── 3. Call Claude Haiku ──────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const analysisText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  if (!analysisText) {
    return NextResponse.json({ error: "Empty response from AI" }, { status: 500 });
  }

  // ── 4. Upsert to mastery_analyses ─────────────────────────────────────────
  const generatedAt = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from("mastery_analyses")
    .upsert(
      { student_id: studentId, analysis_text: analysisText, generated_at: generatedAt },
      { onConflict: "student_id" }
    );

  if (upsertError) {
    // Non-fatal if table doesn't exist yet — return the text anyway so the UI works
    console.error("[mastery/analysis] upsert error:", upsertError.message);
  }

  return NextResponse.json({ analysis_text: analysisText, generated_at: generatedAt });
}
