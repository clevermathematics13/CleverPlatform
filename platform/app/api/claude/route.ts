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

    // ── Entry diagnostics ────────────────────────────────────────────────────
    // Requests larger than ~4.5 MB never reach this code (Vercel's edge 413s
    // them first), so this log line existing at all proves the body got through.
    // For everything that does arrive, record the size and shape so failures
    // further down (Anthropic errors, truncation, bad blocks) are attributable.
    const contentLength = req.headers.get('content-length') ?? 'unknown';
    const lastMessage = body.messages[body.messages.length - 1];
    const lastBlocks = Array.isArray(lastMessage?.content)
      ? lastMessage.content
          .map((b) => {
            if (b.type === 'text') return `text(${b.text.length} chars)`;
            const dataLen = 'source' in b ? b.source.data.length : 0;
            return `${b.type}(${(dataLen / 1_000_000).toFixed(2)} MB base64)`;
          })
          .join(', ')
      : `text(${String(lastMessage?.content ?? '').length} chars)`;
    console.log(
      `[api/claude] content-length=${contentLength} messages=${body.messages.length} lastTurn=[${lastBlocks}]`,
    );

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
    console.error('[api/claude] request failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
