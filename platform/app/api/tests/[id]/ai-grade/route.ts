import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import {
  GRADING_MODEL,
  GRADING_SYSTEM_PROMPT,
  MAX_SCAN_BYTES,
  SCAN_BUCKET,
  assembleMarkScheme,
  assembleMarkschemeImages,
  assembleQuestionImages,
  buildGradingStudentPrompt,
  buildGradingUserPrompt,
  gradeNeedsReview,
  unitLabel,
  validateGradeResponse,
} from "@/lib/ai-grading";
import type { GradingUnit, ValidatedGrade } from "@/lib/ai-grading";

export const maxDuration = 300;

interface CvCropResult {
  qid: string;
  imageBase64: string;
}

/**
 * Best-effort: renders one cropped PNG per graded part from the model's
 * reported evidenceBox, via the same Railway CV service the NA scan
 * pipeline uses (see platform/app/api/na-review/packet-scans/[id]/crop/route.ts
 * for the sibling usage). Unlike that pipeline, anchors here are per-request
 * and AI-located rather than pre-locked in the database — the CV service's
 * /crop endpoint takes anchors directly in the request body either way, so
 * no server-side changes were needed to reuse it.
 *
 * Never throws: a crop is a nice-to-have alongside the suggested grade, not
 * something worth failing (or even warning on) a whole grading run over.
 * Returns an empty map on any failure, including GRAPH_LAB_CV_SERVICE_URL
 * being unset (most local/dev environments).
 */
async function fetchEvidenceCrops(
  scanBase64: string,
  grades: ValidatedGrade[]
): Promise<Map<string, Buffer>> {
  const byTestItemId = new Map<string, Buffer>();

  const serviceUrl = process.env.GRAPH_LAB_CV_SERVICE_URL;
  if (!serviceUrl) return byTestItemId;

  let pageCount: number;
  const pageSizePt: { width: number; height: number }[] = [];
  try {
    const pdfDoc = await PDFDocument.load(Buffer.from(scanBase64, "base64"));
    pageCount = pdfDoc.getPageCount();
    for (const page of pdfDoc.getPages()) {
      pageSizePt.push({ width: page.getWidth(), height: page.getHeight() });
    }
  } catch {
    return byTestItemId;
  }

  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  // The model's evidenceBox is an estimate, and it skews tight rather than
  // loose -- it's especially prone to clipping the tail end of a line that
  // runs further right or lower than expected (e.g. a final numeric answer
  // after "=" ). Pad every edge outward before cropping: proportional to the
  // box's own size so a large block of working doesn't get padded away past
  // the page, with a fraction-of-page floor so a small, tightly-drawn box
  // still gets a meaningful margin.
  const PAD_PROPORTION = 0.18;
  const PAD_FLOOR = 0.03;
  const anchors = grades
    .map((g) => {
      const box = g.item.evidenceBox;
      if (!g.item.workFound || !box) return null;
      const pageIndex = box.page - 1;
      if (pageIndex < 0 || pageIndex >= pageCount) return null;
      const { width, height } = pageSizePt[pageIndex];
      const rawX0 = clamp01(box.x0);
      const rawY0 = clamp01(box.y0);
      const rawX1 = clamp01(box.x1);
      const rawY1 = clamp01(box.y1);
      if (rawX1 <= rawX0 || rawY1 <= rawY0) return null;
      const padX = Math.max((rawX1 - rawX0) * PAD_PROPORTION, PAD_FLOOR);
      const padY = Math.max((rawY1 - rawY0) * PAD_PROPORTION, PAD_FLOOR);
      const x0 = clamp01(rawX0 - padX);
      const y0 = clamp01(rawY0 - padY);
      const x1 = clamp01(rawX1 + padX);
      const y1 = clamp01(rawY1 + padY);
      return {
        qid: g.unit.testItemId,
        pageIndex,
        x0Pt: x0 * width,
        y0Pt: y0 * height,
        x1Pt: x1 * width,
        y1Pt: y1 * height,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  if (anchors.length === 0) return byTestItemId;

  const serviceBase = serviceUrl.trim().replace(/\/$/, "");
  const target = `${/^https?:\/\//i.test(serviceBase) ? serviceBase : `https://${serviceBase}`}/crop`;
  const cvSecret = process.env.CV_SERVICE_SECRET ?? "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(cvSecret ? { "X-CV-Secret": cvSecret } : {}),
      },
      body: JSON.stringify({
        studentPdfBase64: scanBase64,
        expectedPageCount: pageCount,
        rotationHint: 0,
        anchors,
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) return byTestItemId;
    const data = (await upstream.json()) as { crops?: CvCropResult[] };
    for (const crop of data.crops ?? []) {
      if (crop.imageBase64) byTestItemId.set(crop.qid, Buffer.from(crop.imageBase64, "base64"));
    }
  } catch {
    // Network/timeout failure -- crops stay empty, grading still succeeds.
  } finally {
    clearTimeout(timeout);
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
      "id, run_id, test_item_id, suggested_marks, max_marks, confidence, markscheme_source, work_found, reasoning, evidence, evidence_image_path, mark_breakdown, accepted, accepted_at, accepted_by"
    )
    .in(
      "run_id",
      runs.map((r) => r.id)
    );

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  const rows = results ?? [];

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

  // -- Evidence crops (best-effort; never blocks or fails the run) -----------
  const crops = await fetchEvidenceCrops(scanBase64, grades);
  const evidenceImagePathByTestItemId = new Map<string, string>();
  for (const [testItemId, imageBytes] of crops) {
    const storagePath = `${testId}/${studentId}/evidence/${run.id}/${testItemId}.png`;
    const { error: cropUploadErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .upload(storagePath, imageBytes, { contentType: "image/png", upsert: true });
    if (!cropUploadErr) evidenceImagePathByTestItemId.set(testItemId, storagePath);
  }

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
    evidence_image_path: evidenceImagePathByTestItemId.get(g.unit.testItemId) ?? null,
    mark_breakdown: g.item.markBreakdown,
  }));

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
    warnings: [...assemblyWarnings, ...warnings],
  };

  await supabase
    .from("ai_grade_runs")
    .update({ status: "complete", completed_at: new Date().toISOString(), coverage })
    .eq("id", run.id);

  return NextResponse.json({ runId: run.id, status: "complete", ...coverage });
}
