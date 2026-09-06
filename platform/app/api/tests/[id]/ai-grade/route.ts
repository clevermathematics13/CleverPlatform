import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  AiGradeResponseSchema,
  GRADING_MODEL,
  MAX_SCAN_BYTES,
  SCAN_BUCKET,
  assembleMarkScheme,
  assembleMarkschemeImages,
  assembleQuestionImages,
  buildGradingStudentPrompt,
  buildGradingSystemPrompt,
  buildGradingUserPrompt,
  formatGradingSubject,
  gradeNeedsReview,
  parseGradingSubject,
  unitLabel,
  validateGradeResponse,
} from "@/lib/ai-grading";
import type { GradingUnit, ValidatedGrade } from "@/lib/ai-grading";
import { fetchAllRows } from "@/lib/na-scanning";
import { cropRegions, cvServiceEndpoint, type CropRegion } from "@/lib/cv-crop-service";
import {
  fractionBoxToPoints,
  padModelBox,
  type EvidenceBox,
  type PageSizePt,
} from "@/lib/evidence-crops";

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
  mark_breakdown: unknown;
  accepted: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
}

/** One rendered crop plus the (padded) box it was cut from. */
interface EvidenceCrop {
  buffer: Buffer;
  box: EvidenceBox;
}

/**
 * Best-effort: renders one cropped PNG per graded part from the model's
 * reported evidenceBox, via the same Railway CV service the NA scan pipeline
 * uses (see app/api/na-review/packet-scans/[id]/crop/route.ts for the sibling
 * usage). Unlike that pipeline, regions here are per-request and AI-located
 * rather than pre-locked in the database.
 *
 * A WORD ON HOW WELL THAT WORKS: audited in full against one 41-part paper,
 * 22 of the 33 crops this produced did not contain the work they were
 * captioned as evidence for. The cropper is exact -- all 33 reproduce
 * byte-for-byte from their recorded boxes -- but the model synthesises a
 * plausible page layout instead of measuring one, and lands above the real
 * answer every time. The padding below narrows that gap and does not close
 * it. A teacher can correct any individual part through
 * results/[resultId]/evidence-box, which is the repair path until per-paper
 * anchors replace the model's guess.
 *
 * Never throws: a crop is a nice-to-have alongside the suggested grade, not
 * something worth failing (or even warning on) a whole grading run over.
 * Returns an empty map on any failure, including GRAPH_LAB_CV_SERVICE_URL
 * being unset (most local/dev environments).
 */
async function fetchEvidenceCrops(
  scanBase64: string,
  grades: ValidatedGrade[]
): Promise<Map<string, EvidenceCrop>> {
  const byTestItemId = new Map<string, EvidenceCrop>();
  if (!cvServiceEndpoint("/crop")) return byTestItemId;

  let pageCount: number;
  const pageSizePt: PageSizePt[] = [];
  try {
    const pdfDoc = await PDFDocument.load(Buffer.from(scanBase64, "base64"));
    pageCount = pdfDoc.getPageCount();
    for (const page of pdfDoc.getPages()) {
      pageSizePt.push({ widthPt: page.getWidth(), heightPt: page.getHeight() });
    }
  } catch {
    return byTestItemId;
  }

  const boxByQid = new Map<string, EvidenceBox>();
  const regions: CropRegion[] = [];
  for (const g of grades) {
    const reported = g.item.evidenceBox;
    if (!g.item.workFound || !reported) continue;
    const pageIndex = reported.page - 1;
    if (pageIndex < 0 || pageIndex >= pageCount) continue;
    const padded = padModelBox(reported);
    if (!padded) continue;
    boxByQid.set(g.unit.testItemId, padded);
    regions.push({
      qid: g.unit.testItemId,
      pageIndex,
      ...fractionBoxToPoints(padded, pageSizePt[pageIndex]),
    });
  }

  const cropped = await cropRegions({
    pdfBase64: scanBase64,
    expectedPageCount: pageCount,
    regions,
  });
  if (!cropped.ok) return byTestItemId;

  for (const crop of cropped.value) {
    const box = boxByQid.get(crop.qid);
    if (crop.imageBase64 && box) {
      byTestItemId.set(crop.qid, { buffer: Buffer.from(crop.imageBase64, "base64"), box });
    }
  }
  return byTestItemId;
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

  let query = supabase
    .from("ai_grade_runs")
    .select(
      "id, test_id, student_id, invited_student_id, status, model, source_storage_path, coverage, error, created_at, completed_at"
    )
    .eq("test_id", testId)
    .order("created_at", { ascending: false });

  if (studentId) {
    const subject = parseGradingSubject(studentId);
    query =
      subject.kind === "invited"
        ? query.eq("invited_student_id", subject.id)
        : query.eq("student_id", subject.id);
  }

  const { data: rawRuns, error } = await query.limit(studentId ? 5 : 100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Collapse student_id/invited_student_id back into the one opaque subject
  // id every caller already keys its state by (see parseGradingSubject) —
  // the review UI never needs to know which column a run's identity lives in.
  const runs = (rawRuns ?? []).map((r) => ({
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
  let studentDisplayName: string | undefined;
  if (subject.kind === "profile") {
    const { data: studentProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", subject.id)
      .maybeSingle();
    studentDisplayName = studentProfile?.display_name ?? undefined;
  } else {
    const { data: invited } = await supabase
      .from("invited_students")
      .select("full_name, nickname")
      .eq("id", subject.id)
      .maybeSingle();
    studentDisplayName = invited?.nickname || invited?.full_name || undefined;
  }

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
  // Structured output (output_config.format, from the same zod schema the
  // validator uses) makes the JSON itself well-formed, which removes the
  // failure that killed a whole student's grading on 2 Sep 2026 -- a single
  // stray character at position 8267 of an otherwise fine response. The
  // retry covers what structured output cannot: a response cut off at
  // max_tokens, or one that parses but fails validateGradeResponse's own
  // checks (unknown testItemId, etc.).
  const gradingRequest: Anthropic.MessageCreateParamsNonStreaming = {
      model: GRADING_MODEL,
      max_tokens: 16384,
      // Marking should be as repeatable as the model allows. At the default
      // temperature (1.0) the same scan re-marked minutes apart moved by 1-3
      // marks on several parts (BiStats, 2 Sep 2026: Q1 5 -> 2 for one
      // student at "high" confidence). 0 does not make it deterministic, but
      // it removes the sampling noise that has nothing to do with the work.
      temperature: 0,
      // Identical for every student sitting this same test (it only varies by
      // which policies this test's questions require, not by student), so
      // it's still worth caching on a batch upload even though it's no
      // longer identical across every test in the app.
      //
      // 1-hour cache lifetime, not the 5-minute default. The teacher reviews
      // one part's page mapping, grades it, then reviews the next -- gaps of
      // 5-40 minutes between grading calls for the same test are the normal
      // rhythm (ai_usage_log, 4 Sep 2026: one 41-part test re-wrote its
      // 14.4K-token prefix three times in a session because each gap
      // outlived the 5-minute entry). A 1-hour write costs 2x input instead
      // of 1.25x, and pays for itself the first time it prevents one re-write.
      // Both breakpoints must carry the same TTL: a longer-lived entry may
      // not follow a shorter-lived one in the prefix.
      system: [
        {
          type: "text",
          text: buildGradingSystemPrompt(gradeable),
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              // Identical for every student on this test — cached so a batch
              // upload only pays full price for the first student's call.
              type: "text",
              text: buildGradingUserPrompt(gradeable, { testName: test.name }),
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: scanBase64 },
            },
            {
              type: "text",
              text: buildGradingStudentPrompt(studentDisplayName),
            },
          ],
        },
      ],
  };

  let validation: ReturnType<typeof validateGradeResponse> | null = null;
  let lastError = "Model returned an empty response";
  for (let attempt = 1; attempt <= 2 && !validation; attempt++) {
    let responseText: string;
    try {
      const message = await anthropic.messages.parse({
        ...gradingRequest,
        output_config: { format: zodOutputFormat(AiGradeResponseSchema) },
      });
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

  // -- Evidence crops (best-effort; never blocks or fails the run) -----------
  const crops = await fetchEvidenceCrops(scanBase64, grades);
  const evidenceImagePathByTestItemId = new Map<string, string>();
  for (const [testItemId, crop] of crops) {
    const storagePath = `${testId}/${studentId}/evidence/${run.id}/${testItemId}.png`;
    const { error: cropUploadErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .upload(storagePath, crop.buffer, { contentType: "image/png", upsert: true });
    if (!cropUploadErr) evidenceImagePathByTestItemId.set(testItemId, storagePath);
  }

  // -- Carry forward acceptance for parts whose suggestion did not change ----
  // A re-mark used to start every part at accepted=false, so re-marking a
  // fully reviewed student flipped all of it back to "needs review" even when
  // the new suggestion was identical. The teacher's earlier decision still
  // holds for any part where the model suggests the same mark it did last
  // time (Clev's Marks already carries whatever they accepted for it). Only
  // parts whose suggestion moved need a fresh look. Scoped to the most recent
  // COMPLETE run before this one, so a failed attempt in between is ignored.
  const priorAccepted = new Map<string, { suggested_marks: number; accepted_at: string | null; accepted_by: string | null }>();
  {
    let priorCompleteQuery = supabase
      .from("ai_grade_runs")
      .select("id")
      .eq("test_id", testId)
      .eq("status", "complete")
      .neq("id", run.id)
      .order("created_at", { ascending: false })
      .limit(1);
    priorCompleteQuery =
      subject.kind === "invited"
        ? priorCompleteQuery.eq("invited_student_id", subject.id)
        : priorCompleteQuery.eq("student_id", subject.id);
    const { data: priorRun } = await priorCompleteQuery.maybeSingle();
    if (priorRun) {
      const { data: priorRows } = await supabase
        .from("ai_grade_results")
        .select("test_item_id, suggested_marks, accepted_at, accepted_by")
        .eq("run_id", priorRun.id)
        .eq("accepted", true);
      for (const p of priorRows ?? []) priorAccepted.set(p.test_item_id, p);
    }
  }

  // -- Persist results -------------------------------------------------------
  let acceptedCarriedForward = 0;
  const rows = grades.map((g) => {
    const prior = priorAccepted.get(g.unit.testItemId);
    const carried = prior && prior.suggested_marks === g.clampedMarks ? prior : null;
    if (carried) acceptedCarriedForward += 1;
    return {
      run_id: run.id,
      test_item_id: g.unit.testItemId,
      suggested_marks: g.clampedMarks,
      max_marks: g.unit.maxMarks,
      confidence: g.confidence,
      markscheme_source: g.unit.markschemeSource,
      work_found: g.item.workFound,
      reasoning: g.item.reasoning,
      evidence: g.item.evidence,
      evidence_image_path: evidenceImagePathByTestItemId.get(g.unit.testItemId) ?? null,
      evidence_box: evidenceImagePathByTestItemId.has(g.unit.testItemId)
        ? crops.get(g.unit.testItemId)?.box ?? null
        : null,
      // Kept in step with evidence_box: a row either has a model-located box
      // and is labelled as such, or has neither. A teacher redrawing the
      // region later overwrites both (see the evidence-box route).
      evidence_box_source: evidenceImagePathByTestItemId.has(g.unit.testItemId) ? "model" : null,
      mark_breakdown: g.item.markBreakdown,
      accepted: !!carried,
      accepted_at: carried?.accepted_at ?? null,
      accepted_by: carried?.accepted_by ?? null,
    };
  });

  const { error: insertErr } = await supabase.from("ai_grade_results").insert(rows);
  if (insertErr) return failRun(`Could not save results: ${insertErr.message}`);

  const suggestedTotal = grades.reduce((s, g) => s + g.clampedMarks, 0);
  // maxTotal covers only parts that had a mark scheme to grade against;
  // testTotalMarks is the assessment's real total, so the UI can show
  // "17/20 of 33" instead of a misleading "17/20" when parts are missing
  // a mark scheme.
  const maxTotal = gradeable.reduce((s, u) => s + u.maxMarks, 0);
  const testTotalMarks = units.reduce((s, u) => s + u.maxMarks, 0);
  const needsReview = grades.filter(gradeNeedsReview).map((g) => unitLabel(g.unit));

  const coverage = {
    partsInAssessment: units.length,
    partsGraded: grades.length,
    partsWithoutMarkscheme: units.length - gradeable.length,
    suggestedTotal,
    maxTotal,
    testTotalMarks,
    needsReview,
    acceptedCarriedForward,
    warnings: [...assemblyWarnings, ...warnings],
  };

  await supabase
    .from("ai_grade_runs")
    .update({ status: "complete", completed_at: new Date().toISOString(), coverage })
    .eq("id", run.id);

  return NextResponse.json({ runId: run.id, status: "complete", ...coverage });
}
