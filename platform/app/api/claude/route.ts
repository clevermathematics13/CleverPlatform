import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';

export const runtime = 'nodejs';

type TextBlock = { type: 'text'; text: string };
type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };
type DocumentBlock = { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };
type ContentBlock = TextBlock | ImageBlock | DocumentBlock;

type ClaudeRequestBody = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[];
};

export async function POST(req: Request) {
  try {
    // Only authenticated teachers may call the Claude API
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, user, profile } = auth;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not set' },
        { status: 500 },
      );
    }

    const body = (await req.json()) as ClaudeRequestBody;

    if (!body?.system || !Array.isArray(body?.messages)) {
      return NextResponse.json(
        { error: 'Invalid payload. Expected { system, messages[] }' },
        { status: 400 },
      );
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: body.system,
      messages: body.messages as Anthropic.MessageParam[],
    });

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Claude API error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
