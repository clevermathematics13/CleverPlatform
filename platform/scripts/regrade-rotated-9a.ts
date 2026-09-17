/**
 * One-off: re-grade the 9A Key Assessment 1 batch from scans whose even pages
 * have been turned the right way up.
 *
 * Batch 05aadd46 was duplex-scanned and uploaded without the even-page 180
 * rotation the runbook calls for, so pages 2, 4, 6 and 8 reached the model
 * upside down for all thirteen students. Nothing in the pipeline detects or
 * corrects orientation (docs/HANDOFF.md section 5), and the failure is silent:
 * the model does not refuse an inverted page, it confabulates a reading of it.
 * Measured on this batch -- Kaito Fujii's Q13(b) reads "Because the 10% has to
 * be 20% of the price of jacket not to the takes of 20%" upright, and was
 * transcribed "Because 10% of 80% of price to be add to 10% of price" inverted.
 * Santiago Caipo's paper was scanned both ways by accident and scored 48
 * upright against 35 flipped, so this is worth marks, not just legibility.
 *
 * It grades through lib/ai-grading-run.ts -- the same buildGradingRequest and
 * persistGradeOutcome the interactive route and the overnight batch both use --
 * so the rows it writes cannot drift from the ones the app writes. The
 * orchestration around them mirrors app/api/tests/[id]/ai-grade/route.ts.
 *
 * WHAT IT DOES NOT TOUCH. student_marks ("Clev's Marks") is written only by the
 * accept route, never by grading, so a teacher's existing mark survives this
 * untouched. persistGradeOutcome's own carry-forward re-applies an acceptance
 * for any part whose suggestion did not move. The original runs and their PDFs
 * are left in place -- delete them separately once the new marks are reviewed,
 * or the review UI shows each student twice.
 */

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  GRADING_MODEL,
  MAX_SCAN_BYTES,
  SCAN_BUCKET,
  parseGradingSubject,
  validateGradeResponse,
} from "../lib/ai-grading";
import {
  buildGradingRequest,
  loadGradeableMarkScheme,
  loadStudentDisplayName,
  persistGradeOutcome,
} from "../lib/ai-grading-run";
import { recordUsage } from "../lib/ai-usage";

const TEST_ID = "ccfa0456-a7f7-4835-81d4-7983df021022";
const TEACHER_ID = "702750f6-be43-47d2-a422-a2f15b4d0bf9";

type Target = { studentId: string; student: string; pdf: string };

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const manifestPath = process.argv[process.argv.indexOf("--manifest") + 1];
  const targets: Target[] = JSON.parse(readFileSync(manifestPath, "utf8"));
  const supabase = service();

  const apiKey = process.env.GRADING_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key in the environment");
  const anthropic = new Anthropic({ apiKey });

  const { data: test } = await supabase.from("tests").select("id, name").eq("id", TEST_ID).maybeSingle();
  if (!test) throw new Error("Assessment not found");

  const { units, gradeable, assemblyWarnings } = await loadGradeableMarkScheme(supabase, TEST_ID);
  console.log(`${test.name}: ${gradeable.length} gradeable parts, ${assemblyWarnings.length} assembly warnings`);
  if (gradeable.length === 0) throw new Error("Nothing gradeable");

  for (const t of targets) {
    const buffer = readFileSync(t.pdf);
    if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") throw new Error(`${t.pdf} is not a PDF`);
    if (buffer.length > MAX_SCAN_BYTES) throw new Error(`${t.pdf} exceeds the 30MB scan limit`);

    const storagePath = `${TEST_ID}/${t.studentId}/${Date.now()}-upright-05aadd46.pdf`;
    console.log(`\n${t.student}: ${(buffer.length / 1024 / 1024).toFixed(1)}MB -> ${storagePath}`);
    if (dry) continue;

    const { error: upErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`upload failed for ${t.student}: ${upErr.message}`);

    const subject = parseGradingSubject(t.studentId);
    const studentDisplayName = await loadStudentDisplayName(supabase, subject);

    const { data: run, error: runErr } = await supabase
      .from("ai_grade_runs")
      .insert({
        test_id: TEST_ID,
        student_id: subject.kind === "profile" ? subject.id : null,
        invited_student_id: subject.kind === "invited" ? subject.id : null,
        created_by: TEACHER_ID,
        status: "running",
        model: GRADING_MODEL,
        source_storage_path: storagePath,
      })
      .select("id")
      .single();
    if (runErr || !run) throw new Error(`run insert failed for ${t.student}: ${runErr?.message}`);
    console.log(`  run ${run.id} opened`);
    {
      // The run must be readable back before a minute of grading is spent
      // against it: persistGradeOutcome's first write is a foreign key onto
      // this row, and a row that is not there fails only after the model call
      // has already been paid for.
      const { data: check, error: checkErr } = await supabase
        .from("ai_grade_runs").select("id, source_storage_path").eq("id", run.id).maybeSingle();
      if (checkErr || !check) throw new Error(`run ${run.id} not readable after insert: ${checkErr?.message ?? "missing"}`);
      if (check.source_storage_path !== storagePath) {
        throw new Error(`run ${run.id} stored path ${check.source_storage_path}, expected ${storagePath}`);
      }
    }

    const scanBase64 = buffer.toString("base64");
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
        if (message.stop_reason === "max_tokens") { lastError = "cut off at max_tokens"; continue; }
        responseText = message.parsed_output
          ? JSON.stringify(message.parsed_output)
          : message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      } catch (e) {
        lastError = `request failed: ${e instanceof Error ? e.message : String(e)}`;
        break;
      }
      if (!responseText.trim()) { lastError = "empty response"; continue; }
      const v = validateGradeResponse(responseText, gradeable);
      if (v.ok) validation = v; else lastError = v.error;
    }

    if (!validation || !validation.ok) {
      await supabase.from("ai_grade_runs")
        .update({ status: "failed", error: lastError, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      console.log(`  FAILED: ${lastError}`);
      continue;
    }

    const { grades, warnings } = validation.outcome;
    const persisted = await persistGradeOutcome({
      supabase, testId: TEST_ID, studentId: t.studentId, subject, runId: run.id,
      scanBase64, units, gradeable, assemblyWarnings, grades, warnings,
    });
    if (!persisted.ok) {
      await supabase.from("ai_grade_runs")
        .update({ status: "failed", error: persisted.error, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      console.log(`  PERSIST FAILED: ${persisted.error}`);
      continue;
    }
    const total = grades.reduce((s, g) => s + g.clampedMarks, 0);
    console.log(`  run ${run.id}  total ${total}  carried ${persisted.coverage.acceptedCarriedForward}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
