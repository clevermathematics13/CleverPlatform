// One-off: restore the validator's warnings on the parts a partial re-mark
// carried forward before persistGradeOutcome (lib/ai-grading-run.ts) copied
// them.
//
// WHAT WENT WRONG. A partial re-mark (ai_grade_runs.requested_test_item_ids,
// first used 20 Sep 2026) marks only the requested parts and copies every
// other part's row from the student's previous complete run -- mark,
// reasoning, confidence, crop, acceptance. It did not copy that run's
// coverage.warnings for those parts, and both the review panel and
// scripts/confidence-calibration.ts read a row's warnings from the run the row
// is stored under. So a carried "low" that the validator forced (the marker's
// own breakdown disagreeing with its total, say) read as "the marker's own
// call". Found on Key Assessment 1 Q10(c): a breakdown cap from 17 Sep, lost
// to eight one-part re-marks of other questions. The dry run on 24 Sep found
// 1026 warnings missing from 625 runs on two tests; on the newest runs (the
// ones the panel shows) that was 69 warnings across 47 students, and 45 rows
// below "high" giving "the marker's own call" as the reason.
//
// WHAT THIS DOES. It applies the rule the fix now applies at write time: a
// partial re-mark gets its previous complete run's warnings for every part it
// carried (its rows minus the parts it was asked to mark). Each student's runs
// on a test are repaired in the order they completed, so along a chain of
// re-marks every run inherits the warnings of the run that actually marked
// the part. It only ever ADDS a missing warning string to coverage.warnings:
// marks, labels, rows and every other coverage field are untouched, and a
// second run finds nothing to do.
//
// Usage (from platform/):
//   npx tsx scripts/backfill-carried-warnings.ts                  # dry run
//   npx tsx scripts/backfill-carried-warnings.ts --verbose        # dry run, every run listed
//   npx tsx scripts/backfill-carried-warnings.ts --yes
//   npx tsx scripts/backfill-carried-warnings.ts --test <id> --yes
//
// Needs SUPABASE_SERVICE_ROLE_KEY in the environment.

import { createClient } from "@supabase/supabase-js";
import { partWarningLabel, warningsForParts } from "../lib/ai-grade-review";

// -- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const APPLY = args.includes("--yes");
const VERBOSE = args.includes("--verbose");
const testIdx = args.indexOf("--test");
const ONLY_TEST = testIdx === -1 ? undefined : args[testIdx + 1];
if (testIdx !== -1 && !ONLY_TEST) throw new Error("--test needs a test id");

const supabaseUrl = process.env.SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -- paging -----------------------------------------------------------------
// PostgREST answers at most 1000 rows per request and says nothing when it
// truncates, so every table here is read in pages.
const PAGE = 1000;
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// -- rows -------------------------------------------------------------------
interface RunRow {
  id: string;
  test_id: string;
  student_id: string | null;
  invited_student_id: string | null;
  created_at: string;
  completed_at: string | null;
  requested_test_item_ids: string[] | null;
  coverage: Record<string, unknown> | null;
}
interface ResultRow {
  run_id: string;
  test_item_id: string;
  confidence: string;
}
interface ItemRow {
  id: string;
  test_id: string;
  question_number: number;
  part_label: string | null;
}

const subjectOf = (r: RunRow) => r.student_id ?? (r.invited_student_id ? `invited-${r.invited_student_id}` : "");
const isPartial = (r: RunRow) => (r.requested_test_item_ids?.length ?? 0) > 0;
const doneAt = (r: RunRow) => Date.parse(r.completed_at ?? r.created_at);
function warningsOf(r: RunRow): string[] {
  const w = r.coverage?.warnings;
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The run persistGradeOutcome copied from when it wrote `run`: of the runs
 * already complete by then, the one CREATED last. Not simply the run created
 * before it -- an overnight run created earlier but collected later was not
 * complete yet, so it was not the one copied from.
 */
function priorOf(run: RunRow, runs: RunRow[]): RunRow | null {
  let best: RunRow | null = null;
  for (const r of runs) {
    if (r.id === run.id || doneAt(r) >= doneAt(run)) continue;
    if (!best || Date.parse(r.created_at) > Date.parse(best.created_at)) best = r;
  }
  return best;
}

async function main() {
  const runs = await all<RunRow>((from, to) => {
    let q = supabase
      .from("ai_grade_runs")
      .select("id, test_id, student_id, invited_student_id, created_at, completed_at, requested_test_item_ids, coverage")
      .eq("status", "complete");
    if (ONLY_TEST) q = q.eq("test_id", ONLY_TEST);
    return q.order("created_at").order("id").range(from, to);
  });
  const partial = runs.filter(isPartial);
  console.log(`${runs.length} complete runs, ${partial.length} of them partial re-marks${ONLY_TEST ? ` (test ${ONLY_TEST})` : ""}.`);
  if (partial.length === 0) return;

  const testIds = [...new Set(partial.map((r) => r.test_id))];
  const items = await all<ItemRow>((from, to) =>
    supabase.from("test_items").select("id, test_id, question_number, part_label").in("test_id", testIds).order("id").range(from, to)
  );
  const labelById = new Map(items.map((i) => [i.id, partWarningLabel(i)]));
  const tests = await all<{ id: string; name: string }>((from, to) =>
    supabase.from("tests").select("id, name").in("id", testIds).order("id").range(from, to)
  );
  const testName = new Map(tests.map((t) => [t.id, t.name]));

  // What each partial re-mark carried: its rows, minus the parts it was asked
  // to mark. Confidence rides along only for the report.
  const rowsByRun = new Map<string, ResultRow[]>();
  const partialIds = partial.map((r) => r.id);
  for (let i = 0; i < partialIds.length; i += 200) {
    const chunk = partialIds.slice(i, i + 200);
    const rows = await all<ResultRow>((from, to) =>
      supabase.from("ai_grade_results").select("run_id, test_item_id, confidence").in("run_id", chunk).order("id").range(from, to)
    );
    for (const row of rows) {
      const list = rowsByRun.get(row.run_id) ?? [];
      list.push(row);
      rowsByRun.set(row.run_id, list);
    }
  }

  // Every run of one student on one test, in the order they completed, so a
  // run's prior is always repaired (in memory) before the run itself.
  const groups = new Map<string, RunRow[]>();
  for (const r of runs) {
    const key = `${r.test_id}:${subjectOf(r)}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  interface Repair {
    run: RunRow;
    added: string[];
    newest: boolean;
    /** Carried rows below "high" that had no warning of their own until now. */
    ownCallCorrected: number;
  }
  const repairs: Repair[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => doneAt(a) - doneAt(b));
    const newestId = [...group].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0].id;
    for (const run of group) {
      if (!isPartial(run)) continue;
      const prior = priorOf(run, group);
      if (!prior) continue;
      const requested = new Set(run.requested_test_item_ids ?? []);
      const carried = (rowsByRun.get(run.id) ?? []).filter((row) => !requested.has(row.test_item_id));
      const carriedLabels = carried.map((row) => labelById.get(row.test_item_id)).filter((l): l is string => !!l);
      const existing = warningsOf(run);
      const have = new Set(existing);
      const added = warningsForParts(carriedLabels, warningsOf(prior)).filter((w) => !have.has(w));
      if (added.length === 0) continue;
      // Counted before the in-memory update below, so "had none" means had
      // none in the database.
      const ownCallCorrected = carried.filter((row) => {
        const label = labelById.get(row.test_item_id);
        if (!label || row.confidence === "high") return false;
        const prefix = `${label}: `;
        return !existing.some((w) => w.startsWith(prefix)) && added.some((w) => w.startsWith(prefix));
      }).length;
      // Updated in memory as well, so a later re-mark copying from this run
      // inherits what was just restored.
      run.coverage = { ...(run.coverage ?? {}), warnings: [...existing, ...added] };
      repairs.push({ run, added, newest: run.id === newestId, ownCallCorrected });
    }
  }

  // -- report ---------------------------------------------------------------
  const byTest = new Map<string, Repair[]>();
  for (const rep of repairs) {
    const list = byTest.get(rep.run.test_id) ?? [];
    list.push(rep);
    byTest.set(rep.run.test_id, list);
  }
  for (const [testId, list] of byTest) {
    const newest = list.filter((r) => r.newest);
    console.log(
      `\n${testName.get(testId) ?? testId} (${testId})\n` +
        `  runs to update: ${list.length}, warnings restored: ${list.reduce((s, r) => s + r.added.length, 0)}\n` +
        `  on the newest run the panel shows: ${newest.length} students, ${newest.reduce((s, r) => s + r.added.length, 0)} warnings, ` +
        `${newest.reduce((s, r) => s + r.ownCallCorrected, 0)} rows below "high" that stop reading "the marker's own call"`
    );
    if (VERBOSE) {
      for (const rep of list) {
        const labels = [...new Set(rep.added.map((w) => w.slice(0, w.indexOf(": "))))].join(", ");
        console.log(`    ${rep.run.id} ${rep.run.created_at}${rep.newest ? " (newest)" : ""}: +${rep.added.length} for ${labels}`);
      }
    }
  }
  if (repairs.length === 0) {
    console.log("Nothing to restore.");
    return;
  }

  if (!APPLY) {
    console.log(`\nDry run: nothing written. Re-run with --yes to update ${repairs.length} run(s).`);
    return;
  }

  let written = 0;
  for (const rep of repairs) {
    const { error } = await supabase.from("ai_grade_runs").update({ coverage: rep.run.coverage }).eq("id", rep.run.id);
    if (error) {
      console.error(`  ${rep.run.id}: ${error.message}`);
      continue;
    }
    written += 1;
  }
  console.log(`\nUpdated ${written} of ${repairs.length} run(s).`);
  if (written < repairs.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
