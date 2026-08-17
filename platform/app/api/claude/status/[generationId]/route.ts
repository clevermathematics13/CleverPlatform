import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import { createClient as createServiceSupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 15;

/**
 * GET /api/claude/status/[generationId]
 *
 * Ground truth for "is this generation alive, finished, or dead?".
 *
 * WHY THIS EXISTS: the client used to infer run health purely from whether
 * its SSE connection stayed open. That inference is wrong in both
 * directions, and production logs (2026-08-17) caught it failing both ways:
 *
 *   - A HEALTHY run looked dead. Connections were being killed by a ~121s
 *     idle timeout, and after six reconnects the client gave up and threw
 *     the result away - while the workflow went on to finish normally
 *     (nuanced_generation_logs shows stop_reason=end_turn, no error). The
 *     packet existed; the browser just never learned about it.
 *
 *   - A DEAD run looked healthy. When the generation step exceeded the 300s
 *     function ceiling (504, then workflow retries that restart the call
 *     from scratch), the client happily reconnected for twelve minutes to a
 *     stream that was never going to emit anything.
 *
 * Polling this endpoint collapses both cases: a finished run hands back its
 * text no matter how many sockets died along the way, and a failed run is
 * reported as failed within one poll interval instead of a retry budget.
 *
 * Reads with the service-role key because nuanced_generation_runs has RLS
 * enabled with no policies - the route is itself teacher-gated by
 * getApiTeacher, which is the access check that matters here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const { generationId } = await params;
  if (!generationId) {
    return NextResponse.json({ error: 'Missing generation id' }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from('nuanced_generation_runs')
    .select('run_id, status, phase, pass_count, char_count, result_text, error, created_at, updated_at')
    .eq('run_id', generationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    // The workflow writes its first status row before doing any real work,
    // so a missing row means the run has not started yet (poll again) rather
    // than that it failed. The client distinguishes these by age.
    return NextResponse.json({ status: 'unknown', generationId }, { status: 200 });
  }

  return NextResponse.json(
    {
      generationId: data.run_id,
      status: data.status as 'running' | 'succeeded' | 'failed',
      phase: data.phase,
      passCount: data.pass_count,
      charCount: data.char_count,
      // Only sent once terminal, to keep poll responses small while running.
      text: data.status === 'succeeded' ? data.result_text : null,
      error: data.error,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
    { status: 200 },
  );
}
