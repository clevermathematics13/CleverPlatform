import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { proposalParts, readStoredTranscription } from "@/lib/markscheme-build";

// GET /api/questions/markscheme-builds/[id]
// One mark-scheme build as LaTeX Review shows it: why it was flagged, and the
// parts it proposes, ready for the teacher to correct and accept. Loaded when
// the card opens, so the page itself carries only each build's flags.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await params;

  const { data: build, error } = await supabase
    .from("markscheme_builds")
    .select("id, question_id, status, run_id, prompt_version, created_at, transcription, checks, plan, error")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });

  const transcription = readStoredTranscription(build.transcription);
  const checks = (build.checks ?? {}) as { issues?: string[]; warnings?: string[]; resolvedMarks?: (number | null)[] };
  const plan = (build.plan ?? {}) as { flags?: string[]; blocking?: string[] };

  return NextResponse.json({
    build: {
      id: build.id,
      questionId: build.question_id,
      status: build.status,
      runId: build.run_id,
      promptVersion: build.prompt_version,
      createdAt: build.created_at,
      error: build.error,
      issues: checks.issues ?? [],
      warnings: checks.warnings ?? [],
      flags: plan.flags ?? [],
      blocking: plan.blocking ?? [],
    },
    parts: transcription ? proposalParts(transcription, checks.resolvedMarks ?? []) : [],
  });
}
