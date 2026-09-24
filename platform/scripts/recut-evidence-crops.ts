/**
 * One-off: re-cut already-graded evidence crops for a whole assessment, so
 * work marked before a layout was drawn (or before the marker's boxes were
 * bounded at the next part) shows the same crops as work marked after.
 *
 * The decision of WHAT to cut for each row -- the locked layout's region when
 * the paper has one and the scan has its pages, otherwise the marker's own box
 * bounded at the next part -- lives in lib/evidence-recut.ts, shared with the
 * "Re-cut crops" button on the marking screen. This script adds the things a
 * class-wide backfill needs and a button does not: scope, a dry run, and an
 * undo file.
 *
 * NEVER TOUCHES A MARK. Only evidence_image_path, evidence_box and
 * evidence_box_source are written (asserted at runtime in the lib, not merely
 * intended). suggested_marks, accepted, mark_breakdown and student_marks are
 * not read, not written, and no model is called: crops are cut after marking
 * is finished and never re-enter it, so a wrong crop never produced a wrong
 * mark and a corrected one must not produce a different one.
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
import { applyRunRecut, assertOnlyRecutColumns, planRunRecut } from "../lib/evidence-recut";
import { cvServiceEndpoint } from "../lib/cv-crop-service";
import type { EvidenceBox } from "../lib/evidence-crops";

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
    assertOnlyRecutColumns(patch);
    const { error } = await supabase.from("ai_grade_results").update(patch).eq("id", row.result_id);
    if (error) console.error(`  ${row.result_id}: ${error.message}`);
    else restored++;
  }
  console.log(`restored ${restored}/${rows.length}`);
}

// ---- recut ------------------------------------------------------------

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
    .select("id, label, page_count, reference_run_id, created_at")
    .eq("test_id", testId)
    .eq("is_active", true)
    .eq("anchors_locked", true)
    .maybeSingle();

  const selected = runs.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  // The mismatch this script cannot detect for you -- see the header. Printed
  // every time, so a re-sat paper is visible before anything is written.
  const referenceRun = runs.find((r) => r.id === layout?.reference_run_id);
  console.log(
    layout
      ? `layout       : "${layout.label}" (${layout.page_count} pages, locked) -- regions cut from it; parts without one from the marker's bounded box`
      : `layout       : none locked -- every crop cut from the marker's own box, bounded at the next part`
  );
  if (layout) {
    console.log(`reference    : ${referenceRun ? `run of ${referenceRun.created_at}` : "not among these runs"}`);
  }
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
  let unchanged = 0;
  let skipped = 0;

  for (const run of selected) {
    const planned = await planRunRecut(supabase, testId, run.id as string);
    if (!planned.ok) {
      console.log(`  run ${run.id}: ${planned.error}, skipped`);
      skipped++;
      continue;
    }
    const { plan } = planned;
    for (const w of plan.warnings) console.log(`  run ${run.id}: ${w}`);
    unchanged += plan.unchanged;

    if (plan.rows.length === 0) {
      console.log(`  run ${run.id}: nothing to re-cut (${plan.unchanged} already right, ${plan.skipped} skipped)`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  run ${run.id} [${plan.mode}]: would re-cut ${plan.rows.length} parts (${plan.unchanged} already right)`);
      recut += plan.rows.length;
      continue;
    }

    // Snapshot this run's rows and flush the file BEFORE writing any of them,
    // so a run interrupted partway is still fully revertible. Flushed per run
    // rather than per crop: rewriting a growing JSON file once per part would
    // be quadratic in bytes over a class.
    for (const row of plan.rows) {
      snapshot.push({
        result_id: row.resultId,
        run_id: run.id as string,
        test_item_id: row.testItemId,
        ...row.previous,
      });
    }
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));

    const applied = await applyRunRecut(supabase, testId, plan);
    for (const f of applied.failures) console.error(`    ${f}`);
    recut += applied.recut;
    console.log(`  run ${run.id} [${plan.mode}]: re-cut ${applied.recut}/${plan.rows.length} parts`);
  }

  console.log(
    DRY_RUN
      ? `\ndry run: ${recut} parts would be re-cut across ${selected.length - skipped} runs (${unchanged} already right, ${skipped} runs skipped)`
      : `\nre-cut ${recut} parts (${unchanged} already right, ${skipped} runs skipped). snapshot: ${SNAPSHOT_PATH}`
  );
  if (!DRY_RUN && snapshot.length > 0) {
    console.log(`revert with: npx tsx scripts/recut-evidence-crops.ts --revert ${SNAPSHOT_PATH}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
