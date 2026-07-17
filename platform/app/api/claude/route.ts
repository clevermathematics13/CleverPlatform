import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import { start } from 'workflow/api';
import {
  generateNuancedAnalysis,
  type IncomingMessage,
  type NuancedAnalysisChunk,
} from '@/workflows/nuanced-analysis-generation';

export const runtime = 'nodejs';
// This route itself only starts the workflow and pipes its stream — the
// actual Claude generation happens in workflow steps, each bound by their
// own ~300s ceiling independent of this route (see
// platform/workflows/nuanced-analysis-generation.ts for why generation is
// split into two passes to stay under that ceiling). 300s here is already
// generous headroom for what this route actually does.
export const maxDuration = 300;

type ClaudeRequestBody = {
  system: string;
  messages: IncomingMessage[];
};

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as ClaudeRequestBody;
  if (!body?.system || !Array.isArray(body?.messages)) {
    return NextResponse.json(
      { error: 'Invalid payload. Expected { system, messages[] }' },
      { status: 400 },
    );
  }

  const contentLength = req.headers.get('content-length') ?? 'unknown';
  console.log(
    `[api/claude] starting workflow: content-length=${contentLength} messages=${body.messages.length}`,
  );

  // start() enqueues the run and returns immediately — it does not wait for
  // the workflow to complete. The generation itself (attachment resolution,
  // both Claude passes, cleanup) runs as durable steps outside this
  // request's lifetime.
  const run = await start(generateNuancedAnalysis, [body.system, body.messages]);

  // run.getReadable() yields the typed NuancedAnalysisChunk objects the
  // workflow writes via getWritable() — pipe them through a small transform
  // into the same SSE wire format platform/app/dashboard/assignments/
  // activity-generator.tsx's readClaudeStream already parses, so the client
  // needed only a modest extension (new progress phase labels) rather than
  // a rewrite.
  const encoder = new TextEncoder();
  const sseStream = run.getReadable<NuancedAnalysisChunk>().pipeThrough(
    new TransformStream<NuancedAnalysisChunk, Uint8Array>({
      transform(chunk, controller) {
        const data =
          chunk.type === 'done'
            ? { message: { content: [{ type: 'text', text: chunk.text }], stop_reason: chunk.stopReason } }
            : chunk.type === 'error'
              ? { message: chunk.message }
              : { phase: chunk.phase, charCount: chunk.charCount };
        controller.enqueue(encoder.encode(`event: ${chunk.type}\ndata: ${JSON.stringify(data)}\n\n`));
      },
    }),
  );

  return new Response(sseStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable any intermediary buffering (e.g. nginx-style proxies) that
      // would otherwise defeat the point of streaming heartbeats.
      'X-Accel-Buffering': 'no',
      // Exposed so a future reconnect-after-refresh feature could resume
      // reading via run.getReadable({ startIndex }) — not consumed yet.
      'x-workflow-run-id': run.runId,
    },
  });
}
