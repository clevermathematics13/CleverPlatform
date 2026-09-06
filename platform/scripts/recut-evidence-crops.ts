/**
 * One-off: re-cut already-graded evidence crops from a paper's locked
 * regions, so work marked before the layout existed shows the same correct
 * crops as work marked after it.
 *
 * The grading model reports its evidenceBox as fractions of a page it is never
 * told the dimensions of, and synthesises a plausible layout rather than
 * measuring one. Audited in full against one 41-part paper, 22 of the 33 crops
 * it produced did not contain the work they were captioned as evidence for.
 * The crop machinery is exact -- all 33 reproduce byte-for-byte from their
 * recorded boxes -- so only the coordinates were ever wrong, and a re-cut needs
 * no model call at all.
 *
 * NEVER TOUCHES A MARK. Only evidence_image_path, evidence_box and
 * evidence_box_source are written, and WRITABLE_COLUMNS below is asserted
 * against at runtime rather than merely intended. suggested_marks, accepted,
 * mark_breakdown and student_marks are not read, not written, and no model is
 * called: crops are cut after marking is finished and never re-enter it, so a
 * wrong crop never produced a wrong mark and a corrected one must not produce
 * a different one.
 *
 * REVERSIBLE BY CONSTRUCTION. Every run writes a JSON snapshot of the three
 * columns for every row it is about to touch, BEFORE touching any of them, and
 * --revert <snapshot> puts them back. New PNGs go to their own storage key
 * rather than over the originals, so the image a teacher reviewed a mark
 * against still exists even after a revert.
 *
 * THE RISK THIS CANNOT CHECK FOR YOU: a layout is geometry for one physical
 * printing of a paper, and a re-sitting reuses the same tests row. If some of
 * the runs being re-cut sat a differently laid-out reprint, their crops will
 * come out confidently wrong AND be stamped source='anchor', which reads as
 * more trustworthy than the model box it replaced. The script prints the
 * reference scan's date and the date span of the runs it is about to re-cut so
 * that mismatch is visible, and refuses a whole-test run without --yes. Scope
 * with --run when a test has been sat more than once.
 *
 * Usage (from platform/):
 *   npx tsx scripts/recut-evidence-crops.ts --test <testId> --dry-run --limit 5
 *   npx tsx scripts/recut-evidence-crops.ts --run <runId> --yes
 *   npx tsx scripts/recut-evidence-crops.ts --test <testId> --yes --snapshot recut.json
 *   npx tsx scripts/recut-evidence-crops.ts --revert recut.json
 *
 * Flags:
 *   --test <id>        every complete run on this assessment
 *   --run <id>         one run (repeatable) -- the safe scope for a re-sat paper
 *   --limit <n>        stop after n runs
 *   --snapshot <path>  where to write the undo file (default recut-snapshot-<ts>.json)
 *   --dry-run          report what would change, write nothing
 *   --yes              required to write when the scope is a whole test
 *   --revert <path>    restore the three columns from a snapshot and exit
 *
 * Storage retention: superseded crops are kept. Nothing in this repo deletes
 * an evidence object, and they are the record of what a teacher actually
 * reviewed each suggested mark against. The cost is that a re-cut assessment
 * roughly doubles its share of the exam-scans bucket.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { SCAN_BUCKET, formatGradingSubject } from "../lib/ai-grading";
import {
  anchorToEvidenceBox,
  fractionBoxToPoints,
  pointsToFractions,
  type EvidenceBox,
  type PageSizePt,
} from "../lib/evidence-crops";
import { cropRegions, cvServiceEndpoint } from "../lib/cv-crop-service";

// ---- args -------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const values = (n: string) => {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === `--${n}` && argv[i + 1]) out.push(argv[i + 1]);
  });
  return out;
};
const value = (n: string) => values(n)[0];

const TEST_ID = value("test");
const RUN_IDS = values("run");
const LIMIT = value("limit") ? Number(value("limit")) : Infinity;
const DRY_RUN = flag("dry-run");
const YES = flag("yes");
const REVERT_FROM = value("revert");
const SNAPSHOT_PATH =
  value("snapshot") ?? `recut-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

// Service role: a trusted backend process, not a teacher session -- same
// contract the worker and the other one-off scripts document for this key.
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * The ONLY columns this script may write. Asserted before every update rather
 * than left as an intention: the whole safety claim of a crop backfill is that
 * it cannot move a mark, and a claim that is only in a comment is one edit
 * away from being false.
 */
const WRITABLE_COLUMNS = ["evidence_image_path", "evidence_box", "evidence_box_source"] as const;

function assertOnlyWritableColumns(patch: Record<string, unknown>) {
  const offending = Object.keys(patch).filter(
    (k) => !(WRITABLE_COLUMNS as readonly string[]).includes(k)
  );
  if (offending.length > 0) {
    throw new Error(
      `Refusing to write ${offending.join(", ")}: this script may only write ${WRITABLE_COLUMNS.join(", ")}.`
    );
  }
}

interface SnapshotRow {
  result_id: string;
  run_id: string;
  test_item_id: string;
  evidence_image_path: string | null;
  evidence_box: EvidenceBox | null;
  evidence_box_source: string | null;
}

// ---- revert -----------------------------------------------------------

async function revert(path: string) {
  const rows = JSON.parse(readFileSync(path, "utf8")) as SnapshotRow[];
  console.log(`restoring ${rows.length} rows from ${path}`);
  let restored = 0;
  for (const row of rows) {
    const patch = {
      evidence_image_path: row.evidence_image_path,
      evidence_box: row.evidence_box,
      evidence_box_source: row.evidence_box_source,
    };
    assertOnlyWritableColumns(patch);
    const { error } = await supabase.from("ai_grade_results").update(patch).eq("id", row.result_id);
    if (error) console.error(`  ${row.result_id}: ${error.message}`);
    else restored++;
  }
  console.log(`restored ${restored}/${rows.length}`);
}

// ---- recut ------------------------------------------------------------

interface AnchorRow {
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

const anchorKey = (questionNumber: number, partLabel: string | null) =>
  `${questionNumber}|${partLabel ?? ""}`;

async function main() {
  if (REVERT_FROM) {
    await revert(REVERT_FROM);
    return;
  }
  if (!TEST_ID && RUN_IDS.length === 0) {
    console.error("Nothing selected. Pass --test <id> or --run <id>.");
    process.exit(1);
  }
  if (!cvServiceEndpoint("/crop")) {
    console.error("GRAPH_LAB_CV_SERVICE_URL is not set; there is nothing to crop with.");
    process.exit(1);
  }

  // Which runs are in scope, and which test they belong to.
  let runQuery = supabase
    .from("ai_grade_runs")
    .select("id, test_id, student_id, invited_student_id, source_storage_path, created_at")
    .eq("status", "complete")
    .not("source_storage_path", "is", null)
    .order("created_at", { ascending: true });
  runQuery = RUN_IDS.length > 0 ? runQuery.in("id", RUN_IDS) : runQuery.eq("test_id", TEST_ID!);
  const { data: runs, error: runsErr } = await runQuery;
  if (runsErr) throw new Error(runsErr.message);
  if (!runs || runs.length === 0) {
    console.log("No complete runs with a scan on file matched.");
    return;
  }

  const testId = runs[0].test_id as string;
  if (runs.some((r) => r.test_id !== testId)) {
    console.error("Those runs span more than one assessment. Re-cut one assessment at a time.");
    process.exit(1);
  }

  const { data: layout } = await supabase
    .from("test_paper_layouts")
    .select("id, label, page_count, reference_page_sizes, reference_run_id, created_at")
    .eq("test_id", testId)
    .eq("is_active", true)
    .eq("anchors_locked", true)
    .maybeSingle();
  if (!layout) {
    console.error("This assessment has no active LOCKED paper layout. Draw and lock one first.");
    process.exit(1);
  }

  const { data: anchorRows } = await supabase
    .from("test_item_anchors")
    .select(
      "question_number, part_label, page_index, x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt"
    )
    .eq("layout_id", layout.id);
  const anchors = new Map<string, AnchorRow>();
  for (const a of (anchorRows ?? []) as AnchorRow[]) anchors.set(anchorKey(a.question_number, a.part_label), a);
  if (anchors.size === 0) {
    console.error("That layout has no regions drawn on it.");
    process.exit(1);
  }

  const selected = runs.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  // The mismatch this script cannot detect for you -- see the header. Printed
  // every time, so a re-sat paper is visible before anything is written.
  const referenceRun = runs.find((r) => r.id === layout.reference_run_id);
  console.log(`layout       : "${layout.label}" (${layout.page_count} pages, ${anchors.size} regions)`);
  console.log(`reference    : ${referenceRun ? `run of ${referenceRun.created_at}` : "not among these runs"}`);
  console.log(`runs to recut: ${selected.length} (${selected[0].created_at} .. ${selected[selected.length - 1].created_at})`);
  // A single named run is an explicit choice; a whole assessment needs --yes.
  const scopeConfirmed = RUN_IDS.length > 0 || YES;
  if (!DRY_RUN && !scopeConfirmed) {
    console.error(
      "Refusing a whole-assessment re-cut without --yes. Check the dates above first: a paper sat twice has runs from two different printings, and regions drawn on one are wrong for the other."
    );
    process.exit(1);
  }

  const snapshot: SnapshotRow[] = [];
  let recut = 0;
  let skipped = 0;

  for (const run of selected) {
    const subjectId = formatGradingSubject(run);
    if (!subjectId) {
      console.log(`  run ${run.id}: no student on the run, skipped`);
      skipped++;
      continue;
    }

    const { data: results } = await supabase
      .from("ai_grade_results")
      .select("id, test_item_id, evidence_image_path, evidence_box, evidence_box_source")
      .eq("run_id", run.id);
    if (!results || results.length === 0) continue;

    // The parts these results belong to, so a result can be matched to a
    // region by the natural key the layout is stored under.
    const { data: items } = await supabase
      .from("test_items")
      .select("id, question_number, part_label")
      .in(
        "id",
        results.map((r) => r.test_item_id)
      );
    const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));

    const { data: pdfFile, error: dlErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .download(run.source_storage_path as string);
    if (dlErr || !pdfFile) {
      console.log(`  run ${run.id}: scan unreadable (${dlErr?.message ?? "not found"}), skipped`);
      skipped++;
      continue;
    }
    const pdfBytes = Buffer.from(await pdfFile.arrayBuffer());
    const pdfBase64 = pdfBytes.toString("base64");

    let pageCount: number;
    const pageSizePt: PageSizePt[] = [];
    try {
      const doc = await PDFDocument.load(pdfBytes);
      pageCount = doc.getPageCount();
      for (const p of doc.getPages()) pageSizePt.push({ widthPt: p.getWidth(), heightPt: p.getHeight() });
    } catch (e) {
      console.log(`  run ${run.id}: scan unreadable (${e instanceof Error ? e.message : String(e)}), skipped`);
      skipped++;
      continue;
    }

    // Same gate the grading route applies: a scan shorter than the booklet has
    // lost a page, so every page after the gap is a different page from the one
    // the regions were drawn on.
    if (pageCount < (layout.page_count as number)) {
      console.log(`  run ${run.id}: ${pageCount}-page scan is short of the ${layout.page_count}-page paper, skipped`);
      skipped++;
      continue;
    }

    const boxByResult = new Map<string, EvidenceBox>();
    const regions = [];
    for (const result of results) {
      const item = itemById.get(result.test_item_id as string);
      if (!item) continue;
      const anchor = anchors.get(
        anchorKey(item.question_number as number, (item.part_label as string | null) || null)
      );
      if (!anchor) continue;
      const referenceSize = (layout.reference_page_sizes as PageSizePt[])?.[anchor.page_index];
      const scanSize = pageSizePt[anchor.page_index];
      if (!referenceSize || !scanSize) continue;

      const box = anchorToEvidenceBox({
        anchor: {
          x0Pt: Number(anchor.x0_pt),
          y0Pt: Number(anchor.y0_pt),
          x1Pt: Number(anchor.x1_pt),
          y1Pt: Number(anchor.y1_pt),
        },
        referenceSize,
        page: anchor.page_index + 1,
        maxY1Pt: anchor.expand_max_y1_pt === null ? undefined : Number(anchor.expand_max_y1_pt),
      });
      const capFractions = pointsToFractions(
        {
          x0Pt: 0,
          y0Pt: 0,
          x1Pt: Number(anchor.expand_max_x1_pt ?? referenceSize.widthPt),
          y1Pt: Number(anchor.expand_max_y1_pt ?? referenceSize.heightPt),
        },
        referenceSize
      );
      boxByResult.set(result.id as string, box);
      regions.push({
        qid: result.id as string,
        pageIndex: anchor.page_index,
        ...fractionBoxToPoints(box, scanSize),
        expandMaxX1Pt: capFractions.x1 * scanSize.widthPt,
        expandMaxY1Pt: capFractions.y1 * scanSize.heightPt,
      });
    }

    if (regions.length === 0) {
      console.log(`  run ${run.id}: no parts matched a region, skipped`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  run ${run.id}: would re-cut ${regions.length}/${results.length} parts`);
      recut += regions.length;
      continue;
    }

    // One call per run rather than per part: the service takes the whole set,
    // and a class's worth of single-anchor calls is the difference between
    // minutes and an hour.
    const cropped = await cropRegions({ pdfBase64, expectedPageCount: pageCount, regions });
    if (!cropped.ok) {
      console.log(`  run ${run.id}: crop failed (${cropped.error}), skipped`);
      skipped++;
      continue;
    }

    // Snapshot this run's rows and flush the file BEFORE writing any of them,
    // so a run interrupted partway is still fully revertible. Flushed per run
    // rather than per crop: rewriting a growing JSON file once per part would
    // be quadratic in bytes over a class.
    const cuttable = cropped.value.filter((c) => c.imageBase64 && boxByResult.has(c.qid));
    for (const crop of cuttable) {
      const result = results.find((r) => r.id === crop.qid)!;
      snapshot.push({
        result_id: result.id as string,
        run_id: run.id as string,
        test_item_id: result.test_item_id as string,
        evidence_image_path: (result.evidence_image_path as string | null) ?? null,
        evidence_box: (result.evidence_box as EvidenceBox | null) ?? null,
        evidence_box_source: (result.evidence_box_source as string | null) ?? null,
      });
    }
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));

    for (const crop of cuttable) {
      const result = results.find((r) => r.id === crop.qid)!;
      const box = boxByResult.get(crop.qid)!;

      const storagePath = `${testId}/${subjectId}/evidence/${run.id}/${result.test_item_id}--anchor-${Date.now()}.png`;
      const { error: uploadErr } = await supabase.storage
        .from(SCAN_BUCKET)
        .upload(storagePath, Buffer.from(crop.imageBase64!, "base64"), {
          contentType: "image/png",
          upsert: false,
        });
      if (uploadErr) {
        console.error(`    ${result.id}: upload failed (${uploadErr.message})`);
        continue;
      }

      const patch = {
        evidence_image_path: storagePath,
        evidence_box: box,
        evidence_box_source: "anchor",
      };
      assertOnlyWritableColumns(patch);
      const { error: updateErr } = await supabase
        .from("ai_grade_results")
        .update(patch)
        .eq("id", result.id);
      if (updateErr) console.error(`    ${result.id}: ${updateErr.message}`);
      else recut++;
    }
    console.log(`  run ${run.id}: re-cut ${regions.length} parts`);
  }

  console.log(
    DRY_RUN
      ? `\ndry run: ${recut} parts would be re-cut across ${selected.length - skipped} runs (${skipped} skipped)`
      : `\nre-cut ${recut} parts (${skipped} runs skipped). snapshot: ${SNAPSHOT_PATH}`
  );
  if (!DRY_RUN && snapshot.length > 0) {
    console.log(`revert with: npx tsx scripts/recut-evidence-crops.ts --revert ${SNAPSHOT_PATH}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
