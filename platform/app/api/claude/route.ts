import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import type { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
// Multi-PDF generations (adaptive thinking + a 32K output budget) genuinely run
// for minutes. 300s was hit head-on by an 11-attachment, two-syllabus-topic
// generation (Vercel Runtime Timeout Error at exactly 300s) — 800s is the
// actual maximum Vercel allows for Node functions with fluid compute on
// Pro/Enterprise (300s is only the *default*, not a hard ceiling). If this
// project is ever on Hobby, Vercel silently caps this back down to 300s.
export const maxDuration = 800;

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

// How often to emit a 'progress' SSE frame while Claude is still in its
// thinking phase (no visible text yet). Thinking deltas fire very frequently
// — sending one frame per delta would flood the stream for no UI benefit, so
// only every Nth delta is forwarded as a lightweight "still working" pulse.
const THINKING_PROGRESS_EVERY_N_DELTAS = 40;

export async function POST(req: Request) {
  // Storage paths we resolved for this request, so we can best-effort clean
  // them up once the Anthropic call finishes (success, failure, or abort).
  const resolvedPaths: string[] = [];

  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  }

  const body = (await req.json()) as ClaudeRequestBody;
  if (!body?.system || !Array.isArray(body?.messages)) {
    return NextResponse.json(
      { error: 'Invalid payload. Expected { system, messages[] }' },
      { status: 400 },
    );
  }

  // ── Resolve storage refs into real content blocks ───────────────────────
  // Done eagerly, before the stream opens, so a bad/expired attachment path
  // fails fast with a normal JSON error response the client's existing
  // !res.ok handling already understands — no need to special-case attachment
  // failures inside the SSE protocol below.
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

  let resolvedMessages: { role: 'user' | 'assistant'; content: string | ResolvedBlock[] }[];
  try {
    resolvedMessages = await Promise.all(
      body.messages.map(async (m) => ({
        role: m.role,
        content: Array.isArray(m.content) ? await Promise.all(m.content.map(resolveBlock)) : m.content,
      })),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve attachments';
    console.error('[api/claude] attachment resolution failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // ── Entry diagnostics ────────────────────────────────────────────────────
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
  // visible reply. 32000 gives real headroom for a full Nuanced Analysis
  // packet; the SDK requires streaming above ~21,333 max_tokens, which this
  // route now does end-to-end rather than just internally.
  const claudeStream = client.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 32000,
    system: body.system,
    messages: resolvedMessages as Anthropic.MessageParam[],
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed (e.g. client disconnected mid-stream) — ignore.
        }
      }

      let thinkingDeltaCount = 0;
      claudeStream.on('thinking', () => {
        thinkingDeltaCount++;
        if (thinkingDeltaCount % THINKING_PROGRESS_EVERY_N_DELTAS === 1) {
          send('progress', { phase: 'thinking' });
        }
      });
      claudeStream.on('text', (_delta, snapshot) => {
        send('progress', { phase: 'writing', charCount: snapshot.length });
      });

      try {
        const response = await claudeStream.finalMessage();

        // Response-shape diagnostics: with this line, "request completed but
        // nothing was generated" is always attributable from the logs alone.
        const blocksSummary = response.content
          .map((b) => (b.type === 'text' ? `text(${b.text.length} chars)` : b.type))
          .join(', ');
        console.log(
          `[api/claude] response stop_reason=${response.stop_reason} blocks=[${blocksSummary}] usage=${JSON.stringify(response.usage)}`,
        );
        if (response.stop_reason === 'max_tokens') {
          console.error('[api/claude] response truncated at max_tokens — output will likely fail to parse client-side.');
        }

        send('done', { message: response });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Claude API error';
        console.error('[api/claude] request failed:', message);
        send('error', { message });
      } finally {
        if (resolvedPaths.length > 0) {
          const { error } = await supabase.storage.from(UPLOADS_BUCKET).remove(resolvedPaths);
          if (error) console.error('[api/claude] cleanup failed for', resolvedPaths, error.message);
        }
        closed = true;
        controller.close();
      }
    },
    cancel() {
      // The client disconnected (e.g. closed the tab) — stop burning Anthropic
      // API time on a response nobody will read.
      claudeStream.abort();
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable any intermediary buffering (e.g. nginx-style proxies) that
      // would otherwise defeat the point of streaming heartbeats.
      'X-Accel-Buffering': 'no',
    },
  });
}
