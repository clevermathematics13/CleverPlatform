import type { NuancedAnalysisChunk } from '@/workflows/nuanced-analysis-generation';

/**
 * Shared SSE encoding for the AI Activity Generator's streaming routes:
 * platform/app/api/claude/route.ts (initial POST) and
 * platform/app/api/claude/resume/[runId]/route.ts (reconnect GET). Both must
 * produce byte-identical framing - the client doesn't know or care which one
 * it is currently reading from.
 *
 * WHY HEARTBEATS: production logs (2026-08-17) showed the browser's
 * connection being torn down after almost exactly 121 seconds, six times in
 * a row, on a run where no generation output happened to be flowing:
 *   05:39:10 POST /api/claude
 *   05:41:13 / 05:43:15 / 05:45:16 / 05:47:17 / 05:49:18 / 05:51:18  resumes
 * That is an idle timeout, not the route's own maxDuration (300s). A
 * generation pass can legitimately produce no visible text for minutes
 * (attachment resolution, then extended thinking before the first token), so
 * without filler bytes the connection is guaranteed to die during exactly
 * the phase it most needs to stay open. A comment frame every
 * HEARTBEAT_INTERVAL_MS keeps the socket warm and is ignored by the client
 * parser, which requires both an `event:` and a `data:` line before it
 * treats a frame as meaningful.
 */

const HEARTBEAT_INTERVAL_MS = 15_000;

function encodeChunk(chunk: NuancedAnalysisChunk): string {
  const data =
    chunk.type === 'done'
      ? { message: { content: [{ type: 'text', text: chunk.text }], stop_reason: chunk.stopReason } }
      : chunk.type === 'error'
        ? { message: chunk.message }
        : { phase: chunk.phase, charCount: chunk.charCount };
  return `event: ${chunk.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Converts the workflow's typed chunk stream into SSE bytes, interleaving
 * keep-alive comment frames so the connection survives idle periods.
 */
export function toSseStream(
  source: ReadableStream<NuancedAnalysisChunk>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = source.getReader();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Consumer went away mid-write; stop trying.
          closed = true;
        }
      };

      heartbeat = setInterval(() => safeEnqueue(': keep-alive\n\n'), HEARTBEAT_INTERVAL_MS);

      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            safeEnqueue(encodeChunk(value));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Generation stream failed';
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
        } finally {
          if (heartbeat) clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // Already closed by the consumer.
            }
          }
        }
      })();
    },
    cancel(reason) {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      void reader.cancel(reason);
    },
  });
}

/**
 * @param runId      the workflow run id, used by the client to reconnect via
 *                   /api/claude/resume/[runId]
 * @param generationId the key the client polls via
 *                   /api/claude/status/[generationId] to read ground truth
 *                   about the run instead of inferring it from socket state
 */
export function sseResponseHeaders(runId: string, generationId?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable any intermediary buffering (e.g. nginx-style proxies) that
    // would otherwise defeat the point of streaming heartbeats.
    'X-Accel-Buffering': 'no',
    'x-workflow-run-id': runId,
  };
  if (generationId) headers['x-generation-id'] = generationId;
  return headers;
}
