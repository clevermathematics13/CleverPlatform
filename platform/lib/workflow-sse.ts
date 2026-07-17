import type { NuancedAnalysisChunk } from '@/workflows/nuanced-analysis-generation';

/**
 * Encodes the workflow's typed NuancedAnalysisChunk objects into the SSE
 * wire format platform/app/dashboard/assignments/activity-generator.tsx's
 * readClaudeStream already parses. Shared between the initial POST route
 * (platform/app/api/claude/route.ts) and the resume/reconnect GET route
 * (platform/app/api/claude/resume/[runId]/route.ts) so both produce
 * byte-identical framing — the client doesn't know or care which one it's
 * currently reading from.
 */
export function chunkToSseTransform(): TransformStream<NuancedAnalysisChunk, Uint8Array> {
  const encoder = new TextEncoder();
  return new TransformStream<NuancedAnalysisChunk, Uint8Array>({
    transform(chunk, controller) {
      const data =
        chunk.type === 'done'
          ? { message: { content: [{ type: 'text', text: chunk.text }], stop_reason: chunk.stopReason } }
          : chunk.type === 'error'
            ? { message: chunk.message }
            : { phase: chunk.phase, charCount: chunk.charCount };
      controller.enqueue(encoder.encode(`event: ${chunk.type}\ndata: ${JSON.stringify(data)}\n\n`));
    },
  });
}

export function sseResponseHeaders(runId: string): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable any intermediary buffering (e.g. nginx-style proxies) that
    // would otherwise defeat the point of streaming heartbeats.
    'X-Accel-Buffering': 'no',
    // The client uses this to reconnect via /api/claude/resume/[runId] if
    // this connection gets cut off before the workflow finishes — expected
    // for generations that, combined across steps, run longer than this
    // route's own ~300s ceiling (see that route's comments for why the
    // route itself is bound by that even though individual workflow steps
    // aren't).
    'x-workflow-run-id': runId,
  };
}
