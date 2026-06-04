import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

/**
 * POST /api/mastery/analysis
 * Body: { studentId: string }
 *
 * Generates a full Nuanced Analysis investigation packet (not a summary paragraph)
 * targeted at the student's weakest subtopics, following the design spec in
 * DESIGN_INSTRUCTIONS.md. Upserts to mastery_analyses (one row per student).
 */
export async function POST(request: NextRequest) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const body = (await request.json()) as { studentId?: string };
  const studentId = body.studentId ?? profile.id;

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
    (subtopics ?? []).map((s) => [
      s.code,
      { descriptor: s.descriptor, section: s.section as number },
    ])
  );

  // Aggregate marks by subtopic code
  const agg = new Map<string, { total: number; awarded: number; self: number }>();
  for (const m of marks ?? []) {
    const item = m.test_items as unknown as {
      max_marks: number;
      subtopic_codes: string[];
    } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.total += item.max_marks;
      cur.awarded += m.marks_awarded;
      agg.set(code, cur);
    }
  }
  for (const s of selfScores ?? []) {
    const item = s.test_items as unknown as {
      max_marks: number;
      subtopic_codes: string[];
    } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.self += s.self_marks;
      if (!agg.has(code) || cur.total === 0) cur.total += item.max_marks;
      agg.set(code, cur);
    }
  }

  if (agg.size === 0) {
    return NextResponse.json(
      { error: "No mastery data available yet — complete at least one reflection first." },
      { status: 400 }
    );
  }

  // ── 2. Build target profile ───────────────────────────────────────────────

  const SECTION_NAMES: Record<number, string> = {
    1: "Number & Algebra",
    2: "Functions",
    3: "Geometry & Trig",
    4: "Stats & Probability",
    5: "Calculus",
  };

  type MasteryLine = {
    code: string;
    descriptor: string;
    section: number;
    sectionName: string;
    pct: number;
    selfPct: number;
    total: number;
  };

  const lines: MasteryLine[] = [];
  for (const [code, data] of agg) {
    if (data.total === 0) continue;
    const meta = subtopicMap.get(code);
    const sec = meta?.section ?? 0;
    lines.push({
      code,
      descriptor: meta?.descriptor ?? code,
      section: sec,
      sectionName: SECTION_NAMES[sec] ?? `Section ${sec}`,
      pct: Math.round((100 * data.awarded) / data.total),
      selfPct: Math.round((100 * data.self) / data.total),
      total: data.total,
    });
  }

  // Weakest 2–3 with enough marks data; strongest 2 for prior-knowledge anchors
  const sorted = [...lines].sort((a, b) => a.pct - b.pct);
  const weakest = sorted.slice(0, Math.min(3, sorted.length));
  const strongest = [...lines].sort((a, b) => b.pct - a.pct).slice(0, 2);

  const weakLines = weakest
    .map(
      (l) =>
        `  • ${l.code} (${l.sectionName}) — "${l.descriptor}" — ${l.pct}% teacher, ${l.selfPct}% self`
    )
    .join("\n");
  const strongLines = strongest
    .map((l) => `  • ${l.code} (${l.sectionName}) — "${l.descriptor}" — ${l.pct}%`)
    .join("\n");

  const targetTopics = weakest
    .map((l) => `${l.sectionName} (${l.code}: ${l.descriptor})`)
    .join(", ");

  const topicNumbers = [...new Set(weakest.map((l) => l.section))].sort();
  const topicList = topicNumbers
    .map((n) => `Topic ${n} (${SECTION_NAMES[n] ?? `Section ${n}`})`)
    .join(" · ");

  // ── 3. Prompt ─────────────────────────────────────────────────────────────

  const SYSTEM = `You are an expert IBDP Mathematics AA HL teacher and curriculum designer.
You write Nuanced Analysis investigation packets — structured, multi-part guided investigations.

A Nuanced Analysis is NOT a short written feedback paragraph. It is a COMPLETE INVESTIGATION PACKET,
similar in length and structure to a Paper 3 investigation. Student-facing content: 1500–2500 words.

MANDATORY STRUCTURAL SPEC — produce every section, in this exact order:

---
## SECTION 1 — HEADER BLOCK
# Nuanced Analysis: [Title — a subtitle naming the unifying idea]

**Student Name:** ________________________  **Date:** ____________

**Course:** IBDP Mathematics — Analysis & Approaches HL
**Syllabus Topic(s):** [Topic numbers and names]
**Prerequisites:** [Prior activity names — be specific and realistic]

*Materials needed: GDC (TI-84 Plus CE or equivalent) and GeoGebra/Desmos. State which parts are Paper 1 style (no calculator).*

Progress tracker: Part 0 of N ☐ ☐ ☐ … (one box per Part)

Compulsory core: Questions [list ★ and ★★ question numbers here].

---
## SECTION 2 — COMMAND TERMS GLOSSARY (tear-off strip)
Horizontal rules above and below (--- before and after).
A Markdown table of every command term used in this packet: | Term | What it demands |
Demand scale line: "Demand scale (low → high): Write down → Describe → Explain → Deduce → Show that → Prove"
Command-Term Spotlight callout: name the most commonly confused pair in this packet and explain the distinction.

---
## SECTION 3 — VOCABULARY
Bold key terms. One sentence per term.

---
## SECTION 4 — ATL STATEMENT
One sentence naming the ATL skill built.

---
## SECTION 5 — TOK PROVOCATIONS
Exactly two TOK questions. Flag: "(Return to these in the Reflection.)"
Each must be answerable with a specific result from within this packet.

---
## SECTION 6 — INTERNATIONAL MINDEDNESS BOX
At least one historical attribution. Must go beyond Euler — include non-European mathematicians where genuinely connected.

---
## SECTION 7 — PARTS (minimum 4 parts: Part 0, 1, 2, 3)

Each Part:
- Begins with: > **What you need to start this Part:** (2–4 bullets, recap only essentials)
- Questions numbered Q1, Q2(a), Q2(b), etc.
- Each question tagged: ★ (entry, compulsory) | ★★ (standard, compulsory) | ★★★ (extension, optional)
- Conjecture precedes rule (numerical warm-up first, then generalise)
- At least one proof with labelled scaffold: **Base case:** / **Inductive step:** / **Conclusion:** OR **Assume:** / **Derive:** / **Conclude:**
- At least one "Broken Math Critique" planted-error question in the whole packet, framed: "The following working was submitted by a student. Your job is not to judge — errors like this reveal important distinctions. Find the slip."
- Each Part ends with: > **Geometric / Physical Reading.** [1–2 sentences translating algebra into spatial/real-world meaning]
- Every "Describe" or "Sketch" task includes: *(You may answer with an annotated diagram.)*
- Every "Explain" task includes: *(You may answer in bullet points.)*
- Every "Hence" reference explicitly names what result to use.

---
## SECTION 8 — REFLECTION
(a) Concept-map table: | Concept | Where it appeared | How it connected to another concept |
(b) Meta-question: what is gained by having two representations/proofs of the same result?
(c) Return to one TOK provocation. Provide a position-statement frame:
    "I argue that [claim]. My evidence from this packet is [specific result]. A counterargument would be [X], but I respond that [Y]."
Oral alternative note: "You may respond to any reflection question orally — ask your teacher to record a voice memo."

---
## SECTION 9 — EXTENSION & IA-SEEDING
Label: **Optional — choose one.**
At least two branches from different IB topic areas. Deliberately under-specified. Each includes a one-line IA relevance note.

---
## SECTION 10 — TEACHER'S COMPANION
Separated by --- and # Teacher's Companion heading.
Contains:
A. Integration Map: table mapping IB element (topic, TOK, ATL, IM, technology, IA seeding, paper alignment, command terms) → question number(s).
B. Model's "moves" located: bulleted list (conjecture-before-rule, planted error, translation table, rule of four, etc. → Q number).
C. Answer Sketches: every question. Planted-error key: (i) correct answer, (ii) misconception name, (iii) HL concept it distinguishes.
D. Tiered Deadline Guidance: which Parts fit a single 50-min lesson vs take-home.
E. Compulsory Core List: explicit question numbers.
F. Differentiation Note: specific guidance for ELL, neurodivergent, prior-knowledge gaps, gifted students.
G. Design Note: honest statement of which topics are genuinely integrated at depth vs extension-only, and why.

---
MATHEMATICS QUALITY STANDARDS:
- LaTeX: inline $...$ and display $$...$$.
- Every claim either proved, conjectured with numerical evidence, or cited to the formula booklet.
- Arc: conjecture → numerical investigation → proof → application → reflection.
- Integration must be earned by the mathematics — never force a topic in for coverage.
- Non-calculator (Paper 1 style) for proof/algebra; GDC permitted for technology sections.`;

  const USER = `Generate a complete Nuanced Analysis packet for an IB Mathematics AA HL student.

STUDENT MASTERY DATA:
Weakest subtopics (target these — the packet should directly address gaps here):
${weakLines}

Strongest subtopics (anchor prior knowledge here):
${strongLines}

TARGET THREAD: Weave together ${targetTopics} into a single compelling mathematical thread.
Choose a unifying idea that makes the connection feel natural and inevitable — not contrived.
(Example of the right spirit: "From $i$ to $e^{i\\pi}$" unified complex numbers, De Moivre, and Maclaurin series.)

SYLLABUS TOPICS TO COVER: ${topicList}

Now generate the FULL packet following every structural requirement above.
Student-facing content must be 1500–2500 words. Include all 10 sections.
Do NOT write a short paragraph. Do NOT write a summary of feedback. Write the investigation.`;

  // ── 4. Generate with claude-sonnet-4-6 ────────────────────────────────────

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: USER }],
  });

  const analysisText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  if (!analysisText) {
    return NextResponse.json({ error: "Empty response from AI" }, { status: 500 });
  }

  // ── 5. Upsert to mastery_analyses ─────────────────────────────────────────

  const generatedAt = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from("mastery_analyses")
    .upsert(
      {
        student_id: studentId,
        analysis_text: analysisText,
        generated_at: generatedAt,
      },
      { onConflict: "student_id" }
    );

  if (upsertError) {
    console.error("[mastery/analysis] upsert error:", upsertError.message);
    // Non-fatal — return the text regardless
  }

  return NextResponse.json({ analysis_text: analysisText, generated_at: generatedAt });
}
