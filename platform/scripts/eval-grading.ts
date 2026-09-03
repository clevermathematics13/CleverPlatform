// Grading eval: re-grades scans whose marks a teacher has already accepted
// into Clev's Marks and compares the model's fresh suggestion against what
// was accepted. The golden set is student_marks (the teacher's final mark,
// override included) for every ai_grade_results row with accepted = true
// whose run still has its scan on file. Nothing is written back except one
// ai_usage_log row per call (pipeline "ai_grade_eval"), so cost stays
// visible.
//
// This is the check that did not exist before 3 Sep 2026: every grading,
// prompt, or model change shipped on faith, and the same scan re-marked
// minutes apart moved by 1-3 marks on several parts. Run it before and
// after any such change and compare the two JSON outputs.
//
// Usage (from platform/):
//   npx tsx scripts/eval-grading.ts --dry                    # list the golden set, no API calls
//   npx tsx scripts/eval-grading.ts                          # full run, all eligible students
//   npx tsx scripts/eval-grading.ts --limit 3 --out eval.json
//   npx tsx scripts/eval-grading.ts --model claude-sonnet-5 --temperature 0
//   npx tsx scripts/eval-grading.ts --test <test uuid>
//
// Needs SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY (or
// GRADING_ANTHROPIC_API_KEY) in the environment. Each student costs about
// what one "Re-mark stored scan" costs (~$0.15-0.25 on Opus 4.5).

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { writeFileSync } from "node:fs";
import {
  AiGradeResponseSchema,
  GRADING_MODEL,
  SCAN_BUCKET,
  assembleMarkScheme,
  buildGradingStudentPrompt,
  buildGradingSystemPrompt,
  buildGradingUserPrompt,
  validateGradeResponse,
} from "../lib/ai-grading";
import { recordUsage } from "../lib/ai-usage";

// -- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = flag("dry");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const MODEL = opt("model") ?? GRADING_MODEL;
const TEMPERATURE = opt("temperature") !== undefined ? Number(opt("temperature")) : 0;
const ONLY_TEST = opt("test");
const OUT = opt("out");

const supabaseUrl = process.env.SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.GRADING_ANTHROPIC_API_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
if (!DRY && !anthropicKey) throw new Error("ANTHROPIC_API_KEY (or GRADING_ANTHROPIC_API_KEY) is required");

const supabase = createClient(supabaseUrl, serviceKey);
const anthropic = new Anthropic({ apiKey: anthropicKey ?? "dry-run" });

// -- golden set -------------------------------------------------------------
interface GoldenPart {
  testItemId: string;
  label: string;
  maxMarks: number;
  /** What the teacher accepted into Clev's Marks (override included). */
  golden: number;
  /** What the model suggested at the time it was accepted. */
  suggestedThen: number;
}
interface GoldenStudent {
  testId: string;
  testName: string;
  studentId: string;
  studentName: string;
  scanPath: string;
  parts: GoldenPart[];
}

async function loadGoldenSet(): Promise<GoldenStudent[]> {
  const { data: rows, error } = await supabase
    .from("ai_grade_results")
    .select(
      "test_item_id, suggested_marks, max_marks, ai_grade_runs!inner(id, test_id, student_id, source_storage_path, status), test_items!inner(question_number, part_label)"
    )
    .eq("accepted", true);
  if (error) throw new Error(error.message);

  const byStudent = new Map<string, GoldenStudent>();
  const marksNeeded: { testItemId: string; studentId: string }[] = [];
  for (const r of rows ?? []) {
    const run = r.ai_grade_runs as unknown as { id: string; test_id: string; student_id: string; source_storage_path: string | null; status: string };
    const item = r.test_items as unknown as { question_number: number; part_label: string | null };
    if (!run.source_storage_path || run.status !== "complete") continue;
    if (ONLY_TEST && run.test_id !== ONLY_TEST) continue;
    const key = `${run.test_id}:${run.student_id}`;
    let s = byStudent.get(key);
    if (!s) {
      s = { testId: run.test_id, testName: "", studentId: run.student_id, studentName: "", scanPath: run.source_storage_path, parts: [] };
      byStudent.set(key, s);
    }
    const label = item.part_label ? `Q${item.question_number}(${item.part_label})` : `Q${item.question_number}`;
    // A student may have the same part accepted on more than one run; keep the first seen.
    if (s.parts.some((p) => p.testItemId === r.test_item_id)) continue;
    s.parts.push({ testItemId: r.test_item_id, label, maxMarks: r.max_marks, golden: r.suggested_marks, suggestedThen: r.suggested_marks });
    marksNeeded.push({ testItemId: r.test_item_id, studentId: run.student_id });
  }

  // Golden = the teacher's final mark in Clev's Marks, which may differ from
  // the suggestion they accepted (an override at accept time).
  const { data: marks } = await supabase
    .from("student_marks")
    .select("test_item_id, student_id, marks_awarded")
    .in("test_item_id", [...new Set(marksNeeded.map((m) => m.testItemId))])
    .in("student_id", [...new Set(marksNeeded.map((m) => m.studentId))]);
  const markByKey = new Map((marks ?? []).map((m) => [`${m.test_item_id}:${m.student_id}`, m.marks_awarded as number]));
  for (const s of byStudent.values()) {
    for (const p of s.parts) {
      const m = markByKey.get(`${p.testItemId}:${s.studentId}`);
      if (m !== undefined) p.golden = m;
    }
  }

  const testIds = [...new Set([...byStudent.values()].map((s) => s.testId))];
  const studentIds = [...new Set([...byStudent.values()].map((s) => s.studentId))];
  const [{ data: tests }, { data: profiles }] = await Promise.all([
    supabase.from("tests").select("id, name").in("id", testIds),
    supabase.from("profiles").select("id, display_name").in("id", studentIds),
  ]);
  const testName = new Map((tests ?? []).map((t) => [t.id, t.name as string]));
  const profileName = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  for (const s of byStudent.values()) {
    s.testName = testName.get(s.testId) ?? s.testId;
    s.studentName = profileName.get(s.studentId) ?? s.studentId;
    s.parts.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
  return [...byStudent.values()].sort((a, b) => a.testName.localeCompare(b.testName) || a.studentName.localeCompare(b.studentName));
}

// -- one student ------------------------------------------------------------
interface PartResult extends GoldenPart {
  predicted: number | null;
  confidence: string | null;
}
interface StudentResult {
  testName: string;
  studentName: string;
  parts: PartResult[];
  usage: { input: number; cacheWrite: number; cacheRead: number; output: number };
  error?: string;
}

async function gradeStudent(s: GoldenStudent): Promise<StudentResult> {
  const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const result: StudentResult = { testName: s.testName, studentName: s.studentName, parts: s.parts.map((p) => ({ ...p, predicted: null, confidence: null })), usage };
  try {
    const { units } = await assembleMarkScheme(supabase, s.testId);
    const gradeable = units.filter((u) => u.markschemeSource !== "none");
    const { data: file, error: dlErr } = await supabase.storage.from(SCAN_BUCKET).download(s.scanPath);
    if (dlErr || !file) throw new Error(`scan download failed: ${dlErr?.message ?? "not found"}`);
    const scanBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16384,
      temperature: TEMPERATURE,
      system: [{ type: "text", text: buildGradingSystemPrompt(gradeable), cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildGradingUserPrompt(gradeable, { testName: s.testName }), cache_control: { type: "ephemeral" } },
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: scanBase64 } },
            { type: "text", text: buildGradingStudentPrompt(s.studentName) },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(AiGradeResponseSchema) },
    });
    usage.input = message.usage.input_tokens;
    usage.cacheWrite = message.usage.cache_creation_input_tokens ?? 0;
    usage.cacheRead = message.usage.cache_read_input_tokens ?? 0;
    usage.output = message.usage.output_tokens;
    await recordUsage(supabase, { pipeline: "ai_grade_eval", model: MODEL, usage: message.usage });

    const text = message.parsed_output ? JSON.stringify(message.parsed_output) : message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const validation = validateGradeResponse(text, gradeable);
    if (!validation.ok) throw new Error(validation.error);
    for (const g of validation.outcome.grades) {
      const p = result.parts.find((x) => x.testItemId === g.unit.testItemId);
      if (p) {
        p.predicted = g.clampedMarks;
        p.confidence = g.confidence;
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

// -- metrics ----------------------------------------------------------------
const RATES: Record<string, { input: number; output: number; write: number; read: number }> = {
  "claude-opus-4-5": { input: 5, output: 25, write: 6.25, read: 0.5 },
  "claude-opus-5": { input: 5, output: 25, write: 6.25, read: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, write: 3.75, read: 0.3 },
  "claude-sonnet-5": { input: 2, output: 10, write: 2.5, read: 0.2 },
};
function costUsd(u: StudentResult["usage"], model: string): number {
  const r = RATES[model] ?? RATES["claude-opus-4-5"];
  return (u.input * r.input + u.output * r.output + u.cacheWrite * r.write + u.cacheRead * r.read) / 1e6;
}

function summarise(results: StudentResult[]) {
  const parts = results.flatMap((r) => r.parts.filter((p) => p.predicted !== null));
  const n = parts.length;
  const exact = parts.filter((p) => p.predicted === p.golden).length;
  const within1 = parts.filter((p) => Math.abs((p.predicted as number) - p.golden) <= 1).length;
  const mae = n ? parts.reduce((s, p) => s + Math.abs((p.predicted as number) - p.golden), 0) / n : 0;
  const bias = n ? parts.reduce((s, p) => s + ((p.predicted as number) - p.golden), 0) / n : 0;
  const totalGolden = parts.reduce((s, p) => s + p.golden, 0);
  const totalPredicted = parts.reduce((s, p) => s + (p.predicted as number), 0);
  const cost = results.reduce((s, r) => s + costUsd(r.usage, MODEL), 0);
  const byPart = new Map<string, { n: number; exact: number; absErr: number }>();
  for (const p of parts) {
    const b = byPart.get(p.label) ?? { n: 0, exact: 0, absErr: 0 };
    b.n += 1;
    if (p.predicted === p.golden) b.exact += 1;
    b.absErr += Math.abs((p.predicted as number) - p.golden);
    byPart.set(p.label, b);
  }
  return { n, exact, within1, mae, bias, totalGolden, totalPredicted, cost, byPart, failed: results.filter((r) => r.error).length };
}

// -- main -------------------------------------------------------------------
(async () => {
  const golden = await loadGoldenSet();
  const chosen = golden.slice(0, LIMIT);
  const totalParts = chosen.reduce((s, g) => s + g.parts.length, 0);
  console.log(`Golden set: ${golden.length} student-test(s) with a scan on file, ${golden.reduce((s, g) => s + g.parts.length, 0)} accepted parts.`);
  console.log(`Running: ${chosen.length} student-test(s), ${totalParts} parts, model=${MODEL}, temperature=${TEMPERATURE}${DRY ? " (DRY RUN, no API calls)" : ""}`);
  for (const g of chosen) console.log(`  ${g.testName} / ${g.studentName}: ${g.parts.map((p) => `${p.label}=${p.golden}/${p.maxMarks}`).join(" ")}`);
  if (DRY) return;

  const results: StudentResult[] = [];
  for (const g of chosen) {
    const r = await gradeStudent(g);
    results.push(r);
    const line = r.error
      ? `FAIL ${r.error}`
      : r.parts.map((p) => `${p.label} ${p.predicted}/${p.golden}${p.predicted !== p.golden ? "*" : ""}`).join("  ");
    console.log(`${r.studentName.padEnd(20)} ${line}   $${costUsd(r.usage, MODEL).toFixed(3)}`);
  }

  const s = summarise(results);
  console.log("\n== Summary ==");
  console.log(`parts compared: ${s.n}   exact: ${s.exact} (${((100 * s.exact) / Math.max(1, s.n)).toFixed(0)}%)   within 1 mark: ${s.within1} (${((100 * s.within1) / Math.max(1, s.n)).toFixed(0)}%)`);
  console.log(`mean abs error: ${s.mae.toFixed(2)} marks   bias (predicted - golden): ${s.bias >= 0 ? "+" : ""}${s.bias.toFixed(2)}   totals: predicted ${s.totalPredicted} vs golden ${s.totalGolden}`);
  console.log(`failed students: ${s.failed}   cost: $${s.cost.toFixed(2)}`);
  console.log("by part:", [...s.byPart.entries()].map(([k, v]) => `${k} ${v.exact}/${v.n} exact, MAE ${(v.absErr / v.n).toFixed(2)}`).join(" | "));

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, temperature: TEMPERATURE, summary: { ...s, byPart: Object.fromEntries(s.byPart) }, results }, null, 2));
    console.log(`written ${OUT}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
