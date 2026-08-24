import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import {
  GRADING_MODEL,
  GRADING_SYSTEM_PROMPT,
  MAX_SCAN_BYTES,
  SCAN_BUCKET,
  assembleMarkScheme,
  buildGradingStudentPrompt,
  buildGradingUserPrompt,
  unitLabel,
  validateGradeResponse,
} from "@/lib/ai-grading";
import type { GradingUnit } from "@/lib/ai-grading";

export const maxDuration = 300;

/**
 * GET /api/tests/[id]/ai-grade?studentId=...
 * Returns grading runs and their results, for the review UI.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { id: testId } = await params;
  const studentId = request.nextUrl.searchParams.get("studentId");

  let query = supabase
    .from("ai_grade_runs")
    .select("id, test_id, student_id, status, model, source_storage_path, coverage, error, created_at, completed_at")
    .eq("test_id", testId)
    .order("created_at", { ascending: false });

  if (studentId) query = query.eq("student_id", studentId);

  const { data: runs, error } = await query.limit(studentId ? 5 : 100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!runs || runs.length === 0) return NextResponse.json({ runs: [], results: [] });

  const { data: results, error: rErr } = await supabase
    .from("ai_grade_results")
    .select(
      "id, run_id, test_item_id, suggested_marks, max_marks, confidence, markscheme_source, work_found, reasoning, evidence, mark_breakdown, accepted, accepted_at, accepted_by"
    )
    .in(
      "run_id",
      runs.map((r) => r.id)
    );

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  return NextResponse.json({ runs, results: results ?? [] });
}

/**
 * POST /api/tests/[id]/ai-grade
 * Body: {
 *   studentId: string,
 *   storagePath?: string,         // a fresh PDF scan the client already
 *                                  // uploaded to Storage — see below
 *   reuseExistingScan?: boolean   // re-grade the scan already stored
 * }
 *
 * The client uploads the raw PDF directly to Supabase Storage (bucket
 * "exam-scans", path "{testId}/{studentId}/...") BEFORE calling this route —
 * a scanned exam script easily exceeds Vercel's serverless request-body
 * limit as JSON, the same reason the batch-upload route takes a storage path
 * rather than file bytes.
 *
 * Grades one student's scanned script against the mark scheme held in the PPQ
 * bank and stores the outcome in ai_grade_results for teacher review.
 * Nothing is written to student_marks here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { id: testId } = await params;

  let body: {
    studentId?: unknown;
    storagePath?: unknown;
    reuseExistingScan?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
      { status: 500 }
    );
  }

  // -- Context ---------------------------------------------------------------
  const { data: test, error: testErr } = await supabase
    .from("tests")
    .select("id, name")
    .eq("id", testId)
    .maybeSingle();

  if (testErr) return NextResponse.json({ error: testErr.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", studentId)
    .maybeSingle();

  // -- Mark scheme assembly --------------------------------------------------
  let units: GradingUnit[];
  let assemblyWarnings: string[];
  try {
    const assembled = await assembleMarkScheme(supabase, testId);
    units = assembled.units;
    assemblyWarnings = assembled.warnings;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Mark scheme assembly failed" },
      { status: 500 }
    );
  }

  const gradeable = units.filter((u) => u.markschemeSource !== "none");
  if (gradeable.length === 0) {
    return NextResponse.json(
      {
        error:
          "No mark scheme text is stored for any part of this assessment. Extract the mark scheme LaTeX in the PPQ Bank first.",
        warnings: assemblyWarnings,
      },
      { status: 422 }
    );
  }

  // -- Resolve the scan ------------------------------------------------------
  let scanBase64: string;
  let scanStoragePath: string;

  if (typeof body.storagePath === "string" && body.storagePath.length > 0) {
    scanStoragePath = body.storagePath.trim();

    // Guards against pointing this route at an unrelated object in the bucket.
    if (!scanStoragePath.startsWith(`${testId}/${studentId}/`)) {
      return NextResponse.json(
        { error: "storagePath must be under this test and student's own scan folder" },
        { status: 400 }
      );
    }

    const { data: file, error: dlErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .download(scanStoragePath);
    if (dlErr || !file) {
      return NextResponse.json(
        { error: `Could not read the uploaded scan: ${dlErr?.message ?? "not found"}` },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Uploaded scan was empty" }, { status: 400 });
    }
    if (buffer.length > MAX_SCAN_BYTES) {
      return NextResponse.json(
        {
          error: `Scan is ${(buffer.length / 1024 / 1024).toFixed(1)}MB; the limit is 30MB. Reduce the scan resolution or split the file.`,
        },
        { status: 400 }
      );
    }
    if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
      return NextResponse.json(
        { error: "Uploaded file is not a PDF. Combine photos into a single PDF before uploading." },
        { status: 400 }
      );
    }

    scanBase64 = buffer.toString("base64");
  } else if (body.reuseExistingScan === true) {
    const { data: priorRun } = await supabase
      .from("ai_grade_runs")
      .select("source_storage_path")
      .eq("test_id", testId)
      .eq("student_id", studentId)
      .not("source_storage_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!priorRun?.source_storage_path) {
      return NextResponse.json(
        { error: "No previously uploaded scan found for this student on this assessment" },
        { status: 404 }
      );
    }

    scanStoragePath = priorRun.source_storage_path;
    const { data: file, error: dlErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .download(scanStoragePath);

    if (dlErr || !file) {
      return NextResponse.json(
        { error: `Could not download stored scan: ${dlErr?.message ?? "unknown error"}` },
        { status: 500 }
      );
    }
    scanBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  } else {
    return NextResponse.json(
      { error: "Provide storagePath (an uploaded PDF scan) or set reuseExistingScan to true" },
      { status: 400 }
    );
  }

  // -- Open the run ----------------------------------------------------------
  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .insert({
      test_id: testId,
      student_id: studentId,
      created_by: user.id,
      status: "running",
      model: GRADING_MODEL,
      source_storage_path: scanStoragePath,
    })
    .select("id")
    .single();

  if (runErr || !run) {
    return NextResponse.json(
      { error: `Could not create grading run: ${runErr?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  const failRun = async (message: string, status = 500) => {
    await supabase
      .from("ai_grade_runs")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", run.id);
    return NextResponse.json({ error: message, runId: run.id }, { status });
  };

  // -- Grade -----------------------------------------------------------------
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let responseText: string;
  try {
    const message = await anthropic.messages.create({
      model: GRADING_MODEL,
      max_tokens: 16384,
      // Identical for every grading call in the app, so it's always worth caching.
      system: [{ type: "text", text: GRADING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            {
              // Identical for every student on this test — cached so a batch
              // upload only pays full price for the first student's call.
              type: "text",
              text: buildGradingUserPrompt(gradeable, { testName: test.name }),
              cache_control: { type: "ephemeral" },
            },
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: scanBase64 },
            },
            {
              type: "text",
              text: buildGradingStudentPrompt(studentProfile?.display_name ?? undefined),
            },
          ],
        },
      ],
    });

    responseText = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
  } catch (e) {
    return failRun(`Grading request failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!responseText.trim()) return failRun("Model returned an empty response");

  const validation = validateGradeResponse(responseText, gradeable);
  if (!validation.ok) return failRun(validation.error, 502);

  const { grades, warnings } = validation.outcome;

  // -- Persist results -------------------------------------------------------
  const rows = grades.map((g) => ({
    run_id: run.id,
    test_item_id: g.unit.testItemId,
    suggested_marks: g.clampedMarks,
    max_marks: g.unit.maxMarks,
    confidence: g.confidence,
    markscheme_source: g.unit.markschemeSource,
    work_found: g.item.workFound,
    reasoning: g.item.reasoning,
    evidence: g.item.evidence,
    mark_breakdown: g.item.markBreakdown,
  }));

  const { error: insertErr } = await supabase.from("ai_grade_results").insert(rows);
  if (insertErr) return failRun(`Could not save results: ${insertErr.message}`);

  const suggestedTotal = grades.reduce((s, g) => s + g.clampedMarks, 0);
  const maxTotal = gradeable.reduce((s, u) => s + u.maxMarks, 0);
  const needsReview = grades
    .filter((g) => g.confidence === "low" || !g.item.workFound)
    .map((g) => unitLabel(g.unit));

  const coverage = {
    partsInAssessment: units.length,
    partsGraded: grades.length,
    partsWithoutMarkscheme: units.length - gradeable.length,
    suggestedTotal,
    maxTotal,
    needsReview,
    warnings: [...assemblyWarnings, ...warnings],
  };

  await supabase
    .from("ai_grade_runs")
    .update({ status: "complete", completed_at: new Date().toISOString(), coverage })
    .eq("id", run.id);

  return NextResponse.json({ runId: run.id, status: "complete", ...coverage });
}
