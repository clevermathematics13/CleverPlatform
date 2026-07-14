import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { SYSTEM_PROMPT, LATEX_TEMPLATE } from "@/lib/prompt";
import { getApiTeacher } from "@/lib/auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  try {
    const { topic, specificRequirements } = await request.json();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Create a Nuanced Analysis packet for: ${topic}. 
                    Requirements: ${specificRequirements}
                    Use this LaTeX template: ${LATEX_TEMPLATE}`,
        },
      ],
    });

    // Claude Sonnet 5 has adaptive thinking on by default and cannot disable it,
    // so message.content[0] is frequently a "thinking" block rather than "text" —
    // find the text block by type instead of assuming it's first.
    const textBlock = message.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    const rawText = textBlock?.text ?? "";
    if (!rawText) {
      throw new Error("No text content returned from Claude.");
    }

    // Defensive: pull out the JSON object even if the model adds stray prose or
    // markdown fences despite instructions not to (same pattern as the classify route).
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Claude's response did not contain a JSON object.");
    }

    let aiResponse;
    try {
      aiResponse = JSON.parse(jsonMatch[0]);
    } catch (parseError: any) {
      console.error("JSON PARSE ERROR. RAW CLAUDE OUTPUT:", rawText);
      throw new Error(
        "Claude generated invalid JSON (likely an unescaped quote or backslash). Check Vercel logs for the raw output.",
      );
    }

    // Map to the real nuanced_analyses columns. Array-typed columns fall back to
    // [] rather than passing a malformed value through — Postgres rejects a string
    // where a text[]/jsonb array is expected, and a bad insert here would fail
    // every single generation.
    const { data, error } = await supabase
      .from("nuanced_analyses")
      .insert([
        {
          slug: aiResponse.slug,
          title: aiResponse.title,
          subtitle: aiResponse.subtitle ?? null,
          course: aiResponse.course,
          syllabus_topics: Array.isArray(aiResponse.syllabus_topics)
            ? aiResponse.syllabus_topics
            : [],
          prerequisites: Array.isArray(aiResponse.prerequisites)
            ? aiResponse.prerequisites
            : [],
          materials: aiResponse.materials ?? null,
          vocabulary: Array.isArray(aiResponse.vocabulary) ? aiResponse.vocabulary : [],
          atl_statement: aiResponse.atl_statement ?? null,
          tok_provocations: Array.isArray(aiResponse.tok_provocations)
            ? aiResponse.tok_provocations
            : [],
          parts: Array.isArray(aiResponse.parts) ? aiResponse.parts : [],
          teacher_companion: aiResponse.teacher_companion ?? null,
          latex_content: aiResponse.latex_content ?? null,
          sort_order: 0,
          is_published: false,
        },
      ])
      .select();

    if (error) throw error;
    return Response.json({ success: true, packet: data[0] });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
