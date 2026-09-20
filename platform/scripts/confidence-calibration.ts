// Confidence calibration: how often a teacher agrees with each confidence
// label, and with each reason the validator lowered one. Reads the database
// only -- no model calls, nothing written -- so it costs nothing to run after
// any change to how confidence is set (the validator in lib/ai-grading.ts,
// the prompt's definition of the labels, a marking note on a part).
//
// What it measures. Every accept writes a mark_changes row whose reason names
// the run, the suggested mark, the confidence label and whether the teacher
// applied a different number ("teacher applied N"), and whether it came
// through the per-student review or the batch button ("via batch
// accept-all"). A later mark_changes row for the same part and student that
// is NOT from a grading run is a correction made afterwards. "Disagreed"
// below means either of those. The cap cause comes from the run's
// coverage.warnings, which the validator writes per part
// (lib/ai-grade-review.ts, capCauseForPart).
//
// Read the numbers with two caveats. Most accepts come through Accept-all, so
// "not corrected afterwards" is a floor on the error rate, not a review; the
// second table restricts to parts a teacher accepted one by one. And every
// disagreement so far has clustered by PART (a mark scheme read two ways),
// not by student -- the third table shows those clusters, which is where a
// marking note on the part (test_items.marking_notes) is the fix.
//
// First run, 20 Sep 2026 (newest complete run per student, all tests):
//   high, no cap: 3888 parts, 1976 accepted, 4 disagreed
//   medium, model's own call: 326 / 168 / 10
//   medium, hedge-wording cap (since removed): 83 / 40 / 0
//   low, breakdown or deliberation cap: 31 / 21 / 12
//   low, model's own call: 15 / 11 / 0
// The SQL that first produced those numbers is in docs/eval/confidence-calibration.sql.
//
// Usage (from platform/):
//   npx tsx scripts/confidence-calibration.ts
//   npx tsx scripts/confidence-calibration.ts --test <test uuid> --out docs/eval/<date>-calibration.json
//
// Needs SUPABASE_SERVICE_ROLE_KEY in the environment.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { capCauseForPart, partWarningLabel, type CapCause } from "../lib/ai-grade-review";

// -- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const ONLY_TEST = opt("test");
const OUT = opt("out");

const supabaseUrl = process.env.SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
const supabase = createClient(supabaseUrl, serviceKey);

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
  coverage: { warnings?: string[] } | null;
}
interface ResultRow {
  id: string;
  run_id: string;
  test_item_id: string;
  suggested_marks: number;
  confidence: string;
  accepted: boolean;
  work_found: boolean | null;
}
interface ItemRow {
  id: string;
  test_id: string;
  question_number: number;
  part_label: string | null;
}
interface ChangeRow {
  id: string;
  test_item_id: string;
  student_id: string | null;
  invited_student_id: string | null;
  new_marks: number | null;
  reason: string | null;
  created_at: string;
}

const subjectOf = (r: { student_id: string | null; invited_student_id: string | null }) =>
  r.student_id ?? (r.invited_student_id ? `invited-${r.invited_student_id}` : "");

async function load(db: SupabaseClient) {
  let runs = await all<RunRow>((from, to) =>
    db.from("ai_grade_runs").select("id, test_id, student_id, invited_student_id, created_at, coverage").eq("status", "complete").order("created_at", { ascending: false }).range(from, to)
  );
  if (ONLY_TEST) runs = runs.filter((r) => r.test_id === ONLY_TEST);
  // Newest complete run per (test, student): the one the review panel shows
  // and the one an accept would have been made from most recently.
  const newest = new Map<string, RunRow>();
  for (const r of runs) {
    const key = `${r.test_id}:${subjectOf(r)}`;
    if (!newest.has(key)) newest.set(key, r);
  }
  const runIds = [...newest.values()].map((r) => r.id);
  const results: ResultRow[] = [];
  for (let i = 0; i < runIds.length; i += 200) {
    const chunk = runIds.slice(i, i + 200);
    results.push(
      ...(await all<ResultRow>((from, to) =>
        db.from("ai_grade_results").select("id, run_id, test_item_id, suggested_marks, confidence, accepted, work_found").in("run_id", chunk).order("id").range(from, to)
      ))
    );
  }
  const items = await all<ItemRow>((from, to) => db.from("test_items").select("id, test_id, question_number, part_label").order("id").range(from, to));
  const tests = await all<{ id: string; name: string }>((from, to) => db.from("tests").select("id, name").order("id").range(from, to));
  const changes = await all<ChangeRow>((from, to) =>
    db.from("mark_changes").select("id, test_item_id, student_id, invited_student_id, new_marks, reason, created_at").order("created_at").range(from, to)
  );
  return { newest, results, items, tests, changes };
}

// -- classification ---------------------------------------------------------
interface Classified {
  testId: string;
  testName: string;
  label: string;
  confidence: string;
  cause: CapCause;
  workFound: boolean;
  accepted: boolean;
  /** "individual" | "accept_all" | null (accepted but no audit row found, e.g. a carried-forward acceptance) */
  route: "individual" | "accept_all" | null;
  overridden: boolean;
  correctedLater: boolean;
  reasonSample: string | null;
}

function classify(loaded: Awaited<ReturnType<typeof load>>): Classified[] {
  const { newest, results, items, tests, changes } = loaded;
  const runById = new Map([...newest.values()].map((r) => [r.id, r]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const testName = new Map(tests.map((t) => [t.id, t.name]));
  // mark_changes grouped by (item, subject), in time order.
  const changesByKey = new Map<string, ChangeRow[]>();
  for (const c of changes) {
    const key = `${c.test_item_id}:${subjectOf(c)}`;
    const list = changesByKey.get(key) ?? [];
    list.push(c);
    changesByKey.set(key, list);
  }

  const out: Classified[] = [];
  for (const r of results) {
    const run = runById.get(r.run_id);
    const item = itemById.get(r.test_item_id);
    if (!run || !item) continue;
    const label = partWarningLabel(item);
    const cause = capCauseForPart(label, run.coverage?.warnings);
    const history = changesByKey.get(`${r.test_item_id}:${subjectOf(run)}`) ?? [];
    const acceptRow = history.find((c) => c.reason?.startsWith(`AI grading run ${run.id}`));
    let route: Classified["route"] = null;
    let overridden = false;
    let correctedLater = false;
    let reasonSample: string | null = null;
    if (acceptRow) {
      route = acceptRow.reason!.includes("via batch accept-all") ? "accept_all" : "individual";
      overridden = acceptRow.reason!.includes("teacher applied");
      if (overridden) reasonSample = acceptRow.reason!;
      const later = history.filter(
        (c) => c.created_at > acceptRow.created_at && !(c.reason ?? "").startsWith("AI grading run") && c.new_marks !== acceptRow.new_marks
      );
      if (later.length > 0) {
        correctedLater = true;
        reasonSample = later[later.length - 1].reason;
      }
    }
    out.push({
      testId: run.test_id,
      testName: testName.get(run.test_id) ?? run.test_id,
      label,
      confidence: r.confidence,
      cause,
      workFound: r.work_found !== false,
      accepted: r.accepted,
      route,
      overridden,
      correctedLater,
      reasonSample,
    });
  }
  return out;
}

// -- tables -----------------------------------------------------------------
interface Cell { parts: number; accepted: number; individual: number; acceptAll: number; overridden: number; correctedLater: number }
const cell = (): Cell => ({ parts: 0, accepted: 0, individual: 0, acceptAll: 0, overridden: 0, correctedLater: 0 });
function add(c: Cell, x: Classified) {
  c.parts += 1;
  if (x.accepted) c.accepted += 1;
  if (x.route === "individual") c.individual += 1;
  if (x.route === "accept_all") c.acceptAll += 1;
  if (x.overridden) c.overridden += 1;
  if (x.correctedLater) c.correctedLater += 1;
}
const disagreed = (c: Cell) => c.overridden + c.correctedLater;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");

function table(rows: Classified[], title: string) {
  const byKey = new Map<string, Cell>();
  for (const x of rows) {
    const key = `${x.confidence}|${x.cause}`;
    const c = byKey.get(key) ?? cell();
    add(c, x);
    byKey.set(key, c);
  }
  const order = ["high", "medium", "low"];
  const keys = [...byKey.keys()].sort((a, b) => {
    const [ca, xa] = a.split("|");
    const [cb, xb] = b.split("|");
    return order.indexOf(ca) - order.indexOf(cb) || xa.localeCompare(xb);
  });
  console.log(`\n== ${title} ==`);
  console.log("confidence  cause         parts  accepted  indiv  batch  overridden  corrected-later  disagreed");
  for (const k of keys) {
    const [conf, cause] = k.split("|");
    const c = byKey.get(k)!;
    console.log(
      `${conf.padEnd(11)} ${cause.padEnd(13)} ${String(c.parts).padStart(5)}  ${String(c.accepted).padStart(8)}  ${String(c.individual).padStart(5)}  ${String(c.acceptAll).padStart(5)}  ${String(c.overridden).padStart(10)}  ${String(c.correctedLater).padStart(15)}  ${String(disagreed(c)).padStart(4)} (${pct(disagreed(c), c.accepted)})`
    );
  }
  return Object.fromEntries(keys.map((k) => [k, byKey.get(k)!]));
}

function clusters(rows: Classified[]) {
  const byPart = new Map<string, { testName: string; label: string; accepted: number; disagreed: number; sample: string | null }>();
  for (const x of rows) {
    if (!x.accepted) continue;
    const key = `${x.testId}|${x.label}`;
    const c = byPart.get(key) ?? { testName: x.testName, label: x.label, accepted: 0, disagreed: 0, sample: null };
    c.accepted += 1;
    if (x.overridden || x.correctedLater) {
      c.disagreed += 1;
      if (!c.sample && x.reasonSample) c.sample = x.reasonSample;
    }
    byPart.set(key, c);
  }
  const top = [...byPart.values()].filter((c) => c.disagreed > 0).sort((a, b) => b.disagreed - a.disagreed).slice(0, 10);
  console.log("\n== Parts the teacher disagreed on most (accepted parts only) ==");
  if (top.length === 0) console.log("none");
  for (const c of top) {
    console.log(`${c.testName} Q${c.label}: ${c.disagreed} of ${c.accepted} accepted`);
    if (c.sample) console.log(`    e.g. ${c.sample.slice(0, 160)}`);
  }
  return top;
}

// -- main -------------------------------------------------------------------
(async () => {
  const loaded = await load(supabase);
  const rows = classify(loaded);
  console.log(`${loaded.newest.size} student-tests on their newest complete run, ${rows.length} parts${ONLY_TEST ? ` (test ${ONLY_TEST})` : ""}.`);
  const allRows = table(rows, "All parts, by confidence and cap cause");
  const reviewed = table(rows.filter((x) => x.route === "individual"), "Parts a teacher accepted one by one");
  const top = clusters(rows);
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), test: ONLY_TEST ?? null, studentTests: loaded.newest.size, parts: rows.length, all: allRows, individuallyReviewed: reviewed, clusters: top }, null, 2));
    console.log(`written ${OUT}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
