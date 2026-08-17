import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getApiTeacher } from '@/lib/auth';
import { start } from 'workflow/api';
import { toSseStream, sseResponseHeaders } from '@/lib/workflow-sse';
import {
  generateNuancedAnalysis,
  type IncomingMessage,
  type NuancedAnalysisChunk,
} from '@/workflows/nuanced-analysis-generation';

export const runtime = 'nodejs';

// This route's own invocation holds the streaming HTTP response open to the
// browser, so it is bound by maxDuration like any other function - the
// workflow's steps running durably in the background does NOT exempt it.
//
// In practice the browser's connection dies well before this ceiling: an
// idle timeout was observed cutting connections at ~121s (see
// platform/lib/workflow-sse.ts for the log evidence). Two mechanisms cover
// that, and neither one is this number:
//   1. Heartbeat frames (toSseStream) keep an otherwise-silent connection
//      warm so it stops being cut in the first place.
//   2. If a connection dies anyway, the client reconnects to
//      /api/claude/resume/[runId] and, independently, polls
//      /api/claude/status/[generationId] for ground truth - so a completed
//      run is never lost just because a socket closed.
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

  // Minted here rather than derived from the workflow run id, so the client
  // has a key it can poll for status from the very first moment - including
  // if the initial connection dies before any bytes arrive.
  const generationId = randomUUID();

  const contentLength = req.headers.get('content-length') ?? 'unknown';
  console.log(
    `[api/claude] starting workflow: generationId=${generationId} content-length=${contentLength} messages=${body.messages.length}`,
  );

  // start() enqueues the run and returns immediately - it does not wait for
  // the workflow to complete. The generation itself runs as durable steps
  // outside this request's lifetime.
  const run = await start(generateNuancedAnalysis, [generationId, body.system, body.messages]);

  const sseStream = toSseStream(run.getReadable<NuancedAnalysisChunk>());

  return new Response(sseStream, {
    status: 200,
    headers: sseResponseHeaders(run.runId, generationId),
  });
}
