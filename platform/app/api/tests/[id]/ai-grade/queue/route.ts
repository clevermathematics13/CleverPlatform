import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { getApiTeacher } from "@/lib/auth";
import {
  GRADING_MODEL,
  MAX_SCAN_BYTES,
  SCAN_BUCKET,
  parseGradingSubject,
} from "@/lib/ai-grading";
import type { GradingUnit } from "@/lib/ai-grading";
import {
  buildGradingRequest,
  loadGradeableMarkScheme,
  loadStudentDisplayName,
} from "@/lib/ai-grading-run";

export const maxDuration = 300;

/**
 * How many students go into one submitted batch.
 *
 * NOT Anthropic's ceiling (100,000 requests / 256MB per batch) -- this
 * function's own. Every scan has to come out of Storage and sit in this
 * invocation's heap as base64 before the create call, and the whole download
 * loop plus the submit shares one 300s serverless budget. 20 booklets of
 * 3-18MB each clears both comfortably; whatever is left over comes back as
 * `remaining` and the client calls again.
 */
export const MAX_BATCH_REQUESTS = 20;

/**
 * How much accumulated base64 goes into one submitted batch.
 *
 * Two ceilings meet here. Anthropic rejects a batch over 256MB on the wire,
 * and base64 costs 4/3 of the raw PDF -- but long before that, this function
 * holds every encoded scan in memory at once, so the submit stops at 64MB of
 * base64 (~48MB of PDF) whichever of the two limits it reaches first. A
 * single student can never stall the loop against this: MAX_SCAN_BYTES caps
 * one scan at 30MB raw, ~40MB encoded.
 */
export const MAX_BATCH_BASE64_BYTES = 64 * 1024 * 1024;

/** Per-request cap on the class list, so one call cannot walk an unbounded roster. */
const MAX_STUDENTS_PER_REQUEST = 200;

interface QueuedStudent {
  studentId: string;
  storagePath: string;
}

/**
 * POST /api/tests/[id]/ai-grade/queue
 * Body: { students: { studentId: string, storagePath: string }[] }
 *
 * Overnight marking: sends a whole class to Anthropic's Message Batches API
 * (50% off every token, cache reads and writes included) in the one request
 * the teacher's click makes, instead of the browser looping over students
 * against the synchronous route at full price with a tab that must stay open.
 *
 * The storage paths are the per-student PDFs the split route has just written
 * (app/api/tests/[id]/ai-grade/batch/[batchId]/split), so this route only
 * downloads and submits -- it never splits and never calls the model
 * synchronously.
 *
 * Nothing collects the results on a timer: there is no worker and no cron in
 * this design. The AI grade page calls the collect route when it loads and
 * while any batch is still open, plus a "Check for results" button. Anthropic
 * keeps results for 29 days, so a class marked overnight is still there if
 * nobody opens the page for a week.
 *
 * BOUNDED: one call submits at most MAX_BATCH_REQUESTS students or
 * MAX_BATCH_BASE64_BYTES of scan, then stops and returns the rest as
 * `remaining` for the client to send back. Usage is deliberately not recorded
 * here -- a batch reports its tokens per result, so the collect route writes
 * the ai_usage_log rows (at the batch rate) as it reads them.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { id: testId } = await params;

  let body: { students?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.students) || body.students.length === 0) {
    return NextResponse.json({ error: "students must be a non-empty array" }, { status: 400 });
  }
  if (body.students.length > MAX_STUDENTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `At most ${MAX_STUDENTS_PER_REQUEST} students can be queued in one call` },
      { status: 400 }
    );
  }

  const students: QueuedStudent[] = [];
  for (const raw of body.students as Record<string, unknown>[]) {
    const studentId = typeof raw.studentId === "string" ? raw.studentId.trim() : "";
    const storagePath = typeof raw.storagePath === "string" ? raw.storagePath.trim() : "";
    if (!studentId || !storagePath) {
      return NextResponse.json(
        { error: "Every student needs a studentId and a storagePath" },
        { status: 400 }
      );
    }
    // The same guard the synchronous route applies, and for the same reason:
    // without it this route would read any object in the bucket. Rejected
    // outright rather than recorded as a per-student failure -- the client
    // builds these paths from the split route's own response, so a path
    // outside the student's folder is a bug, not a bad scan.
    if (!storagePath.startsWith(`${testId}/${studentId}/`)) {
      return NextResponse.json(
        {
          error: `storagePath for ${studentId} must be under this test and student's own scan folder`,
        },
        { status: 400 }
      );
    }
    students.push({ studentId, storagePath });
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

  // -- Mark scheme assembly --------------------------------------------------
  // Checked before a single PDF is downloaded. A batch that cannot be marked
  // fails one student at a time hours later, with the tokens already spent,
  // so "nothing to grade against" has to be an answer the teacher gets while
  // they are still looking at the screen.
  let gradeable: GradingUnit[];
  let assemblyWarnings: string[];
  try {
    ({ gradeable, assemblyWarnings } = await loadGradeableMarkScheme(supabase, testId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Mark scheme assembly failed" },
      { status: 500 }
    );
  }

  if (gradeable.length === 0) {
    return NextResponse.json(
      {
        error:
          "No mark scheme text is stored for any part of this assessment. Extract the mark scheme LaTeX in the PPQ Bank first, then queue the class for overnight marking.",
        warnings: assemblyWarnings,
      },
      { status: 422 }
    );
  }

  // -- Download as far as the ceilings allow ---------------------------------
  // A student whose scan is missing, empty, oversized or not a PDF is dropped
  // into `failed` and the rest of the class still goes out: one bad upload in
  // a class of 30 must not cost the other 29 their overnight run. The PDF
  // magic-number check is worth its microsecond here -- a non-PDF sent in a
  // batch comes back as an errored result hours later instead of now.
  const failed: { studentId: string; error: string }[] = [];
  const collected: {
    studentId: string;
    storagePath: string;
    scanBase64: string;
    displayName?: string;
  }[] = [];

  let base64Bytes = 0;
  // Index of the first student this call did not get to. Everything from here
  // on is handed back as `remaining`; the student that trips the byte ceiling
  // is included in it and re-downloaded next call, which is cheaper than
  // carrying the bytes forward across two requests.
  let stoppedAt = students.length;

  for (let i = 0; i < students.length; i++) {
    if (collected.length >= MAX_BATCH_REQUESTS) {
      stoppedAt = i;
      break;
    }
    const student = students[i];

    const { data: file, error: dlErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .download(student.storagePath);
    if (dlErr || !file) {
      failed.push({
        studentId: student.studentId,
        error: `Could not read the uploaded scan: ${dlErr?.message ?? "not found"}`,
      });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      failed.push({ studentId: student.studentId, error: "Uploaded scan was empty" });
      continue;
    }
    if (buffer.length > MAX_SCAN_BYTES) {
      failed.push({
        studentId: student.studentId,
        error: `Scan is ${(buffer.length / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_SCAN_BYTES / 1024 / 1024}MB. Reduce the scan resolution or split the file.`,
      });
      continue;
    }
    if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
      failed.push({
        studentId: student.studentId,
        error: "Uploaded file is not a PDF. Combine photos into a single PDF before uploading.",
      });
      continue;
    }

    const scanBase64 = buffer.toString("base64");
    // Only measurable after the download, so it stops the loop rather than
    // skipping this student. The collected.length guard keeps a first student
    // in even if they alone exceeded the ceiling, so the loop cannot spin
    // forever on one file -- unreachable while MAX_SCAN_BYTES stays below it.
    if (collected.length > 0 && base64Bytes + scanBase64.length > MAX_BATCH_BASE64_BYTES) {
      stoppedAt = i;
      break;
    }
    base64Bytes += scanBase64.length;

    collected.push({
      ...student,
      scanBase64,
      displayName: await loadStudentDisplayName(
        supabase,
        parseGradingSubject(student.studentId)
      ),
    });
  }

  const remaining = students.slice(stoppedAt);

  if (collected.length === 0) {
    // Every student this call reached had an unusable scan. No batch is
    // created (Anthropic rejects an empty request list) and no run is opened.
    return NextResponse.json({
      batchId: null,
      anthropicBatchId: null,
      submitted: [],
      failed,
      remaining,
    });
  }

  // -- Order of writes -------------------------------------------------------
  // Crash safety turns on one rule: a run may claim 'submitted' only if the
  // request really is with Anthropic. So:
  //   a. open the runs (status 'submitted', pointer still null),
  //   b. build the batch requests with custom_id = each run's id,
  //   c. create the batch,
  //   d. record the batch row,
  //   e. point the runs at it.
  // The ids are generated here rather than read back from the insert so that
  // (b) cannot mis-pair a request with a run: custom_id is the only thing
  // that maps a result back to a student, and batch results come back in any
  // order.
  const runRows = collected.map((c) => {
    const subject = parseGradingSubject(c.studentId);
    return {
      id: randomUUID(),
      test_id: testId,
      student_id: subject.kind === "profile" ? subject.id : null,
      invited_student_id: subject.kind === "invited" ? subject.id : null,
      created_by: user.id,
      status: "submitted",
      model: GRADING_MODEL,
      source_storage_path: c.storagePath,
      // Set in (e), once there is a batch row to point at.
      pending_message_batch_id: null,
    };
  });

  const { error: runsErr } = await supabase.from("ai_grade_runs").insert(runRows);
  if (runsErr) {
    return NextResponse.json(
      { error: `Could not open grading runs: ${runsErr.message}` },
      { status: 500 }
    );
  }
  const runIds = runRows.map((r) => r.id);

  // 5m, not the synchronous route's 1h: inside one batch a cache hit lands
  // within minutes of the write or not at all (see GradingCacheTtl).
  const requests = runRows.map((row, i) => ({
    custom_id: row.id,
    params: buildGradingRequest({
      gradeable,
      testName: test.name,
      studentDisplayName: collected[i].displayName,
      scanBase64: collected[i].scanBase64,
      cacheTtl: "5m",
    }),
  }));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let anthropicBatchId: string;
  try {
    const batch = await anthropic.messages.batches.create({ requests });
    anthropicBatchId = batch.id;
  } catch (e) {
    // Nothing is with Anthropic, so nothing may stay 'submitted': these runs
    // would otherwise sit in the collect route's working set forever, waiting
    // on a batch that does not exist.
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("ai_grade_runs")
      .update({
        status: "failed",
        error: `Batch submit failed: ${message}`,
        completed_at: new Date().toISOString(),
      })
      .in("id", runIds);
    return NextResponse.json(
      { error: `Could not submit the batch to Anthropic: ${message}` },
      { status: 502 }
    );
  }

  // From here the batch is running and billing at Anthropic whatever this
  // route does next. If (d) or (e) fails, the work is not lost but the
  // pointer is: the collect route's sweep is what catches it, failing
  // 'submitted' runs whose pending_message_batch_id has been null for over an
  // hour, so the teacher sees a failure they can re-queue instead of a class
  // that stays "marking overnight" forever. The anthropic batch id goes back
  // in the error either way, because it is the only handle left on that spend.
  const { data: batchRow, error: batchErr } = await supabase
    .from("ai_grade_message_batches")
    .insert({
      anthropic_batch_id: anthropicBatchId,
      test_id: testId,
      created_by: user.id,
      request_count: requests.length,
    })
    .select("id")
    .single();

  if (batchErr || !batchRow) {
    return NextResponse.json(
      {
        error: `Batch ${anthropicBatchId} was submitted but could not be recorded: ${batchErr?.message ?? "unknown error"}`,
        anthropicBatchId,
      },
      { status: 500 }
    );
  }

  const { error: pointerErr } = await supabase
    .from("ai_grade_runs")
    .update({ pending_message_batch_id: batchRow.id })
    .in("id", runIds);

  if (pointerErr) {
    return NextResponse.json(
      {
        error: `Batch ${anthropicBatchId} was submitted but its runs could not be linked to it: ${pointerErr.message}`,
        batchId: batchRow.id,
        anthropicBatchId,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    batchId: batchRow.id,
    anthropicBatchId,
    submitted: runRows.map((row, i) => ({ studentId: collected[i].studentId, runId: row.id })),
    failed,
    remaining,
  });
}
