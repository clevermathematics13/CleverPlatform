/**
 * One grading run's request and its persistence, shared by every path that
 * marks a scan.
 *
 * Two senders now exist for the same grading call: the synchronous route
 * (app/api/tests/[id]/ai-grade/route.ts), which the teacher's browser drives
 * one student at a time, and the overnight batch path, which posts a whole
 * class to the Message Batches API and writes the results back whenever the
 * AI grade page next asks for them. Both must produce the same request and,
 * far more importantly, the same rows.
 *
 * The persistence is the reason this module exists rather than a second copy.
 * It carries the acceptance rule: a re-mark keeps a teacher's earlier
 * acceptance for any part whose suggestion did not move, and only for those.
 * A copy that drifted on that rule would silently either discard reviewed
 * work or keep an acceptance for a mark that changed underneath it, and
 * neither is visible in the UI until a teacher notices their own review is
 * gone. scripts/eval-grading.ts is a THIRD hand-copy of the request half and
 * has already drifted -- it still sends the 5-minute default cache TTL the
 * route moved off on 4 Sep 2026 -- which is exactly the failure this prevents
 * for the two senders that write to the database.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import {
  AiGradeResponseSchema,
  GRADING_MODEL,
  SCAN_BUCKET,
  assembleMarkScheme,
  buildGradingStudentPrompt,
  buildGradingSystemPrompt,
  buildGradingUserPrompt,
  gradeNeedsReview,
  unitLabel,
  type GradingSubject,
  type GradingUnit,
  type ValidatedGrade,
} from "./ai-grading";
import { warningsForParts } from "./ai-grade-review";
import { cropRegions, cvServiceEndpoint, type CropRegion } from "./cv-crop-service";
import {
  anchorCropPlan,
  boundModelBoxes,
  firstShiftedAnchorPage,
  modelCropPlan,
  type AnchorPageObservation,
  type EvidenceBox,
  type PageSizePt,
  type StoredAnchor,
} from "./evidence-crops";

/** One rendered crop, the box it was cut from, and where that box came from. */
export interface EvidenceCrop {
  buffer: Buffer;
  box: EvidenceBox;
  source: "model" | "anchor";
}

/** Re-exported so a caller needs only this module to type a crop's box. */
export type { EvidenceBox };

export interface LayoutRow {
  id: string;
  page_count: number;
  reference_page_sizes: PageSizePt[];
}

export interface AnchorRow {
  question_number: number;
  part_label: string | null;
  page_index: number;
  x0_pt: number;
  y0_pt: number;
  x1_pt: number;
  y1_pt: number;
  expand_max_x1_pt: number | null;
  expand_max_y1_pt: number | null;
}

/** The natural key test_item_anchors is unique on. */
export const anchorKey = (questionNumber: number, partLabel: string | null) =>
  `${questionNumber}|${partLabel ?? ""}`;

/** A test_item_anchors row in the shape the crop builders take (numeric comes back as strings). */
export function storedAnchorOf(row: AnchorRow): StoredAnchor {
  return {
    pageIndex: row.page_index,
    x0Pt: Number(row.x0_pt),
    y0Pt: Number(row.y0_pt),
    x1Pt: Number(row.x1_pt),
    y1Pt: Number(row.y1_pt),
    expandMaxX1Pt: row.expand_max_x1_pt === null ? null : Number(row.expand_max_x1_pt),
    expandMaxY1Pt: row.expand_max_y1_pt === null ? null : Number(row.expand_max_y1_pt),
  };
}

// -----------------------------------------------------------------------------
// The grading request
// -----------------------------------------------------------------------------

/**
 * Which cache lifetime the two breakpoints carry.
 *
 * "1h" is the interactive route's: a teacher reviews one part's page mapping,
 * grades it, then reviews the next -- gaps of 5-40 minutes between grading
 * calls for the same test are the normal rhythm (ai_usage_log, 4 Sep 2026:
 * one 41-part test re-wrote its 14.4K-token prefix three times in a session
 * because each gap outlived the 5-minute entry).
 *
 * "5m" is the batch path's. Inside one batch a cache hit either lands within
 * minutes of the write or not at all -- there is no teacher pausing between
 * students, the whole class is submitted in one request and Anthropic runs it
 * as fast as it schedules it. A 1h write costs 2x input against 5m's 1.25x,
 * so the shorter TTL breaks even at a much lower hit rate (~22% vs ~53%) once
 * the batch discount halves both sides of that trade.
 */
export type GradingCacheTtl = "1h" | "5m";

/**
 * Both breakpoints must carry the same TTL: a longer-lived entry may not
 * follow a shorter-lived one in the prefix.
 */
function cacheControl(ttl: GradingCacheTtl): Anthropic.CacheControlEphemeral {
  return ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

/**
 * The message params for marking one student's scan. Identical for the
 * synchronous send (anthropic.messages.parse) and for one entry in a batch
 * (messages.batches.create takes the same params under a custom_id), which is
 * what keeps the two senders from marking the same scan differently.
 */
/**
 * The effort a marking call runs at, on a model that takes one. The current
 * grader (Opus 4.5) takes none and runs at temperature 0; Opus 5 and Sonnet 5
 * reject sampling parameters and think adaptively instead, so a request to
 * one of them must carry effort and no temperature. Kept as a type so the
 * eval sweep and a future production switch spell it the same way.
 */
export type GradingEffort = "low" | "medium" | "high";

/** Models whose requests take `output_config.effort` in place of `temperature`. */
export function modelTakesEffort(model: string): boolean {
  return /^claude-(opus-5|sonnet-5|fable-5|opus-4-[678]|sonnet-4-6)/.test(model);
}

export function buildGradingRequest(args: {
  gradeable: GradingUnit[];
  testName: string;
  studentDisplayName?: string;
  scanBase64: string;
  cacheTtl: GradingCacheTtl;
  /** Defaults to GRADING_MODEL; the eval sweep passes candidates here. */
  model?: string;
  /** Only sent on a model that takes effort (see modelTakesEffort); defaults to the model's own default. */
  effort?: GradingEffort;
}): Anthropic.MessageCreateParamsNonStreaming {
  const { gradeable, testName, studentDisplayName, scanBase64, cacheTtl } = args;
  const model = args.model ?? GRADING_MODEL;
  const takesEffort = modelTakesEffort(model);

  return {
    model,
    max_tokens: 16384,
    // Marking should be as repeatable as the model allows. At the default
    // temperature (1.0) the same scan re-marked minutes apart moved by 1-3
    // marks on several parts (BiStats, 2 Sep 2026: Q1 5 -> 2 for one
    // student at "high" confidence). 0 does not make it deterministic, but
    // it removes the sampling noise that has nothing to do with the work.
    // A model that takes effort rejects the parameter outright (400), so it
    // is only sent where it is accepted.
    ...(takesEffort ? {} : { temperature: 0 }),
    // Identical for every student sitting this same test (it only varies by
    // which policies this test's questions require, not by student), so
    // it's still worth caching on a batch upload even though it's no
    // longer identical across every test in the app.
    system: [
      {
        type: "text",
        text: buildGradingSystemPrompt(gradeable),
        cache_control: cacheControl(cacheTtl),
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
            text: buildGradingUserPrompt(gradeable, { testName }),
            cache_control: cacheControl(cacheTtl),
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
    // Structured output (from the same zod schema the validator uses) makes
    // the JSON itself well-formed, which removes the failure that killed a
    // whole student's grading on 2 Sep 2026 -- a single stray character at
    // position 8267 of an otherwise fine response.
    output_config: {
      format: zodOutputFormat(AiGradeResponseSchema),
      ...(takesEffort && args.effort ? { effort: args.effort } : {}),
    },
  };
}

// -----------------------------------------------------------------------------
// Context loads
// -----------------------------------------------------------------------------

/**
 * The test's markable units, split into everything the assembly found and the
 * subset that actually has a mark scheme to grade against. Throws whatever
 * assembleMarkScheme throws: how a sender reports "this test cannot be
 * graded" is the sender's business (the route answers 500, the batch submit
 * fails the whole submission), but which parts are gradeable is not.
 */
export async function loadGradeableMarkScheme(
  supabase: SupabaseClient,
  testId: string
): Promise<{ units: GradingUnit[]; gradeable: GradingUnit[]; assemblyWarnings: string[] }> {
  const assembled = await assembleMarkScheme(supabase, testId);
  return {
    units: assembled.units,
    gradeable: assembled.units.filter((u) => u.markschemeSource !== "none"),
    assemblyWarnings: assembled.warnings,
  };
}

/**
 * The student's name for the per-student prompt, from whichever table holds
 * this subject (see parseGradingSubject). Undefined is fine and expected: an
 * invited student with neither a nickname nor a full name still gets marked,
 * just without a name in the prompt.
 */
export async function loadStudentDisplayName(
  supabase: SupabaseClient,
  subject: GradingSubject
): Promise<string | undefined> {
  if (subject.kind === "profile") {
    const { data: studentProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", subject.id)
      .maybeSingle();
    return studentProfile?.display_name ?? undefined;
  }
  const { data: invited } = await supabase
    .from("invited_students")
    .select("full_name, nickname")
    .eq("id", subject.id)
    .maybeSingle();
  return invited?.nickname || invited?.full_name || undefined;
}

// -----------------------------------------------------------------------------
// Evidence crops
// -----------------------------------------------------------------------------

/**
 * The locked per-paper regions for this test, if there are any.
 *
 * Locked, not merely present: `anchors_locked` is the teacher's explicit
 * confirmation that the geometry has been checked. A half-drawn draft layout
 * must not start cutting crops for a whole class.
 */
export async function loadLockedLayout(
  supabase: SupabaseClient,
  testId: string
): Promise<{ layout: LayoutRow; anchors: Map<string, AnchorRow> } | null> {
  const { data: layout } = await supabase
    .from("test_paper_layouts")
    .select("id, page_count, reference_page_sizes")
    .eq("test_id", testId)
    .eq("is_active", true)
    .eq("anchors_locked", true)
    .maybeSingle();
  if (!layout) return null;

  const { data: rows } = await supabase
    .from("test_item_anchors")
    .select(
      "question_number, part_label, page_index, x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt"
    )
    .eq("layout_id", (layout as LayoutRow).id);
  if (!rows || rows.length === 0) return null;

  const anchors = new Map<string, AnchorRow>();
  for (const r of rows as AnchorRow[]) anchors.set(anchorKey(r.question_number, r.part_label), r);
  return { layout: layout as LayoutRow, anchors };
}

/**
 * Best-effort: renders one cropped PNG per graded part, via the same Railway
 * CV service the NA scan pipeline uses (see
 * app/api/na-review/packet-scans/[id]/crop/route.ts for the sibling usage).
 *
 * TWO SOURCES FOR THE REGION, and which one was used is recorded per part in
 * evidence_box_source:
 *
 *  - 'anchor': a region a teacher drew once for this paper and locked. Every
 *    student sat the same printed booklet, so one set serves the class.
 *  - 'model': the grading model's own reported evidenceBox, padded. Audited in
 *    full against one 41-part paper, 22 of the 33 crops this produced did not
 *    contain the work they were captioned as evidence for: the model
 *    synthesises a plausible page layout rather than measuring one, and lands
 *    above the real answer every time. It remains the fallback because it is
 *    better than no crop, and because it is what every paper without a locked
 *    layout still has.
 *
 * The anchor path applies per part, not per run: a part with no region drawn
 * for it falls back to the model's box on its own, so a partly-drawn layout
 * degrades part by part instead of failing the whole scan.
 *
 * Never throws: a crop is a nice-to-have alongside the suggested grade, not
 * something worth failing (or even warning on) a whole grading run over.
 * Returns an empty map on any failure, including GRAPH_LAB_CV_SERVICE_URL
 * being unset (most local/dev environments).
 */
export async function fetchEvidenceCrops(
  supabase: SupabaseClient,
  testId: string,
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

  const locked = await loadLockedLayout(supabase, testId);

  // Anchors map to a student's scan by page index, which only holds when the
  // scan has at least the booklet's pages. A scan SHORTER than the paper has
  // lost one, and every page after the gap is then a different page from the
  // one the regions were drawn on -- so the whole scan falls back rather than
  // cropping confidently wrong regions for it. Longer is fine and common:
  // three of six sampled scans carried a trailing loose sheet after the
  // booklet's own pages, in order.
  //
  // But a long scan is only safe while the extra pages are at the END. A
  // redone cover at the front, or a working sheet in the middle, passes this
  // count and shifts every anchor after it by a page. The model's own reported
  // page is the second opinion that catches it -- see firstShiftedAnchorPage
  // for why a disagreement has to look like a shift before it is believed.
  // Unlike the short-scan case this is not all-or-nothing: pages before an
  // insertion are still the pages their regions were drawn on, so only the
  // parts at or past the shift give up their anchor.
  const useAnchors = !!locked && pageCount >= locked.layout.page_count;
  const pageObservations: AnchorPageObservation[] = [];
  if (useAnchors) {
    for (const g of grades) {
      const anchor = locked!.anchors.get(anchorKey(g.unit.questionNumber, g.unit.partLabel || null));
      const reported = g.item.evidenceBox;
      // Only a part the model actually localised is evidence either way.
      if (!anchor || !g.item.workFound || !reported) continue;
      pageObservations.push({ anchorPage: anchor.page_index + 1, modelPage: reported.page });
    }
  }
  const shiftedFrom = useAnchors ? firstShiftedAnchorPage(pageObservations) : null;

  const boxByQid = new Map<string, EvidenceBox>();
  const sourceByQid = new Map<string, "model" | "anchor">();
  const regions: CropRegion[] = [];
  /** Parts left to the model's own box, bounded together below. */
  const modelCandidates: { key: string; raw: EvidenceBox }[] = [];

  for (const g of grades) {
    const drawn = useAnchors
      ? locked!.anchors.get(anchorKey(g.unit.questionNumber, g.unit.partLabel || null))
      : undefined;
    // Past the shift, this part is no longer on the page its region was drawn
    // on, so the region is dropped and the model's own box is used below.
    const anchor =
      drawn && (shiftedFrom === null || drawn.page_index + 1 < shiftedFrom) ? drawn : undefined;

    if (anchor) {
      const referenceSize = locked!.layout.reference_page_sizes?.[anchor.page_index];
      const scanSize = pageSizePt[anchor.page_index];
      if (referenceSize && scanSize) {
        const plan = anchorCropPlan({ anchor: storedAnchorOf(anchor), referenceSize, scanSize });
        boxByQid.set(g.unit.testItemId, plan.box);
        sourceByQid.set(g.unit.testItemId, "anchor");
        regions.push({ qid: g.unit.testItemId, ...plan.region });
        continue;
      }
    }

    // -- Fallback: the model's own box, padded and bounded below -----------
    const reported = g.item.evidenceBox;
    if (!g.item.workFound || !reported) continue;
    const pageIndex = reported.page - 1;
    if (pageIndex < 0 || pageIndex >= pageCount) continue;
    modelCandidates.push({ key: g.unit.testItemId, raw: reported });
  }

  // Every box the marker reported on this run is a neighbour, including the
  // parts cut from the layout above: their reported top still says where the
  // next part's writing begins, which is what bounds the box above it. See
  // boundModelBoxes for why a bound beats the fixed bias it replaces.
  const neighbours = grades.flatMap((g) => (g.item.workFound && g.item.evidenceBox ? [g.item.evidenceBox] : []));
  for (const bounded of boundModelBoxes(modelCandidates, neighbours)) {
    const plan = modelCropPlan(bounded, pageSizePt[bounded.box.page - 1]);
    boxByQid.set(bounded.key, plan.box);
    sourceByQid.set(bounded.key, "model");
    regions.push({ qid: bounded.key, ...plan.region });
  }

  const cropped = await cropRegions({
    pdfBase64: scanBase64,
    expectedPageCount: pageCount,
    regions,
  });
  if (!cropped.ok) return byTestItemId;

  for (const crop of cropped.value) {
    const box = boxByQid.get(crop.qid);
    const source = sourceByQid.get(crop.qid);
    if (crop.imageBase64 && box && source) {
      byTestItemId.set(crop.qid, { buffer: Buffer.from(crop.imageBase64, "base64"), box, source });
    }
  }
  return byTestItemId;
}

// -----------------------------------------------------------------------------
// Persistence
// -----------------------------------------------------------------------------

/** ai_grade_runs.coverage, as the review UI and both senders' responses read it. */
export type GradeCoverage = {
  partsInAssessment: number;
  partsGraded: number;
  partsWithoutMarkscheme: number;
  suggestedTotal: number;
  maxTotal: number;
  testTotalMarks: number;
  needsReview: string[];
  acceptedCarriedForward: number;
  warnings: string[];
};

/**
 * Everything that happens after a response validates: crops, acceptance
 * carry-forward, the ai_grade_results rows, the coverage summary, and the run
 * itself to 'complete'.
 *
 * Returns { ok: false } rather than an HTTP response so the caller decides how
 * a failure is reported -- the synchronous route fails the run and answers the
 * browser, the batch collect route fails the run and moves on to the next
 * student in the same batch.
 */
export async function persistGradeOutcome(args: {
  supabase: SupabaseClient;
  testId: string;
  studentId: string;
  subject: GradingSubject;
  runId: string;
  scanBase64: string;
  units: GradingUnit[];
  gradeable: GradingUnit[];
  assemblyWarnings: string[];
  grades: ValidatedGrade[];
  warnings: string[];
  /**
   * Set when the run was asked to mark only these parts
   * (ai_grade_runs.requested_test_item_ids). Every other gradeable part's row
   * is copied from the student's previous complete run -- mark, reasoning,
   * crop and acceptance alike, and the validator's warnings for it -- so the
   * new run is still a whole paper. A student with no previous complete run
   * gets only the requested parts, and a warning says so.
   */
  requestedTestItemIds?: Set<string> | null;
}): Promise<
  | { ok: true; coverage: GradeCoverage; completionRecorded: boolean }
  | { ok: false; error: string }
> {
  const {
    supabase,
    testId,
    studentId,
    subject,
    runId,
    scanBase64,
    units,
    gradeable,
    assemblyWarnings,
    grades,
    warnings,
  } = args;
  const requested = args.requestedTestItemIds ?? null;

  // -- Evidence crops (best-effort; never blocks or fails the run) -----------
  const crops = await fetchEvidenceCrops(supabase, testId, scanBase64, grades);
  const evidenceImagePathByTestItemId = new Map<string, string>();
  for (const [testItemId, crop] of crops) {
    const storagePath = `${testId}/${studentId}/evidence/${runId}/${testItemId}.png`;
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
  /** The previous complete run's full rows, needed only for a partial re-mark (see requestedTestItemIds). */
  const priorFullRows: Record<string, unknown>[] = [];
  /** The previous complete run's warnings, likewise for a partial re-mark: the carried rows' own go with them. */
  let priorWarnings: string[] = [];
  {
    let priorCompleteQuery = supabase
      .from("ai_grade_runs")
      .select("id, coverage")
      .eq("test_id", testId)
      .eq("status", "complete")
      .neq("id", runId)
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
      if (requested) {
        const { data: fullRows } = await supabase
          .from("ai_grade_results")
          .select(
            "test_item_id, suggested_marks, max_marks, confidence, markscheme_source, work_found, reasoning, evidence, evidence_image_path, evidence_box, evidence_box_source, evidence_box_reported, mark_breakdown, accepted, accepted_at, accepted_by"
          )
          .eq("run_id", priorRun.id);
        for (const r of fullRows ?? []) priorFullRows.push(r as Record<string, unknown>);
        const priorCoverage = priorRun.coverage as Partial<GradeCoverage> | null;
        if (Array.isArray(priorCoverage?.warnings)) priorWarnings = priorCoverage.warnings;
      }
    }
  }

  // -- Persist results -------------------------------------------------------
  let acceptedCarriedForward = 0;
  const rows = grades.map((g) => {
    const prior = priorAccepted.get(g.unit.testItemId);
    const carried = prior && prior.suggested_marks === g.clampedMarks ? prior : null;
    if (carried) acceptedCarriedForward += 1;
    return {
      run_id: runId,
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
      evidence_box_source: evidenceImagePathByTestItemId.has(g.unit.testItemId)
        ? crops.get(g.unit.testItemId)?.source ?? "model"
        : null,
      // The marker's box exactly as reported, before padding or bounding, and
      // whether or not a crop came of it: a part the crop service failed on
      // can still be cut later from this, and a re-cut recomputes from it
      // rather than from a box that already carries one repair.
      evidence_box_reported: g.item.workFound && g.item.evidenceBox ? g.item.evidenceBox : null,
      mark_breakdown: g.item.markBreakdown,
      accepted: !!carried,
      accepted_at: carried?.accepted_at ?? null,
      accepted_by: carried?.accepted_by ?? null,
    };
  });

  // -- A partial re-mark carries the rest of the paper forward ----------------
  // The requested parts were just marked; every other gradeable part keeps
  // the previous run's row verbatim, acceptance included, under the new run
  // id. The crop path still points at the previous run's file, which stays
  // in Storage. A part the previous run never marked is simply absent, the
  // same as a part the model returned nothing for.
  //
  // The previous run's warnings for those parts are copied too. The review
  // panel and scripts/confidence-calibration.ts read a row's warnings from
  // the run it is stored under, so a carried "low" without them reads as
  // "the marker's own call" when the validator forced it. Partial re-marks
  // written before this was fixed (from 20 Sep 2026) dropped them;
  // scripts/backfill-carried-warnings.ts restores those runs.
  let carriedRows: typeof rows = [];
  let carriedSuggested = 0;
  const carriedNeedsReview: string[] = [];
  const carriedLabels: string[] = [];
  if (requested) {
    const marked = new Set(rows.map((r) => r.test_item_id));
    const unitById = new Map(gradeable.map((u) => [u.testItemId, u]));
    for (const prior of priorFullRows) {
      const itemId = prior.test_item_id as string;
      if (marked.has(itemId) || requested.has(itemId)) continue;
      const unit = unitById.get(itemId);
      if (!unit) continue;
      const { test_item_id: _drop, ...rest } = prior;
      void _drop;
      carriedRows.push({ ...(rest as Omit<(typeof rows)[number], "run_id" | "test_item_id">), run_id: runId, test_item_id: itemId } as (typeof rows)[number]);
      carriedSuggested += prior.suggested_marks as number;
      const label = unitLabel(unit);
      carriedLabels.push(label);
      if ((prior.confidence as string) !== "high" || prior.work_found === false) carriedNeedsReview.push(label);
    }
    if (priorFullRows.length === 0) {
      warnings.push(
        "This run marked only the requested part(s) and found no previous complete run to carry the rest of the paper from; the other parts are not shown until the student is marked in full."
      );
    }
  }
  const allRows = [...rows, ...carriedRows];

  const { error: insertErr } = await supabase.from("ai_grade_results").insert(allRows);
  if (insertErr) return { ok: false, error: `Could not save results: ${insertErr.message}` };

  const suggestedTotal = grades.reduce((s, g) => s + g.clampedMarks, 0) + carriedSuggested;
  // maxTotal covers only parts that had a mark scheme to grade against;
  // testTotalMarks is the assessment's real total, so the UI can show
  // "17/20 of 33" instead of a misleading "17/20" when parts are missing
  // a mark scheme.
  const maxTotal = gradeable.reduce((s, u) => s + u.maxMarks, 0);
  const testTotalMarks = units.reduce((s, u) => s + u.maxMarks, 0);
  const needsReview = [...grades.filter(gradeNeedsReview).map((g) => unitLabel(g.unit)), ...carriedNeedsReview];

  const coverage: GradeCoverage = {
    partsInAssessment: units.length,
    partsGraded: grades.length + carriedRows.length,
    partsWithoutMarkscheme: units.length - gradeable.length,
    suggestedTotal,
    maxTotal,
    testTotalMarks,
    needsReview,
    acceptedCarriedForward,
    warnings: [...assemblyWarnings, ...warnings, ...warningsForParts(carriedLabels, priorWarnings)],
  };

  // The result rows are already in, so a lost run update is not a lost mark
  // and must never be reported as a failure: failing here would stamp
  // 'failed' on a fully marked student and clear the pointer that is the
  // only remaining handle on them. It is reported as ok with
  // completionRecorded false instead, which asks the caller to leave the run
  // exactly where it is. The collect route's sweep then promotes it -- a run
  // that already holds ai_grade_results rows is finished work, whatever its
  // status column says.
  const { error: completeErr } = await supabase
    .from("ai_grade_runs")
    // error is cleared, not just left: a run that was failed by a sweep and is
    // then completed by the write that sweep raced would otherwise render as
    // "complete - Overnight marking was interrupted...", a real score wearing
    // a message that says not to trust it. A run reaching this line has no
    // error of its own to preserve, so clearing is safe on every path.
    .update({ status: "complete", completed_at: new Date().toISOString(), coverage, error: null })
    .eq("id", runId);

  return { ok: true, coverage, completionRecorded: !completeErr };
}
