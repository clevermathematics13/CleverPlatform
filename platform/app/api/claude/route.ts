import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import { start } from 'workflow/api';
import { chunkToSseTransform, sseResponseHeaders } from '@/lib/workflow-sse';
import {
  generateNuancedAnalysis,
  type IncomingMessage,
  type NuancedAnalysisChunk,
} from '@/workflows/nuanced-analysis-generation';

export const runtime = 'nodejs';
// CORRECTION: this route's own invocation is what holds the streaming HTTP
// response open to the browser, and that invocation is bound by maxDuration
// same as any other function — the workflow's steps running unbounded in
// total does NOT exempt this proxying route from its own ~300s ceiling. A
// generation whose steps combined (attachment resolution + both Claude
// passes + cleanup) take longer than that gets its connection to the
// browser killed mid-stream, even though every individual step succeeded.
//
// The actual fix for that is reconnection, not a bigger number here: the
// client (readClaudeStream in activity-generator.tsx) treats a stream that
// ends without a 'done'/'error' chunk as expected-and-recoverable, and
// reconnects to /api/claude/resume/[runId] with the chunk count it already
// received — that route resumes the SAME workflow run's stream via
// run.getReadable({ startIndex }), picking up exactly where this one left
// off. This is the pattern Vercel's own SDK is built around; its docs list
// "Vercel Function timeouts" by name as what stream resumption solves.
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

  const sseStream = run.getReadable<NuancedAnalysisChunk>().pipeThrough(chunkToSseTransform());

  return new Response(sseStream, {
    status: 200,
    headers: sseResponseHeaders(run.runId),
  });
}
