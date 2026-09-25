import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import type { ApiAuthOk } from "@/lib/auth";
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
import { AI_GRADE_RUN_COLUMNS, loadAiGradeOverview, loadStudentClevMarks } from "@/lib/ai-grade-overview";
import type { AiGradeRunRow } from "@/lib/ai-grade-overview";
import { fetchAllRows } from "@/lib/na-scanning";
import { findScansMarkedBefore, uprightScan } from "@/lib/scan-orientation";

export const maxDuration = 300;

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
  /** The marker's own box before padding or bounding; null on rows marked before 23 Sep 2026. */
  evidence_box_reported: unknown;
  mark_breakdown: unknown;
  accepted: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
}

/**
 * GET /api/tests/[id]/ai-grade?studentId=...
 * For the review UI, in two shapes:
 *   - without studentId (the roster): every run of the test, `results`
 *     cut down to { run_id, accepted } for each student's newest complete
 *     run -- the acceptance counts the roster shows, and nothing else --
 *     `unmarked`, anyone a batch scan was confirmed for who has no run at
 *     all (lib/batch-unmarked.ts), and `clev_marks`, what ClevMarks holds
 *     on the test per student;
 *   - with studentId (one student's review panel): their last few runs with
 *     full result rows, signed evidence crops, PPQ images, what Clev's Marks
 *     holds for each part and on the whole test (`clev_marks`), and their
 *     self-assessment of the test as `self_scores` (see loadSelfScores
 *     below).
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

  // -- The whole-class load: acceptance counts and nothing else --------------
  // Built in lib/ai-grade-overview.ts (see there for why it is shaped this
  // way), which the AI-grade page also calls to render its roster on the
  // server. The keys a tab still running an older page reads are unchanged;
  // clev_marks is only added.
  if (!studentId) {
    const overview = await loadAiGradeOverview(supabase, testId);
    if (!overview.ok) return NextResponse.json({ error: overview.error }, { status: overview.status });
    return NextResponse.json({
      runs: overview.runs,
      results: overview.results,
      unmarked: overview.unmarked,
      clev_marks: overview.clevMarks,
    });
  }

  // Started now and awaited at the end, so the Self column costs no extra
  // round trip on a single student's review load -- and ClevMarks likewise.
  const selfScoresPromise = loadSelfScores(supabase, testId, studentId);
  const clevMarksPromise = loadStudentClevMarks(supabase, testId, studentId);

  // One student's own history: the review UI shows the last few attempts,
  // so this cap is the feature, not a limit to page around.
  const subject = parseGradingSubject(studentId);
  const runQuery = supabase
    .from("ai_grade_runs")
    .select(AI_GRADE_RUN_COLUMNS)
    .eq("test_id", testId)
    // id breaks created_at ties: one overnight submission inserts a whole
    // class in a single statement, so those runs share a created_at to the
    // microsecond.
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });
  const { data, error } = await (subject.kind === "invited"
    ? runQuery.eq("invited_student_id", subject.id)
    : runQuery.eq("student_id", subject.id)
  ).limit(5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Collapse student_id/invited_student_id back into the one opaque subject
  // id every caller already keys its state by (see parseGradingSubject) --
  // the review UI never needs to know which column a run's identity lives in.
  const runs = ((data ?? []) as AiGradeRunRow[]).map((r) => ({
    ...r,
    student_id: formatGradingSubject(r),
  }));
  if (runs.length === 0) {
    return NextResponse.json({ runs: [], results: [], self_scores: await selfScoresPromise });
  }

  // Only a single student's review gets here, and their last few runs sit
  // far below PostgREST's 1000-row cap. It pages through .range() anyway: a
  // single .in() query past the cap returns only the first 1000 rows with no
  // error -- which once made fully accepted students read as never graded
  // (60 runs x ~39 items = 2,337 rows on 5 Sep 2026) -- and paging costs
  // nothing when one page holds everything.
  const runIds = runs.map((r) => r.id);
  let rows: ResultRow[];
  try {
    rows = await fetchAllRows<ResultRow>((from, to) =>
      supabase
        .from("ai_grade_results")
        .select(
          "id, run_id, test_item_id, suggested_marks, max_marks, confidence, markscheme_source, work_found, reasoning, evidence, evidence_image_path, evidence_box, evidence_box_source, evidence_box_reported, mark_breakdown, accepted, accepted_at, accepted_by"
        )
        .in("run_id", runIds)
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // -- What Clev's Marks actually holds right now, per part -------------------
  // suggested_marks never changes once the model has spoken -- it is the
  // audit trail's record of what the model said, and the "was N" comparison
  // between runs depends on it staying put -- so it cannot double as "what
  // was accepted" once a teacher overrides it. Without this, reopening an
  // already-accepted row's review showed the model's original number again
  // instead of the teacher's override, which read as the edit having
  // reverted even though Clev's Marks itself was correct. Per part only for
  // a single student's review pane, not the whole-class overview, which
  // never shows individual mark inputs. The same read gives the whole test's
  // total, so an accept made in the pane moves the roster's ClevMarks figure.
  const clevMarks = await clevMarksPromise;
  const marksAwardedByTestItem = clevMarks?.byItem ?? new Map<string, number>();

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
    marks_awarded: marksAwardedByTestItem.get(r.test_item_id) ?? null,
  }));

  return NextResponse.json({
    runs,
    results: resultsWithImages,
    self_scores: await selfScoresPromise,
    // Null when ClevMarks could not be read: the roster keeps what it had.
    clev_marks: clevMarks?.summary ?? null,
  });
}

/**
 * One student's self-assessment of this test (student_self_scores): what they
 * gave themselves on each part on the reflection page's self-grade form, for
 * the review panel's Self column. Read over every part of the test rather
 * than only the parts in these runs, so the self-assessed total is the one
 * the student saw on their own form.
 *
 * [] for an invited subject: a student who has never signed in has no account
 * to have self-assessed from (see getReflectionItemsForInvitedStudent in
 * lib/exam-service.ts). null when a read fails, so the panel says it could
 * not load them instead of reporting that the student has not self-assessed
 * on the strength of a failed query. Never throws -- it is awaited after the
 * rest of the review has loaded, and must not be able to fail that.
 */
async function loadSelfScores(
  supabase: ApiAuthOk["supabase"],
  testId: string,
  studentId: string
): Promise<{ test_item_id: string; self_marks: number | null; submitted_at: string | null }[] | null> {
  const subject = parseGradingSubject(studentId);
  if (subject.kind === "invited") return [];
  try {
    const { data: items, error: itemsError } = await supabase
      .from("test_items")
      .select("id")
      .eq("test_id", testId);
    if (itemsError) return null;
    const itemIds = (items ?? []).map((i) => i.id as string);
    if (itemIds.length === 0) return [];
    // One row per part at most (unique on test_item_id, student_id), so a
    // paper's worth sits far below PostgREST's 1000-row cap.
    const { data, error } = await supabase
      .from("student_self_scores")
      .select("test_item_id, self_marks, submitted_at")
      .eq("student_id", subject.id)
      .in("test_item_id", itemIds);
    if (error) return null;
    return data ?? [];
  } catch {
    return null;
  }
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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // -- Orientation -----------------------------------------------------------
  // A duplex scan can arrive with every even page upside down in its pixels.
  // The marker does not notice -- it returns a confabulated reading of an
  // inverted page -- and every crop cut from it comes out upside down. Read
  // the orientation first, rotate what needs it, and replace the stored scan
  // so the crop service and "Locate on page" agree with what was marked.
  // Best-effort: on any failure the scan is graded as it is (see the module).
  // Only on the stored file's FIRST marking: a re-mark of the same file keeps
  // the orientation that first check settled, because checking again can
  // flip a page back (see "ONCE PER STORED SCAN" in lib/scan-orientation.ts).
  const markedBefore = await findScansMarkedBefore(supabase, testId, [scanStoragePath], run.id);
  if (markedBefore.has(scanStoragePath)) {
    console.info(`[ai-grade] run ${run.id}: orientation already settled by an earlier run; marking the stored scan as it is`);
  } else {
    const upright = await uprightScan({
      anthropic,
      supabase,
      bucket: SCAN_BUCKET,
      storagePath: scanStoragePath,
      buffer: Buffer.from(scanBase64, "base64"),
      usageRef: { type: "ai_grade_run", id: run.id },
    });
    if (upright.warning) console.warn(`[ai-grade] run ${run.id}: ${upright.warning}`);
    scanBase64 = upright.base64;
  }

  // -- Grade -----------------------------------------------------------------
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
