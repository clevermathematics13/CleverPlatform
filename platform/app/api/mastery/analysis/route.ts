import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

/**
 * POST /api/mastery/analysis
 * Body: FormData
 *   - studentId: string
 *   - file_0, file_1, file_2 (optional): File (PDF or image)
 *   - file_0_type, file_1_type, file_2_type: mime type strings
 *
 * If files are attached, Claude reads them as document/image content blocks
 * so the analysis is grounded in the actual exam paper or student work.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  // ── 1. Parse FormData (supports both JSON and FormData for backwards compat) ─

  let studentId: string = profile.id;
  const attachedFiles: { name: string; type: string; base64: string }[] = [];

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    studentId = (form.get("studentId") as string | null) ?? profile.id;

    for (let i = 0; i < 3; i++) {
      const fileEntry = form.get(`file_${i}`);
      const mimeType = (form.get(`file_${i}_type`) as string | null) ?? "";
      if (!fileEntry || !(fileEntry instanceof Blob)) break;

      const arrayBuffer = await fileEntry.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      // Convert to base64 in chunks to avoid call-stack limits
      const CHUNK = 8192;
      let b64 = "";
      for (let j = 0; j < bytes.length; j += CHUNK) {
        b64 += String.fromCharCode(...bytes.subarray(j, j + CHUNK));
      }
      const base64 = btoa(b64);
      const fileName = fileEntry instanceof File ? fileEntry.name : `attachment_${i}`;
      attachedFiles.push({ name: fileName, type: mimeType, base64 });
    }
  } else {
    // Legacy JSON path (no files)
    const body = (await request.json()) as { studentId?: string };
    studentId = body.studentId ?? profile.id;
  }

  if (profile.role === "student" && studentId !== profile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 2. Fetch mastery data ─────────────────────────────────────────────────

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
    return NextResponse.json(
      { error: "No mastery data available yet — complete at least one reflection first." },
      { status: 400 }
    );
  }

  // ── 3. Build target profile ───────────────────────────────────────────────

  const SECTION_NAMES: Record<number, string> = {
    1: "Number & Algebra",
    2: "Functions",
    3: "Geometry & Trig",
    4: "Stats & Probability",
    5: "Calculus",
  };

  type MasteryLine = {
    code: string; descriptor: string; section: number;
    sectionName: string; pct: number; selfPct: number; total: number;
  };

  const lines: MasteryLine[] = [];
  for (const [code, data] of agg) {
    if (data.total === 0) continue;
    const meta = subtopicMap.get(code);
    const sec = meta?.section ?? 0;
    lines.push({
      code, descriptor: meta?.descriptor ?? code, section: sec,
      sectionName: SECTION_NAMES[sec] ?? `Section ${sec}`,
      pct: Math.round((100 * data.awarded) / data.total),
      selfPct: Math.round((100 * data.self) / data.total),
      total: data.total,
    });
  }

  const sorted = [...lines].sort((a, b) => a.pct - b.pct);
  const weakest = sorted.slice(0, Math.min(3, sorted.length));
  const strongest = [...lines].sort((a, b) => b.pct - a.pct).slice(0, 2);

  const weakLines = weakest
    .map((l) => `  • ${l.code} (${l.sectionName}) — "${l.descriptor}" — ${l.pct}% teacher, ${l.selfPct}% self`)
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

  // ── 4. Build Claude message content blocks ────────────────────────────────

  // Text prompt
  const textBlock: Anthropic.TextBlockParam = {
    type: "text",
    text: `Generate a complete Nuanced Analysis packet for an IB Mathematics AA HL student.

STUDENT MASTERY DATA:
Weakest subtopics (target these):
${weakLines}

Strongest subtopics (anchor prior knowledge here):
${strongLines}

TARGET THREAD: Weave together ${targetTopics} into a single compelling mathematical thread.
SYLLABUS TOPICS TO COVER: ${topicList}
${
  attachedFiles.length > 0
    ? `\nATTACHED FILES (${attachedFiles.length}): The teacher has attached ${attachedFiles.map((f) => `"${f.name}"`).join(", ")}. Read these carefully — use the actual questions, mark scheme criteria, and student errors you find in them to make the packet directly relevant to this student's specific gaps.\n`
    : ""
}
Generate the FULL packet (1500–2500 words of student-facing content). Follow every structural requirement in the system prompt. Include all 10 sections. Do NOT write a short paragraph — write the complete investigation.`,
  };

  // File content blocks (PDFs as documents, images as images)
  const fileBlocks: Array<Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam> = [];

  for (const f of attachedFiles) {
    if (f.type === "application/pdf") {
      fileBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: f.base64,
        },
      } as Anthropic.DocumentBlockParam);
    } else if (f.type.startsWith("image/")) {
      const imgType = f.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      fileBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: imgType,
          data: f.base64,
        },
      } as Anthropic.ImageBlockParam);
    }
  }

  // ── 5. Prompt ─────────────────────────────────────────────────────────────

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
- At least one "Broken Math Critique" planted-error question, framed: "The following working was submitted by a student. Your job is not to judge — errors like this reveal important distinctions. Find the slip."
- Each Part ends with: > **Geometric / Physical Reading.** [1–2 sentences translating algebra into spatial/real-world meaning]
- Every "Describe" or "Sketch" task includes: *(You may answer with an annotated diagram.)*
- Every "Explain" task includes: *(You may answer in bullet points.)*
- Every "Hence" reference explicitly names what result to use.

---
## SECTION 8 — REFLECTION
(a) Concept-map table: | Concept | Where it appeared | How it connected to another concept |
(b) Meta-question: what is gained by having two representations/proofs of the same result?
(c) Return to one TOK provocation. Position-statement frame:
    "I argue that [claim]. My evidence from this packet is [specific result]. A counterargument would be [X], but I respond that [Y]."
Oral alternative: "You may respond to any reflection question orally — ask your teacher to record a voice memo."

---
## SECTION 9 — EXTENSION & IA-SEEDING
Label: **Optional — choose one.**
At least two branches from different IB topic areas. Deliberately under-specified. Each has a one-line IA relevance note.

---
## SECTION 10 — TEACHER'S COMPANION
Separated by --- and # Teacher's Companion heading.
A. Integration Map: IB element → question number(s).
B. Model's "moves" located: bulleted list.
C. Answer Sketches for every question. Planted-error key: (i) correct answer, (ii) misconception name, (iii) HL concept it distinguishes.
D. Tiered Deadline Guidance.
E. Compulsory Core List.
F. Differentiation Note: ELL, neurodivergent, prior-knowledge gaps, gifted.
G. Design Note: honest statement of integration depth.

---
MATHEMATICS QUALITY STANDARDS:
- LaTeX: inline $...$ and display $$...$$.
- Every claim proved, conjectured with evidence, or cited to the formula booklet.
- Arc: conjecture → numerical investigation → proof → application → reflection.
- Non-calculator (Paper 1 style) for proof/algebra; GDC permitted for technology sections.
${
  attachedFiles.length > 0
    ? `\nATTACHED DOCUMENT INSTRUCTIONS: The user has uploaded ${attachedFiles.length} file(s). Read them carefully. If they are exam papers: extract the specific questions this student struggled with and build Part questions that directly re-teach those exact techniques. If they are mark schemes: use the mark scheme criteria to inform what the Teacher's Companion answer sketches say. If they are student work: identify the specific errors and use the Broken Math Critique section to surface those exact misconceptions.`
    : ""
}`;

  // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build the user message: file blocks first (so Claude "reads" them), then the text prompt
  const userContent: Array<Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [
    ...fileBlocks,
    textBlock,
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const analysisText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  if (!analysisText) {
    return NextResponse.json({ error: "Empty response from AI" }, { status: 500 });
  }

  // ── 7. Upsert to mastery_analyses ─────────────────────────────────────────

  const generatedAt = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from("mastery_analyses")
    .upsert(
      { student_id: studentId, analysis_text: analysisText, generated_at: generatedAt },
      { onConflict: "student_id" }
    );

  if (upsertError) {
    console.error("[mastery/analysis] upsert error:", upsertError.message);
  }

  return NextResponse.json({ analysis_text: analysisText, generated_at: generatedAt });
}
