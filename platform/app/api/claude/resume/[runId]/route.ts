import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import { getRun } from 'workflow/api';
import { toSseStream, sseResponseHeaders } from '@/lib/workflow-sse';
import type { NuancedAnalysisChunk } from '@/workflows/nuanced-analysis-generation';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Resumes reading a workflow run's stream from a given chunk index. Used by
 * the client when its connection to /api/claude (or a previous call to this
 * same route) gets cut off before the run's 'done'/'error' chunk arrives.
 *
 * Reconnecting here is now a best-effort optimisation for live progress, not
 * the mechanism that delivers the result: the client independently polls
 * /api/claude/status/[generationId], so a finished packet is recoverable
 * even if every single reconnect fails. See that route for why.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const startIndexParam = searchParams.get('startIndex');
  const startIndex = startIndexParam ? parseInt(startIndexParam, 10) : undefined;
  const generationId = searchParams.get('generationId') ?? undefined;

  let sseStream: ReadableStream<Uint8Array>;
  try {
    const run = getRun<unknown>(runId);
    sseStream = toSseStream(run.getReadable<NuancedAnalysisChunk>({ startIndex }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not resume this generation run.';
    console.error(`[api/claude/resume] failed to resume run ${runId} at startIndex=${startIndex}:`, message);
    return NextResponse.json({ error: message }, { status: 404 });
  }

  return new Response(sseStream, {
    status: 200,
    headers: sseResponseHeaders(runId, generationId),
  });
}
