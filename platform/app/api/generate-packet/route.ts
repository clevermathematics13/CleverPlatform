import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { SYSTEM_PROMPT, LATEX_TEMPLATE } from "@/lib/prompt";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Builds a URL-safe, unique slug for nuanced_analyses.slug (unique, required).
function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Date.now().toString(36);
  return `${base || "packet"}-${suffix}`;
}

export async function POST(request: Request) {
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
                    Use this template: ${LATEX_TEMPLATE}`,
        },
      ],
    });

    // Claude Sonnet 5 has adaptive thinking on by default and cannot disable it,
    // so message.content[0] is frequently a "thinking" block rather than "text" —
    // find the text block by type instead of assuming it's first.
    const textBlock = message.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    const text = textBlock?.text ?? "";
    const aiResponse = JSON.parse(text);

    const { data, error } = await supabase
      .from("nuanced_analyses")
      .insert([
        {
          slug: slugify(topic),
          title: topic,
          latex_content: aiResponse.latex_code,
          parts: Array.isArray(aiResponse.interactive_components)
            ? aiResponse.interactive_components
            : [],
        },
      ])
      .select();

    if (error) throw error;
    return Response.json({ success: true, packet: data[0] });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
