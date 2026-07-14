import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { SYSTEM_PROMPT, LATEX_TEMPLATE } from "@/lib/prompt";
import { getApiTeacher } from "@/lib/auth";
import { sanitizeJsonBackslashes } from "@/lib/json-repair";

export const runtime = "nodejs";
// A full Nuanced Analysis packet at max_tokens: 32000 with adaptive thinking can
// genuinely take several minutes — matches the ceiling already used by the other
// heavy Claude/Drive routes in this codebase (import-from-drive, sync-drive-docs).
export const maxDuration = 300;

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

    // The Anthropic TypeScript SDK requires streaming for non-streaming requests
    // whose max_tokens exceeds ~21,333, since a single buffered HTTP response that
    // large risks exceeding a 10-minute timeout. .stream().finalMessage() streams
    // under the hood but still hands back the same Message object .create() would
    // — nothing else in this route needs to change.
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-5",
      // A full Nuanced Analysis packet (rich JSON schema + an entire XeLaTeX
      // document as one field) plus adaptive-thinking tokens sharing the same
      // budget genuinely needs headroom — 8192 was cutting responses off mid-JSON.
      max_tokens: 32000,
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
    const message = await stream.finalMessage();

    if (message.stop_reason === "max_tokens") {
      console.error(
        "CLAUDE RESPONSE TRUNCATED: hit max_tokens before finishing a turn. Usage:",
        message.usage,
      );
    }

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
      const truncationHint =
        message.stop_reason === "max_tokens"
          ? " Claude's response was cut off by the max_tokens limit before any JSON object was completed."
          : "";
      throw new Error("Claude's response did not contain a JSON object." + truncationHint);
    }

    // Repair the single most common way this model breaks JSON in this route:
    // raw, unescaped backslashes from LaTeX (\binom, \frac, \theta...) inside a
    // JSON string value. Safe to run unconditionally — it's a no-op on input
    // that's already correctly escaped (see lib/json-repair.ts for the full
    // explanation and why a naive "double every backslash" regex is unsafe here).
    const sanitizedJson = sanitizeJsonBackslashes(jsonMatch[0]);

    let aiResponse;
    try {
      aiResponse = JSON.parse(sanitizedJson);
    } catch (parseError: any) {
      const positionMatch =
        typeof parseError?.message === "string" ? parseError.message.match(/position (\d+)/) : null;
      const position = positionMatch ? Number(positionMatch[1]) : null;
      const context =
        position !== null
          ? sanitizedJson.slice(Math.max(0, position - 300), position + 300)
          : sanitizedJson.slice(0, 2000);

      console.error("JSON PARSE ERROR:", parseError?.message);
      console.error("STOP REASON:", message.stop_reason, "USAGE:", message.usage);
      console.error("CONTEXT AROUND FAILURE POSITION:", context);
      console.error("FULL SANITIZED JSON LENGTH:", sanitizedJson.length);
      console.error("FULL SANITIZED JSON:", sanitizedJson);

      const truncationHint =
        message.stop_reason === "max_tokens"
          ? " Claude's response appears to have been cut off by the max_tokens limit — that is the more likely cause here, not escaping."
          : "";
      throw new Error(
        `Claude generated invalid JSON: ${parseError?.message ?? "unknown parse error"}.${truncationHint} Check Vercel logs for the raw output and exact failure context.`,
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
