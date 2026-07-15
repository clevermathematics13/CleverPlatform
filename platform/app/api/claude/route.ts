import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';

export const runtime = 'nodejs';
// Multi-PDF generations (adaptive thinking + a 32K output budget) genuinely run
// for minutes — same ceiling as the other heavy Claude routes in this codebase.
export const maxDuration = 300;

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

    // claude-sonnet-5's adaptive thinking SHARES the max_tokens budget with the
    // visible reply. At the old 4096 cap, a multi-PDF request could spend the
    // entire budget thinking and return an empty or mid-JSON-truncated text
    // block — the client then failed with "AI response did not include a JSON
    // object" despite this route returning 200. 32000 gives real headroom; the
    // SDK requires streaming above ~21,333, and .stream().finalMessage() hands
    // back the same Message object .create() would (same proven pattern as
    // generate-packet).
    const stream = client.messages.stream({
      model: 'claude-sonnet-5',
      max_tokens: 32000,
      system: body.system,
      messages: body.messages as Anthropic.MessageParam[],
    });
    const response = await stream.finalMessage();

    // Response-shape diagnostics: with this line, "request 200'd but nothing
    // was generated" is always attributable from the logs alone.
    const blocksSummary = response.content
      .map((b) => (b.type === 'text' ? `text(${b.text.length} chars)` : b.type))
      .join(', ');
    console.log(
      `[api/claude] response stop_reason=${response.stop_reason} blocks=[${blocksSummary}] usage=${JSON.stringify(response.usage)}`,
    );
    if (response.stop_reason === 'max_tokens') {
      console.error('[api/claude] response truncated at max_tokens — output will likely fail to parse client-side.');
    }

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Claude API error';
    console.error('[api/claude] request failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
