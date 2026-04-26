import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type ClaudeRequestBody = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
};

export async function POST(req: Request) {
  try {
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: body.system,
      messages: body.messages,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Claude API error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
