import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import { getRun } from 'workflow/api';
import { chunkToSseTransform, sseResponseHeaders } from '@/lib/workflow-sse';
import type { NuancedAnalysisChunk } from '@/workflows/nuanced-analysis-generation';

export const runtime = 'nodejs';
// Same ~300s ceiling as the initial /api/claude route, for the same reason
// (this invocation holds the streaming response open). If a generation
// needs more reconnects than the client's retry budget allows, that's
// tracked client-side in activity-generator.tsx's readClaudeStream, not here.
export const maxDuration = 300;

/**
 * Resumes reading a workflow run's stream from a given chunk index. Used by
 * the client when its connection to /api/claude (or a previous call to this
 * same route) gets cut off before the workflow's 'done'/'error' chunk
 * arrives — expected for generations whose total step time exceeds a single
 * function invocation's duration ceiling. See platform/app/api/claude/
 * route.ts's comments for the full explanation.
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

  let sseStream: ReadableStream<Uint8Array>;
  try {
    const run = getRun<unknown>(runId);
    sseStream = run
      .getReadable<NuancedAnalysisChunk>({ startIndex })
      .pipeThrough(chunkToSseTransform());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not resume this generation run.';
    console.error(`[api/claude/resume] failed to resume run ${runId} at startIndex=${startIndex}:`, message);
    return NextResponse.json({ error: message }, { status: 404 });
  }

  return new Response(sseStream, {
    status: 200,
    headers: sseResponseHeaders(runId),
  });
}
