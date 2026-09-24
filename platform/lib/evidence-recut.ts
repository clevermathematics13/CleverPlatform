/**
 * Re-cutting one graded run's evidence crops without calling a model.
 *
 * Two callers need exactly the same decision: the "Re-cut crops" button on
 * the marking screen (app/api/tests/[id]/ai-grade/recut-crops/route.ts) and
 * the one-off backfill script (scripts/recut-evidence-crops.ts). The earlier
 * split -- a route and a script each spelling out which rows to touch and
 * how -- is how the two came to disagree, and how one of them ("Fix crops",
 * 18-23 Sep 2026) came to apply a 0.15 downward extension to rows that
 * already carried it, once more per click.
 *
 * WHICH GEOMETRY. If the paper has a locked layout and this scan has at least
 * its pages, every part with a region is cut from the layout ('anchor'), the
 * same arithmetic the grading run uses, so a run marked before the layout was
 * drawn ends up with the crops it would have had after. Anything else is cut
 * from the marker's own box, bounded at the next part (lib/evidence-crops.ts):
 * from the reported box when the row has one, else from the stored box under
 * the legacy rule, which can only ever cut a bottom edge back.
 *
 * IDEMPOTENT. A row whose recomputed box is the stored box, with the same
 * source and an image already on file, is reported as unchanged and not cut.
 * Pressing the button twice does nothing the second time.
 *
 * NEVER TOUCHES A MARK, and never a region a teacher drew. Only the three
 * crop columns are written (RECUT_WRITABLE_COLUMNS, asserted at runtime), and
 * evidence_box_reported is read, never written: it is the record of what the
 * marker said. Crops are cut after marking has finished and never re-enter
 * it, so a wrong crop never produced a wrong mark and a corrected one must
 * not produce a different one.
 *
 * Server-only: reads Storage, calls the CV service.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { SCAN_BUCKET } from "./ai-grading";
import { anchorKey, loadLockedLayout, storedAnchorOf } from "./ai-grading-run";
import { cropRegions, cvServiceEndpoint, type CropRegion } from "./cv-crop-service";
import {
  anchorCropPlan,
  boundModelBoxes,
  boundStoredModelBoxes,
  firstShiftedAnchorPage,
  modelCropPlan,
  sameBox,
  type AnchorPageObservation,
  type EvidenceBox,
  type PageSizePt,
} from "./evidence-crops";
import { formatGradingSubject } from "./grading-subject";

export type RecutMode = "layout" | "model";

/** The three columns a re-cut may write, and the only three. */
export const RECUT_WRITABLE_COLUMNS = ["evidence_image_path", "evidence_box", "evidence_box_source"] as const;

export function assertOnlyRecutColumns(patch: Record<string, unknown>): void {
  const offending = Object.keys(patch).filter(
    (k) => !(RECUT_WRITABLE_COLUMNS as readonly string[]).includes(k)
  );
  if (offending.length > 0) {
    throw new Error(
      `Refusing to write ${offending.join(", ")}: a re-cut may only write ${RECUT_WRITABLE_COLUMNS.join(", ")}.`
    );
  }
}

/** What the row held before the re-cut -- the script snapshots this for --revert. */
export interface RecutPreviousColumns {
  evidence_image_path: string | null;
  evidence_box: EvidenceBox | null;
  evidence_box_source: string | null;
}

export interface RecutPlanRow {
  resultId: string;
  testItemId: string;
  target: EvidenceBox;
  source: "model" | "anchor";
  region: CropRegion;
  previous: RecutPreviousColumns;
}

export interface RecutPlan {
  mode: RecutMode;
  runId: string;
  subjectId: string;
  pdfBase64: string;
  pageCount: number;
  /** Rows that will be cut. */
  rows: RecutPlanRow[];
  /** Rows whose crop is already what a re-cut would produce. */
  unchanged: number;
  /** Rows nothing could be done for (no box, off the page, teacher-drawn). */
  skipped: number;
  warnings: string[];
}

export type PlanRunRecutResult =
  | { ok: true; plan: RecutPlan }
  | { ok: false; error: string; status: 400 | 404 | 422 | 500 | 503 };

interface ResultRow {
  id: string;
  test_item_id: string;
  evidence_image_path: string | null;
  evidence_box: EvidenceBox | null;
  evidence_box_source: string | null;
  evidence_box_reported: EvidenceBox | null;
}

const asBox = (value: unknown): EvidenceBox | null => {
  if (!value || typeof value !== "object") return null;
  const b = value as Record<string, unknown>;
  const nums = [b.page, b.x0, b.y0, b.x1, b.y1];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { page: b.page as number, x0: b.x0 as number, y0: b.y0 as number, x1: b.x1 as number, y1: b.y1 as number };
};

/**
 * Decide what a re-cut of this run would do, without doing it.
 */
export async function planRunRecut(
  supabase: SupabaseClient,
  testId: string,
  runId: string
): Promise<PlanRunRecutResult> {
  if (!cvServiceEndpoint("/crop")) {
    return { ok: false, error: "Cropping is not configured on this deployment", status: 503 };
  }

  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, student_id, invited_student_id, source_storage_path")
    .eq("id", runId)
    .maybeSingle();
  if (runErr) return { ok: false, error: runErr.message, status: 500 };
  if (!run || run.test_id !== testId) {
    return { ok: false, error: "That run does not belong to this assessment", status: 400 };
  }
  if (!run.source_storage_path) {
    return { ok: false, error: "No source scan on file for this run", status: 404 };
  }
  const subjectId = formatGradingSubject(run);
  if (!subjectId) {
    return { ok: false, error: "This run has no student on it to file crops under", status: 422 };
  }

  const { data: resultRows, error: resultsErr } = await supabase
    .from("ai_grade_results")
    .select("id, test_item_id, evidence_image_path, evidence_box, evidence_box_source, evidence_box_reported")
    .eq("run_id", runId);
  if (resultsErr) return { ok: false, error: resultsErr.message, status: 500 };
  const results: ResultRow[] = (resultRows ?? []).map((r) => ({
    id: r.id as string,
    test_item_id: r.test_item_id as string,
    evidence_image_path: (r.evidence_image_path as string | null) ?? null,
    evidence_box: asBox(r.evidence_box),
    evidence_box_source: (r.evidence_box_source as string | null) ?? null,
    evidence_box_reported: asBox(r.evidence_box_reported),
  }));

  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(run.source_storage_path);
  if (dlErr || !pdfFile) {
    return { ok: false, error: dlErr?.message ?? "Could not read the source scan", status: 500 };
  }
  const pdfBytes = Buffer.from(await pdfFile.arrayBuffer());
  const pdfBase64 = pdfBytes.toString("base64");

  let pageCount = 0;
  const pageSizes: PageSizePt[] = [];
  try {
    const doc = await PDFDocument.load(pdfBytes);
    pageCount = doc.getPageCount();
    for (const p of doc.getPages()) pageSizes.push({ widthPt: p.getWidth(), heightPt: p.getHeight() });
  } catch (e) {
    return {
      ok: false,
      error: `Could not read the source scan: ${e instanceof Error ? e.message : String(e)}`,
      status: 500,
    };
  }

  const warnings: string[] = [];
  const locked = await loadLockedLayout(supabase, testId);
  let mode: RecutMode = "model";
  if (locked) {
    if (pageCount >= locked.layout.page_count) mode = "layout";
    else {
      warnings.push(
        `This ${pageCount}-page scan is short of the ${locked.layout.page_count}-page paper layout, so the marker's own boxes were used instead.`
      );
    }
  }

  const rows: RecutPlanRow[] = [];
  let unchanged = 0;
  let skipped = 0;
  const previousOf = (r: ResultRow): RecutPreviousColumns => ({
    evidence_image_path: r.evidence_image_path,
    evidence_box: r.evidence_box,
    evidence_box_source: r.evidence_box_source,
  });
  const consider = (r: ResultRow, target: EvidenceBox, source: "model" | "anchor", region: CropRegion) => {
    if (r.evidence_image_path && sameBox(target, r.evidence_box) && (r.evidence_box_source ?? "model") === source) {
      unchanged++;
      return;
    }
    rows.push({ resultId: r.id, testItemId: r.test_item_id, target, source, region, previous: previousOf(r) });
  };

  // A region a teacher drew is a decision; nothing here overrides it.
  const candidates = results.filter((r) => r.evidence_box_source !== "teacher");
  skipped += results.length - candidates.length;

  let leftToModel = candidates;
  if (mode === "layout") {
    const itemIds = [...new Set(candidates.map((r) => r.test_item_id))];
    const { data: items, error: itemsErr } = await supabase
      .from("test_items")
      .select("id, question_number, part_label")
      .in("id", itemIds);
    if (itemsErr) return { ok: false, error: itemsErr.message, status: 500 };
    const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
    const anchorFor = (r: ResultRow) => {
      const item = itemById.get(r.test_item_id);
      if (!item) return undefined;
      return locked!.anchors.get(
        anchorKey(item.question_number as number, ((item.part_label as string | null) || null))
      );
    };

    // Same second opinion the grading run takes: the marker's reported page
    // per part, read from the content, against the page the layout puts it
    // on. A shift that has the shape of an inserted page drops the anchors
    // from that page on (see firstShiftedAnchorPage).
    const observations: AnchorPageObservation[] = [];
    for (const r of candidates) {
      const anchor = anchorFor(r);
      const modelPage =
        r.evidence_box_reported?.page ??
        ((r.evidence_box_source ?? "model") === "model" ? r.evidence_box?.page : undefined);
      if (!anchor || modelPage === undefined) continue;
      observations.push({ anchorPage: anchor.page_index + 1, modelPage });
    }
    const shiftedFrom = firstShiftedAnchorPage(observations);
    if (shiftedFrom !== null) {
      warnings.push(
        `The marker read this scan's pages as shifted from page ${shiftedFrom}; parts from there on were cut from the marker's own boxes.`
      );
    }

    leftToModel = [];
    for (const r of candidates) {
      const drawn = anchorFor(r);
      const anchor = drawn && (shiftedFrom === null || drawn.page_index + 1 < shiftedFrom) ? drawn : undefined;
      const referenceSize = anchor ? locked!.layout.reference_page_sizes?.[anchor.page_index] : undefined;
      const scanSize = anchor ? pageSizes[anchor.page_index] : undefined;
      if (!anchor || !referenceSize || !scanSize) {
        leftToModel.push(r);
        continue;
      }
      const plan = anchorCropPlan({ anchor: storedAnchorOf(anchor), referenceSize, scanSize });
      consider(r, plan.box, "anchor", { qid: r.id, ...plan.region });
    }
  }

  // -- The marker's own box, bounded at the next part --------------------------
  // A row already cut from a layout keeps its measured crop when there is no
  // layout to re-cut it from; a guess is not an improvement on a measurement.
  // It still bounds its neighbours below.
  const modelRows = leftToModel.filter((r) => r.evidence_box_source !== "anchor");
  skipped += leftToModel.length - modelRows.length;
  const onPage = (box: EvidenceBox | null): box is EvidenceBox =>
    !!box && box.page >= 1 && box.page <= pageSizes.length;

  const reportedNeighbours = results.flatMap((r) => (onPage(r.evidence_box_reported) ? [r.evidence_box_reported] : []));
  const storedNeighbours = results.flatMap((r) => (onPage(r.evidence_box) ? [r.evidence_box] : []));

  const withReported = modelRows.filter((r) => onPage(r.evidence_box_reported));
  const withStoredOnly = modelRows.filter((r) => !onPage(r.evidence_box_reported) && onPage(r.evidence_box));
  skipped += modelRows.length - withReported.length - withStoredOnly.length;

  const byId = new Map(results.map((r) => [r.id, r]));
  for (const bounded of boundModelBoxes(
    withReported.map((r) => ({ key: r.id, raw: r.evidence_box_reported! })),
    reportedNeighbours
  )) {
    const plan = modelCropPlan(bounded, pageSizes[bounded.box.page - 1]);
    consider(byId.get(bounded.key)!, plan.box, "model", { qid: bounded.key, ...plan.region });
  }
  for (const bounded of boundStoredModelBoxes(
    withStoredOnly.map((r) => ({ key: r.id, stored: r.evidence_box! })),
    storedNeighbours
  )) {
    const plan = modelCropPlan(bounded, pageSizes[bounded.box.page - 1]);
    consider(byId.get(bounded.key)!, plan.box, "model", { qid: bounded.key, ...plan.region });
  }

  return {
    ok: true,
    plan: { mode, runId, subjectId, pdfBase64, pageCount, rows, unchanged, skipped, warnings },
  };
}

/**
 * Cut the planned rows: one CV-service call for the whole student, a new PNG
 * per row (the original stays -- it is what the mark was reviewed against),
 * and an update of the three crop columns only.
 */
export async function applyRunRecut(
  supabase: SupabaseClient,
  testId: string,
  plan: RecutPlan
): Promise<{ recut: number; failures: string[] }> {
  if (plan.rows.length === 0) return { recut: 0, failures: [] };

  const cropped = await cropRegions({
    pdfBase64: plan.pdfBase64,
    expectedPageCount: plan.pageCount,
    regions: plan.rows.map((r) => r.region),
  });
  if (!cropped.ok) return { recut: 0, failures: [cropped.error] };

  const stamp = Date.now();
  const rowByResult = new Map(plan.rows.map((r) => [r.resultId, r]));
  let recut = 0;
  const failures: string[] = [];
  for (const crop of cropped.value) {
    const row = rowByResult.get(crop.qid);
    if (!row) continue;
    if (!crop.imageBase64) {
      failures.push(`${row.testItemId}: the crop service returned no image`);
      continue;
    }
    const storagePath = `${testId}/${plan.subjectId}/evidence/${plan.runId}/${row.testItemId}--${
      row.source === "anchor" ? "anchor" : "recut"
    }-${stamp}.png`;
    const { error: uploadErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .upload(storagePath, Buffer.from(crop.imageBase64, "base64"), {
        contentType: "image/png",
        upsert: false,
      });
    if (uploadErr) {
      failures.push(`${row.testItemId}: ${uploadErr.message}`);
      continue;
    }
    const patch = {
      evidence_image_path: storagePath,
      evidence_box: row.target,
      evidence_box_source: row.source,
    };
    assertOnlyRecutColumns(patch);
    const { error: updateErr } = await supabase.from("ai_grade_results").update(patch).eq("id", row.resultId);
    if (updateErr) failures.push(`${row.testItemId}: ${updateErr.message}`);
    else recut++;
  }
  return { recut, failures };
}
