import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import type { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
// Multi-PDF generations (adaptive thinking + a 32K output budget) genuinely run
// for minutes — same ceiling as the other heavy Claude routes in this codebase.
export const maxDuration = 300;

const UPLOADS_BUCKET = 'uploads';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type TextBlock = { type: 'text'; text: string };
type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };
type DocumentBlock = { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

// ── Storage-ref blocks ───────────────────────────────────────────────────────
// The client no longer sends attachment bytes inline — Vercel serverless
// functions hard-cap request bodies at ~4.5 MB, so a handful of source PDFs
// blew straight through it. Instead the client uploads each attachment to
// Supabase Storage first and sends a small path reference here. This route
// resolves those refs into real base64 blocks itself, server-side — an
// outbound fetch from inside the function isn't subject to that inbound
// body-size cap at all.
type ImageRefBlock = { type: 'image_ref'; path: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' };
type DocumentRefBlock = { type: 'document_ref'; path: string };

type IncomingBlock = TextBlock | ImageBlock | DocumentBlock | ImageRefBlock | DocumentRefBlock;
type ResolvedBlock = TextBlock | ImageBlock | DocumentBlock;

type ClaudeRequestBody = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string | IncomingBlock[] }[];
};

export async function POST(req: Request) {
  // Storage paths we resolved for this request, so we can best-effort clean
  // them up once the Anthropic call finishes (success or failure).
  const resolvedPaths: string[] = [];
  let supabaseForCleanup: SupabaseServerClient | undefined;

  try {
    // Only authenticated teachers may call the Claude API
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase } = auth;
    supabaseForCleanup = supabase;

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

    // ── Resolve storage refs into real content blocks ───────────────────────
    async function resolveBlock(block: IncomingBlock): Promise<ResolvedBlock> {
      if (block.type === 'text' || block.type === 'image' || block.type === 'document') {
        return block;
      }

      const { data, error } = await supabase.storage.from(UPLOADS_BUCKET).download(block.path);
      if (error || !data) {
        throw new Error(
          `Could not read attachment "${block.path}" from storage (it may have expired or already been used): ${error?.message ?? 'not found'}`,
        );
      }
      resolvedPaths.push(block.path);
      const arrayBuffer = await data.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      if (block.type === 'image_ref') {
        return { type: 'image', source: { type: 'base64', media_type: block.mimeType, data: base64 } };
      }
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
    }

    const resolvedMessages = await Promise.all(
      body.messages.map(async (m) => ({
        role: m.role,
        content: Array.isArray(m.content) ? await Promise.all(m.content.map(resolveBlock)) : m.content,
      })),
    );

    // ── Entry diagnostics ────────────────────────────────────────────────────
    // Requests over ~4.5 MB used to never reach this code at all (Vercel's
    // edge 413s them first). Now the wire body is just small path refs, so
    // that ceiling no longer applies to attachments — this log line instead
    // records what got resolved from storage, so failures further down
    // (Anthropic errors, truncation, bad blocks) stay attributable.
    const contentLength = req.headers.get('content-length') ?? 'unknown';
    const lastMessage = resolvedMessages[resolvedMessages.length - 1];
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
      `[api/claude] content-length=${contentLength} messages=${resolvedMessages.length} resolvedAttachments=${resolvedPaths.length} lastTurn=[${lastBlocks}]`,
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
      messages: resolvedMessages as Anthropic.MessageParam[],
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
  } finally {
    // Best-effort cleanup: attachments are single-use. Don't let a cleanup
    // failure affect the response that was already sent above.
    if (resolvedPaths.length > 0 && supabaseForCleanup) {
      supabaseForCleanup.storage
        .from(UPLOADS_BUCKET)
        .remove(resolvedPaths)
        .then(({ error }) => {
          if (error) console.error('[api/claude] cleanup failed for', resolvedPaths, error.message);
        });
    }
  }
}
