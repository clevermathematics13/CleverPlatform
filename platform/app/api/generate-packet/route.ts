import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { SYSTEM_PROMPT, LATEX_TEMPLATE } from '@/lib/prompt';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export async function POST(request: Request) {
  try {
    const { topic, specificRequirements } = await request.json();
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Create a Nuanced Analysis packet for: ${topic}. 
                    Requirements: ${specificRequirements}
                    Use this template: ${LATEX_TEMPLATE}`
        }
      ]
    });
    const aiResponse = JSON.parse(message.content[0].text);
    const { data, error } = await supabase
      .from('curriculum_packets')
      .insert([{
          topic_title: topic,
          latex_content: aiResponse.latex_code,
          interactive_data: aiResponse.interactive_components
      }]).select();
    if (error) throw error;
    return Response.json({ success: true, packet: data[0] });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
