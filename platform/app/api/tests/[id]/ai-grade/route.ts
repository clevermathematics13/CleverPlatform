import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  GRADING_MODEL,
  MAX_SCAN_BYTES,
  SCAN_BUCKET,
  assembleMarkschemeImages,
  assembleQuestionImages,
  formatGradingSubject,
  parseGradingSubject,
  validateGradeResponse,
} from "@/lib/ai-grading";
import type { GradingUnit } from "@/lib/ai-grading";
import {
  buildGradingRequest,
  loadGradeableMarkScheme,
  loadStudentDisplayName,
  persistGradeOutcome,
} from "@/lib/ai-grading-run";
import { fetchAllRows } from "@/lib/na-scanning";

export const maxDuration = 300;

/** One ai_grade_runs row as the review UI reads it (GET below). */
interface RunRow {
  id: string;
  test_id: string;
  student_id: string | null;
  invited_student_id: string | null;
  status: string;
  model: string | null;
  source_storage_path: string | null;
  coverage: unknown;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  /**
   * The Anthropic message batch a run is still tied to, or null once it is
   * settled. Served to the review UI because a 'running' run that still
   * carries one is a run the collect route left for a later sweep to promote
   * (its results were written, its own status update was lost) -- the page
   * has to keep polling collect for it, and 'running' alone cannot say so.
   */
  pending_message_batch_id: string | null;
}

/** One ai_grade_results row as the review UI reads it (GET below). */
interface ResultRow {
  id: string;
  run_id: string;
  test_item_id: string;
  suggested_marks: number;
  max_marks: number;
  confidence: string;
  markscheme_source: string | null;
  work_found: boolean;
  reasoning: string | null;
  evidence: string | null;
  evidence_image_path: string | null;
  evidence_box: unknown;
  evidence_box_source: string | null;
  mark_breakdown: unknown;
  accepted: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
}

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

  // Built fresh per call so each .range() page starts from an untouched
  // builder, the same shape the results query below uses.
  const runQuery = () => {
    const q = supabase
      .from("ai_grade_runs")
      .select(
        "id, test_id, student_id, invited_student_id, status, model, source_storage_path, coverage, error, created_at, completed_at, pending_message_batch_id"
      )
      .eq("test_id", testId)
      // id breaks created_at ties: one overnight submission inserts a whole
      // class in a single statement, so those runs share a created_at to the
      // microsecond and paging on it alone would repeat and skip rows.
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (!studentId) return q;
    const subject = parseGradingSubject(studentId);
    return subject.kind === "invited"
      ? q.eq("invited_student_id", subject.id)
      : q.eq("student_id", subject.id);
  };

  let rawRuns: RunRow[];
  if (studentId) {
    // One student's own history: the review UI shows the last few attempts,
    // so this cap is the feature, not a limit to page around.
    const { data, error } = await runQuery().limit(5);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rawRuns = (data ?? []) as RunRow[];
  } else {
    // No cap on the whole-test load. Overnight marking creates one run per
    // student on every click, so a class that has been re-marked a few times
    // passes 100 runs within a term (60 on one test already, 5 Sep 2026) --
    // and .limit(100) dropped the oldest ones with no error, so those
    // students read as never graded on the page that is the only record of
    // their marking. Page it like the results query below.
    try {
      rawRuns = await fetchAllRows<RunRow>((from, to) => runQuery().range(from, to));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  // Collapse student_id/invited_student_id back into the one opaque subject
  // id every caller already keys its state by (see parseGradingSubject) —
  // the review UI never needs to know which column a run's identity lives in.
  const runs = rawRuns.map((r) => ({
    ...r,
    student_id: formatGradingSubject(r),
  }));
  if (runs.length === 0) return NextResponse.json({ runs: [], results: [] });

  // A whole class's runs carry well over PostgREST's 1000-row cap (60 runs x
  // ~39 items = 2,337 rows on 5 Sep 2026), and a single .in() query returns
  // only the first 1000 with no error. Whichever runs land past the cap then
  // have no results in the response, so the review UI shows them as never
  // graded (no acceptance counts, no green dot) even though every mark is
  // accepted. Page through .range() so every run's results reach the page.
  const runIds = runs.map((r) => r.id);
  let rows: ResultRow[];
  try {
    rows = await fetchAllRows<ResultRow>((from, to) =>
      supabase
        .from("ai_grade_results")
        .select(
          "id, run_id, test_item_id, suggested_marks, max_marks, confidence, markscheme_source, work_found, reasoning, evidence, evidence_image_path, evidence_box, evidence_box_source, mark_breakdown, accepted, accepted_at, accepted_by"
        )
        .in("run_id", runIds)
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // -- Evidence crop images (private "exam-scans" bucket) ---------------------
  const evidencePaths = [...new Set(rows.map((r) => r.evidence_image_path).filter((p): p is string => !!p))];
  const evidenceUrlByPath = new Map<string, string>();
  if (evidencePaths.length > 0) {
    const { data: signed } = await supabase.storage.from(SCAN_BUCKET).createSignedUrls(evidencePaths, 3600);
    for (const s of signed ?? []) {
      if (s.signedUrl) evidenceUrlByPath.set(s.path ?? "", s.signedUrl);
    }
  }

  // -- PPQ bank source images (private "question-images" bucket) --------------
  // Looked up fresh on every request rather than cached on the result row --
  // they reflect whatever is currently in the PPQ bank, not what existed when
  // the run was graded. Never fails the whole review load: a missing image
  // lookup is a nice-to-have alongside the suggested grade.
  const loadImageUrlsByTestItem = async (
    assemble: typeof assembleMarkschemeImages
  ): Promise<Map<string, string[]>> => {
    try {
      const refs = await assemble(supabase, testId);
      const paths = [...new Set(refs.map((r) => r.storagePath))];
      if (paths.length === 0) return new Map();
      const { data: signed } = await supabase.storage.from("question-images").createSignedUrls(paths, 3600);
      const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl ?? null]));
      const byItem = new Map<string, string[]>();
      for (const ref of refs) {
        const url = urlByPath.get(ref.storagePath);
        if (!url) continue;
        const list = byItem.get(ref.testItemId) ?? [];
        list.push(url);
        byItem.set(ref.testItemId, list);
      }
      return byItem;
    } catch {
      return new Map();
    }
  };

  const [markschemeUrlsByTestItem, questionUrlsByTestItem] = await Promise.all([
    loadImageUrlsByTestItem(assembleMarkschemeImages),
    loadImageUrlsByTestItem(assembleQuestionImages),
  ]);

  const resultsWithImages = rows.map((r) => ({
    ...r,
    evidence_image_url: r.evidence_image_path ? evidenceUrlByPath.get(r.evidence_image_path) ?? null : null,
    question_image_urls: questionUrlsByTestItem.get(r.test_item_id) ?? [],
    markscheme_image_urls: markschemeUrlsByTestItem.get(r.test_item_id) ?? [],
  }));

  return NextResponse.json({ runs, results: resultsWithImages });
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

  const subject = parseGradingSubject(studentId);
  const studentDisplayName = await loadStudentDisplayName(supabase, subject);

  // -- Mark scheme assembly --------------------------------------------------
  let units: GradingUnit[];
  let gradeable: GradingUnit[];
  let assemblyWarnings: string[];
  try {
    ({ units, gradeable, assemblyWarnings } = await loadGradeableMarkScheme(supabase, testId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Mark scheme assembly failed" },
      { status: 500 }
    );
  }

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
    let priorRunQuery = supabase
      .from("ai_grade_runs")
      .select("source_storage_path")
      .eq("test_id", testId)
      .not("source_storage_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    priorRunQuery =
      subject.kind === "invited"
        ? priorRunQuery.eq("invited_student_id", subject.id)
        : priorRunQuery.eq("student_id", subject.id);
    const { data: priorRun } = await priorRunQuery.maybeSingle();

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
      student_id: subject.kind === "profile" ? subject.id : null,
      invited_student_id: subject.kind === "invited" ? subject.id : null,
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

  // The request is built once and may be sent twice: a response that comes
  // back malformed or schema-invalid gets ONE retry before the run fails.
  // Structured output (output_config.format, which buildGradingRequest sets
  // from the same zod schema the validator uses) makes the JSON itself
  // well-formed. The retry covers what structured output cannot: a response
  // cut off at max_tokens, or one that parses but fails
  // validateGradeResponse's own checks (unknown testItemId, etc.).
  //
  // 1h, not the batch path's 5m: this is the interactive route, and the gaps
  // between one teacher's calls for the same test outlive a 5-minute cache
  // entry (see GradingCacheTtl).
  const gradingRequest = buildGradingRequest({
    gradeable,
    testName: test.name,
    studentDisplayName,
    scanBase64,
    cacheTtl: "1h",
  });

  let validation: ReturnType<typeof validateGradeResponse> | null = null;
  let lastError = "Model returned an empty response";
  for (let attempt = 1; attempt <= 2 && !validation; attempt++) {
    let responseText: string;
    try {
      const message = await anthropic.messages.parse(gradingRequest);
      await recordUsage(supabase, {
        pipeline: "ai_grade",
        model: GRADING_MODEL,
        usage: message.usage,
        ref: { type: "ai_grade_run", id: run.id },
      });
      if (message.stop_reason === "max_tokens") {
        lastError = "Model response was cut off at max_tokens";
        continue;
      }
      responseText = message.parsed_output
        ? JSON.stringify(message.parsed_output)
        : message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
    } catch (e) {
      return failRun(`Grading request failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!responseText.trim()) {
      lastError = "Model returned an empty response";
      continue;
    }
    const attemptValidation = validateGradeResponse(responseText, gradeable);
    if (attemptValidation.ok) validation = attemptValidation;
    else lastError = attemptValidation.error;
  }
  if (!validation || !validation.ok) return failRun(lastError, 502);

  const { grades, warnings } = validation.outcome;

  // Crops, acceptance carry-forward, the result rows, the coverage summary and
  // the run to 'complete' -- shared with the overnight batch collect route so
  // the carry-forward rule cannot drift between the two (lib/ai-grading-run.ts).
  const persisted = await persistGradeOutcome({
    supabase,
    testId,
    studentId,
    subject,
    runId: run.id,
    scanBase64,
    units,
    gradeable,
    assemblyWarnings,
    grades,
    warnings,
  });
  if (!persisted.ok) return failRun(persisted.error);

  // persisted.completionRecorded can be false when the rows went in but the
  // run's own status update did not. This path answers 200 either way, as it
  // always has: the marks exist and the teacher can review them. Only the
  // overnight path acts on the flag, because only it has a sweep that can
  // pick the run back up.
  return NextResponse.json({ runId: run.id, status: "complete", ...persisted.coverage });
}
