import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  SCAN_BUCKET,
  formatGradingSubject,
  parseGradingSubject,
  validateGradeResponse,
} from "@/lib/ai-grading";
import { loadGradeableMarkScheme, persistGradeOutcome } from "@/lib/ai-grading-run";
import { fetchAllRows } from "@/lib/na-scanning";

export const maxDuration = 300;

/**
 * How many batch results one call may write.
 *
 * Writing one is not cheap: it re-downloads that student's PDF from Storage
 * and calls the Railway CV service for the evidence crops, which is the same
 * 10-30s of work the synchronous route spends after its model call. A whole
 * class therefore cannot be collected inside maxDuration, so a call takes a
 * bite and answers more: true, and the AI grade page calls again.
 *
 * The arithmetic: 5 x 30s at the slow end of that range is 150s, half the
 * 300s budget, leaving the rest for the batch retrieve, the results stream
 * and a CV service having a bad day. Eight was 240s and left nothing -- one
 * slow crop call over and the call is killed at 300s with a run claimed
 * 'running' mid-write. The batch's remaining lines are untouched either way:
 * Anthropic keeps results for 29 days and the next call re-streams them.
 */
export const MAX_RESULTS_PER_CALL = 5;

/**
 * A run left 'submitted' with no batch pointer for this long never made it
 * into a batch: the submit route created the Anthropic batch and then failed
 * before recording which one, so no collect call can ever find its result.
 * An hour is far longer than that write window and well short of the point
 * where a teacher would re-submit.
 */
const LOST_SUBMISSION_MS = 60 * 60 * 1000;

/**
 * Anthropic's hard ceiling for a batch is 24h. Past 30 nothing more is
 * coming, and the runs waiting on it would otherwise sit 'submitted' forever
 * -- the teacher needs them failed so they can re-mark.
 */
const ABANDONED_BATCH_MS = 30 * 60 * 60 * 1000;

/** The open ai_grade_message_batches columns this route works from. */
interface OpenBatchRow {
  id: string;
  anthropic_batch_id: string;
  status: string;
  submitted_at: string;
}

/** A run this batch still owes a result for. */
interface PendingRunRow {
  id: string;
  status: string;
  student_id: string | null;
  invited_student_id: string | null;
  source_storage_path: string | null;
}

type MarkScheme = Awaited<ReturnType<typeof loadGradeableMarkScheme>>;

/**
 * POST /api/tests/[id]/ai-grade/collect
 * Body: {} -- everything needed is the test id in the path.
 *
 * The collecting half of overnight marking (the submit half posts the whole
 * class to the Message Batches API in the request the teacher's click makes).
 * There is deliberately no worker and no cron behind this: the Railway worker
 * is not running and its account is nearly out of credit, so the AI grade page
 * calls this route on load and while any batch is still open, plus a "Check
 * for results" button. Anthropic keeps a batch's results for 29 days, so a
 * class nobody comes back to for a week is still collected in full.
 *
 * Everything after a result validates is persistGradeOutcome (see
 * lib/ai-grading-run.ts), the same call the synchronous route makes, so an
 * overnight-marked student's rows -- crops, acceptance carry-forward,
 * coverage -- are indistinguishable from a browser-marked one's.
 *
 * Answers { checked, completed, failed, pending, more }, where pending is
 * null when the outstanding count could not be read.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { id: testId } = await params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
      { status: 500 }
    );
  }

  let checked = 0;
  let completed = 0;
  let failed = 0;
  let processed = 0;
  let budgetSpent = false;

  /**
   * Terminal-fail one run. The status filter is the concurrency guard: two
   * tabs collecting at once both reach the same line, and only the update
   * that still sees the expected status counts.
   */
  const failRun = async (runId: string, message: string, fromStatus: "submitted" | "running") => {
    const { data } = await supabase
      .from("ai_grade_runs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
        pending_message_batch_id: null,
      })
      .eq("id", runId)
      .eq("status", fromStatus)
      .select("id");
    if (data && data.length > 0) failed++;
  };

  /** Idempotent: the .neq keeps a re-collect from re-stamping results_written_at. */
  const markResultsWritten = async (batchRowId: string) => {
    await supabase
      .from("ai_grade_message_batches")
      .update({ status: "results_written", results_written_at: new Date().toISOString() })
      .eq("id", batchRowId)
      .neq("status", "results_written");
  };

  const { data: rawOpen, error: openErr } = await supabase
    .from("ai_grade_message_batches")
    .select("id, anthropic_batch_id, status, submitted_at")
    .eq("test_id", testId)
    .in("status", ["submitted", "in_progress", "ended"])
    .order("submitted_at", { ascending: true });
  if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });
  const openBatches = (rawOpen ?? []) as OpenBatchRow[];

  // -- Stale sweep -------------------------------------------------------------
  // Runs that no batch can answer for, cleared before anything is retrieved so
  // a teacher sees a failure they can act on rather than a student stuck on
  // "submitted" behind a batch that will never arrive.
  const now = Date.now();

  /**
   * How many run ids one .in() filter may carry.
   *
   * PostgREST takes the list in the query string, so a few hundred UUIDs (36
   * characters each, plus quoting and separators) is a >16KB URL and the
   * gateway answers 414. That throw would abort the whole sweep, and this
   * test's stale runs would then never settle on ANY call -- the sweep is the
   * only thing that settles them. A whole class is ~60 runs, so 100 per
   * request still keeps every realistic sweep to a single round trip.
   */
  const ID_CHUNK = 100;
  const idChunks = (ids: string[]): string[][] => {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
    return chunks;
  };

  /**
   * The test's mark scheme, assembled at most once per call and only when
   * something actually asks for it -- this route runs on every AI grade page
   * load, and the assembly is several queries plus the policy file read.
   *
   * It is a memo up here rather than a lazy load inside the batch loop
   * because there are two callers now: the sweeps below need it to rebuild a
   * promoted run's coverage, and they run before any batch is retrieved.
   * Reports a failure instead of throwing, because only one of the two
   * callers treats an unassemblable mark scheme as fatal -- validating a
   * result against an empty unit list would throw a paid-for batch away, but
   * a sweep can still settle a run without it (see coverageFor).
   */
  let scheme: MarkScheme | null = null;
  let schemeError: string | null = null;
  let schemeLoaded = false;
  const ensureScheme = async (): Promise<MarkScheme | null> => {
    if (schemeLoaded) return scheme;
    schemeLoaded = true;
    try {
      scheme = await loadGradeableMarkScheme(supabase, testId);
    } catch (e) {
      schemeError = e instanceof Error ? e.message : "mark scheme assembly failed";
    }
    return scheme;
  };

  /** One run's result rows, reduced to what a rebuilt coverage can use. */
  interface ResultRow {
    run_id: string;
    suggested_marks: number;
    max_marks: number;
  }
  interface RunTotals {
    suggestedTotal: number;
    rowMaxTotal: number;
    partsGraded: number;
  }

  const tallyByRun = (rows: ResultRow[]) => {
    const totals = new Map<string, RunTotals>();
    for (const r of rows) {
      const t = totals.get(r.run_id) ?? { suggestedTotal: 0, rowMaxTotal: 0, partsGraded: 0 };
      t.suggestedTotal += r.suggested_marks;
      t.rowMaxTotal += r.max_marks;
      t.partsGraded += 1;
      totals.set(r.run_id, t);
    }
    return totals;
  };

  /**
   * The coverage a promoted run carries, rebuilt from what survived.
   *
   * suggestedTotal and partsGraded can only come from the rows -- they are
   * what this student was actually awarded. maxTotal must NOT:
   * persistGradeOutcome sums it over every GRADEABLE UNIT, not over the rows
   * that happen to exist, so a model that skipped three parts would be summed
   * here into a roster reading 12/12 where the truth is 12/20 -- a mark that
   * is silently wrong in the direction that flatters the student. The mark
   * scheme is the same one the lost update would have used, so it decides
   * both totals whenever it could be assembled; the row-derived total is kept
   * only as the fallback, since a slightly optimistic total still beats
   * refusing to settle a run that is done at all.
   *
   * The warning is the other half of the truth: this summary is a
   * reconstruction, and the per-part review flags (needsReview) belonged to
   * the update that was lost and cannot be recovered from the rows.
   */
  const coverageFor = (t: RunTotals, markScheme: MarkScheme | null) => ({
    suggestedTotal: t.suggestedTotal,
    partsGraded: t.partsGraded,
    // The scheme's total is the honest denominator when it is there, because
    // the rows only cover the parts the model actually answered. But an empty
    // gradeable set would make it 0 and render a real score as "12/0": if the
    // mark scheme has been edited away since the submit, the rows are the
    // better of two imperfect answers.
    maxTotal:
      markScheme && markScheme.gradeable.length > 0
        ? markScheme.gradeable.reduce((s, u) => s + u.maxMarks, 0)
        : t.rowMaxTotal,
    ...(markScheme
      ? { testTotalMarks: markScheme.units.reduce((s, u) => s + u.maxMarks, 0) }
      : {}),
    warnings: [
      "This summary was reconstructed after the marking write was interrupted: the per-part marks below are the model's own, but the original per-part review flags were lost, so nothing here is flagged for review. Check each part before accepting.",
    ],
  });

  /**
   * Settle one sweep's candidate runs: fail them, EXCEPT any run that already
   * has ai_grade_results rows, which is promoted to 'complete' instead.
   *
   * persistGradeOutcome inserts the results and marks the run complete in two
   * separate writes (see lib/ai-grading-run.ts), so a collect call killed
   * between them -- the 300s budget, a deploy, a closed laptop -- leaves a
   * fully and correctly marked student sitting 'running'. Failing that run
   * shows the teacher a failure over marking that is done and already paid
   * for, so the presence of result rows, not the run's status, decides.
   *
   * One paged query for the whole candidate set rather than one per run: a
   * sweep can carry a whole class, and a class's result rows run well past
   * PostgREST's 1000-row cap (60 runs x ~39 parts), which a single unpaged
   * .in() would silently truncate -- and every run past the cap would then
   * look unmarked and be failed.
   */
  const settleSweptRuns = async (candidateIds: string[], message: string) => {
    if (candidateIds.length === 0) return;

    /** Every result row these runs hold: chunked over the ids, paged within. */
    const readResults = async (ids: string[]) => {
      const rows: ResultRow[] = [];
      for (const chunk of idChunks(ids)) {
        rows.push(
          ...(await fetchAllRows<ResultRow>((from, to) =>
            supabase
              .from("ai_grade_results")
              .select("run_id, suggested_marks, max_marks")
              .in("run_id", chunk)
              .order("id", { ascending: true })
              .range(from, to)
          ))
        );
      }
      return rows;
    };

    /** Promote one run, with the totals rebuilt from its own rows. */
    const promoteRun = async (id: string, t: RunTotals, fromStatus: string[]) => {
      const markScheme = await ensureScheme();
      const { data: promoted } = await supabase
        .from("ai_grade_runs")
        .update({
          status: "complete",
          completed_at: new Date().toISOString(),
          pending_message_batch_id: null,
          // A complete run carries no failure text: this path exists to undo
          // one, and a stale message beside a real score reads as a mark the
          // teacher cannot trust.
          error: null,
          coverage: coverageFor(t, markScheme),
        })
        .eq("id", id)
        .in("status", fromStatus)
        .select("id");
      return (promoted?.length ?? 0) > 0;
    };

    let marked: ResultRow[];
    try {
      marked = await readResults(candidateIds);
    } catch (e) {
      // Which runs hold rows is now unknown, so settle none of them. The next
      // call sweeps again in 30s; a run left pending is recoverable, one
      // wrongly stamped 'failed' over real marks is not.
      console.error("[ai-grade collect] sweep could not read existing results:", e);
      return;
    }
    const totals = tallyByRun(marked);
    const hasResults = new Set(marked.map((r) => r.run_id));

    const promote = candidateIds.filter((id) => hasResults.has(id));
    // One update per run rather than one for the set: each carries its own
    // totals. The list is short by construction -- these are only runs whose
    // completion was lost.
    for (const id of promote) {
      const t = totals.get(id);
      if (t && (await promoteRun(id, t, ["submitted", "running"]))) completed++;
    }

    const kill = candidateIds.filter((id) => !hasResults.has(id));
    const killedIds: string[] = [];
    for (const chunk of idChunks(kill)) {
      // The status filter is the same concurrency guard failRun uses: a run
      // another tab settled between the select and this update is left alone.
      const { data: killed } = await supabase
        .from("ai_grade_runs")
        .update({
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
          pending_message_batch_id: null,
        })
        .in("id", chunk)
        .in("status", ["submitted", "running"])
        .select("id");
      for (const r of (killed ?? []) as { id: string }[]) killedIds.push(r.id);
    }
    failed += killedIds.length;

    // -- Read-after-write over exactly the runs this sweep just failed --------
    // hasResults is a snapshot, and persistGradeOutcome inserts a whole run's
    // rows in one write that can land between that read and the update above.
    // The run has then just been stamped 'failed' over real, paid-for marking
    // AND is out of reach for good: every promote path selects 'submitted' or
    // 'running', so no later call will ever look at it again. So ask once
    // more, for the ids the update actually changed, and promote any that now
    // hold rows. A deliberate extra round trip on a path that is already
    // exceptional, because the alternative is a mark nothing can recover.
    if (killedIds.length === 0) return;
    let late: ResultRow[];
    try {
      late = await readResults(killedIds);
    } catch (e) {
      console.error("[ai-grade collect] sweep could not re-check the runs it failed:", e);
      return;
    }
    for (const [id, t] of tallyByRun(late)) {
      // 'failed' is the status this sweep wrote a moment ago; anything else
      // means another call has since settled the run and owns it.
      if (await promoteRun(id, t, ["failed"])) {
        failed--;
        completed++;
      }
    }
  };

  const { data: lostSubmissions } = await supabase
    .from("ai_grade_runs")
    .select("id")
    .eq("test_id", testId)
    .eq("status", "submitted")
    .is("pending_message_batch_id", null)
    .lt("created_at", new Date(now - LOST_SUBMISSION_MS).toISOString());
  await settleSweptRuns(
    ((lostSubmissions ?? []) as { id: string }[]).map((r) => r.id),
    "Overnight submission did not complete: this run was never recorded against a batch. Re-submit this student."
  );

  const live: OpenBatchRow[] = [];
  for (const row of openBatches) {
    if (now - new Date(row.submitted_at).getTime() <= ABANDONED_BATCH_MS) {
      live.push(row);
      continue;
    }
    const message = "Overnight batch never returned results (open for more than 30 hours). Re-submit this student.";
    // 'running' as well as 'submitted': a collect call that died mid-write
    // left its claim behind, and nothing else ever picks that run back up.
    const { data: abandonedRuns, error: abandonedErr } = await supabase
      .from("ai_grade_runs")
      .select("id")
      .eq("pending_message_batch_id", row.id)
      .in("status", ["submitted", "running"]);
    if (abandonedErr) {
      // A failed select reads as data null, which is indistinguishable from
      // "this batch owes nothing" -- and failing the batch on that would
      // orphan every run still pointing at it: the pointer stays, the batch
      // leaves the open working set, and nothing re-streams the results.
      // The batch is 30 hours old and going nowhere, so the next call can
      // sweep it just as well.
      console.error(
        `[ai-grade collect] could not read abandoned runs for ${row.anthropic_batch_id}:`,
        abandonedErr.message
      );
      continue;
    }
    await settleSweptRuns(((abandonedRuns ?? []) as { id: string }[]).map((r) => r.id), message);
    await supabase
      .from("ai_grade_message_batches")
      .update({ status: "failed", error_message: message })
      .eq("id", row.id);
  }

  // -- Lost-write backstop -----------------------------------------------------
  // Not an expected path. Every settled run nulls its pointer, so a run still
  // pointing at a batch this route has already closed out (results_written or
  // failed) means one of those writes was lost -- failRun, markResultsWritten
  // and persistGradeOutcome's run update all discard their error, so one
  // failed failRun followed by a successful markResultsWritten produces
  // exactly this. Neither sweep above can see it: it has a pointer, so it is
  // not a lost submission, and its batch is out of the open working set, so
  // nothing iterates it -- and the page polls every 30s forever for a student
  // that will never arrive.
  //
  // What keeps this off a write that is still in flight is NOT the age guard:
  // it is on created_at, which for an overnight run is already hours old by
  // the time any call claims it. It is that a live claim keeps
  // pending_message_batch_id non-null, and the re-count before
  // markResultsWritten refuses to close a batch any run still points at -- so
  // a run being written right now is never behind a CLOSED batch, which is
  // the only set this backstop looks at. The age guard is a second line only.
  // Anything that changes how the pointer is held or when a batch is closed
  // has to keep that property, or this becomes an unguarded race.
  const { data: closedBatches, error: closedErr } = await supabase
    .from("ai_grade_message_batches")
    .select("id")
    .eq("test_id", testId)
    .not("status", "in", '("submitted","in_progress","ended")');
  if (closedErr) {
    console.error("[ai-grade collect] could not list closed batches:", closedErr.message);
  }
  const closedBatchIds = ((closedBatches ?? []) as { id: string }[]).map((b) => b.id);
  if (closedBatchIds.length > 0) {
    // Chunked and error-checked for the same reason as every other id list
    // here: a term's worth of batch rows past ~100 ids builds a URL long
    // enough to 414, and this backstop failing quietly is worse than most --
    // it is the last thing standing between a lost write and a run nothing
    // ever settles.
    const stranded: string[] = [];
    let strandedReadFailed = false;
    for (const chunk of idChunks(closedBatchIds)) {
      const { data, error } = await supabase
        .from("ai_grade_runs")
        .select("id")
        .eq("test_id", testId)
        .in("status", ["submitted", "running"])
        .in("pending_message_batch_id", chunk)
        .lt("created_at", new Date(now - LOST_SUBMISSION_MS).toISOString());
      if (error) {
        console.error("[ai-grade collect] stranded-run read failed:", error.message);
        strandedReadFailed = true;
        break;
      }
      stranded.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
    }
    if (!strandedReadFailed) {
      await settleSweptRuns(
        stranded,
        "Overnight batch was closed without a result for this student. Re-submit this student."
      );
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  for (const row of live) {
    checked++;

    let batch: Anthropic.Messages.Batches.MessageBatch;
    try {
      batch = await anthropic.messages.batches.retrieve(row.anthropic_batch_id);
    } catch {
      // Transient: an Anthropic blip must not fail a batch whose results are
      // still sitting there. The next call retrieves it again.
      continue;
    }

    if (batch.processing_status !== "ended") {
      if (row.status !== "in_progress") {
        await supabase
          .from("ai_grade_message_batches")
          .update({ status: "in_progress" })
          .eq("id", row.id);
      }
      continue;
    }

    if (row.status !== "ended") {
      await supabase
        .from("ai_grade_message_batches")
        .update({ status: "ended", ended_at: batch.ended_at ?? new Date().toISOString() })
        .eq("id", row.id);
    }

    // Which runs this batch still owes an answer for. A run whose result has
    // been written has a null pointer and so is absent here, which is what
    // makes re-streaming a partly collected batch cheap: its already-written
    // lines are skipped without a query, a download or a crop.
    const { data: rawPending, error: pendingErr } = await supabase
      .from("ai_grade_runs")
      .select("id, status, student_id, invited_student_id, source_storage_path")
      .eq("pending_message_batch_id", row.id);
    if (pendingErr) {
      // supabase-js reports a failed select as data null, which is
      // indistinguishable here from "this batch owes nothing" -- and that is
      // the branch that closes the batch permanently. A whole class would
      // then be waiting behind a batch nothing re-streams, and the stranded
      // backstop would fail every one of those runs an hour later, throwing
      // away marking Anthropic would still have served for 29 days. Settle
      // and close nothing; the next call reads the same rows in 30s.
      console.error(
        `[ai-grade collect] could not read pending runs for ${row.anthropic_batch_id}:`,
        pendingErr.message
      );
      continue;
    }
    const pendingById = new Map<string, PendingRunRow>(
      ((rawPending ?? []) as PendingRunRow[]).map((r) => [r.id, r])
    );

    if (pendingById.size === 0) {
      await markResultsWritten(row.id);
      continue;
    }

    // A mark scheme that cannot be assembled is the one failure that must
    // not touch the runs: every result would fail validation against an
    // empty unit list, and a batch Anthropic has already been paid for
    // would be thrown away over a PPQ bank edit the teacher can undo. Unlike
    // the sweeps, which can still settle a run without it, this path has
    // nothing to validate against -- so the memo's failure is fatal here.
    const markScheme = await ensureScheme();
    if (!markScheme) {
      return NextResponse.json(
        {
          error: `Overnight results cannot be validated: ${schemeError ?? "mark scheme assembly failed"}`,
        },
        { status: 500 }
      );
    }
    if (markScheme.gradeable.length === 0) {
      return NextResponse.json(
        {
          error:
            "No mark scheme text is stored for any part of this assessment, so the overnight results cannot be validated. Extract the mark scheme LaTeX in the PPQ Bank, then check for results again.",
          warnings: markScheme.assemblyWarnings,
        },
        { status: 422 }
      );
    }

    /** One result line, for a run this call has claimed. */
    const collectLine = async (
      line: Anthropic.Messages.Batches.MessageBatchIndividualResponse,
      run: PendingRunRow
    ) => {
      if (line.result.type !== "succeeded") {
        const reason =
          line.result.type === "errored" ? line.result.error.error.message : line.result.type;
        await failRun(run.id, `Batch request ${line.result.type}: ${reason}`, "running");
        return;
      }

      const message = line.result.message;
      // Recorded before anything can go wrong downstream: the tokens were
      // spent and billed (at the batch rate) whatever the response says.
      await recordUsage(supabase, {
        pipeline: "ai_grade_batch",
        model: message.model,
        usage: message.usage,
        batch: true,
        ref: { type: "ai_grade_run", id: run.id },
      });

      if (message.stop_reason === "max_tokens") {
        await failRun(run.id, "Model response was cut off at max_tokens", "running");
        return;
      }

      // parsed_output is the SDK's client-side parse of the structured
      // output, which the batch results decoder does not run -- so it is
      // normally absent here and the same JSON comes off the text block.
      // Read it when it is there, since it is the cheaper path.
      const parsed = (message as Anthropic.Message & { parsed_output?: unknown }).parsed_output;
      const responseText =
        parsed != null
          ? JSON.stringify(parsed)
          : message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");

      if (!responseText.trim()) {
        await failRun(run.id, "Model returned an empty response", "running");
        return;
      }

      const validation = validateGradeResponse(responseText, markScheme.gradeable);
      if (!validation.ok) {
        // No retry here, unlike the synchronous route: a second attempt would
        // mean a second batch and another night's wait, and the teacher can
        // re-mark this one student in the browser now.
        await failRun(run.id, validation.error, "running");
        return;
      }

      const studentId = formatGradingSubject(run);
      if (!studentId) {
        await failRun(run.id, "Run has neither a student nor an invited student", "running");
        return;
      }

      // The scan is only needed for the evidence crops, so a scan that can no
      // longer be read costs the crops, not the marks -- failing the run
      // would throw away a graded result Anthropic has already been paid for.
      // The reason travels to the teacher in coverage.warnings.
      let scanBase64 = "";
      const warnings = [...validation.outcome.warnings];
      if (run.source_storage_path) {
        const { data: file, error: dlErr } = await supabase.storage
          .from(SCAN_BUCKET)
          .download(run.source_storage_path);
        if (file) scanBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
        else
          warnings.push(
            `Evidence crops unavailable: the stored scan could not be re-read (${dlErr?.message ?? "not found"})`
          );
      } else {
        warnings.push("Evidence crops unavailable: this run has no stored scan.");
      }

      const persisted = await persistGradeOutcome({
        supabase,
        testId,
        studentId,
        subject: parseGradingSubject(studentId),
        runId: run.id,
        scanBase64,
        units: markScheme.units,
        gradeable: markScheme.gradeable,
        assemblyWarnings: markScheme.assemblyWarnings,
        grades: validation.outcome.grades,
        warnings,
      });
      if (!persisted.ok) {
        await failRun(run.id, persisted.error, "running");
        return;
      }
      if (!persisted.completionRecorded) {
        // Marks are saved but the run's own status update was lost. Leave
        // the row and its pointer untouched: the sweep above promotes a run
        // holding result rows, and that is a far better outcome than either
        // failing it or clearing the one pointer that leads back to it.
        return;
      }

      completed++;
      // persistGradeOutcome writes the run 'complete'; the pointer is this
      // route's own bookkeeping, and clearing it is what tells the next call
      // this run is settled.
      await supabase
        .from("ai_grade_runs")
        .update({ pending_message_batch_id: null })
        .eq("id", run.id);
    };

    let truncated = false;
    let streamFailed = false;
    let linesSeen = 0;
    try {
      const results = await anthropic.messages.batches.results(row.anthropic_batch_id);
      for await (const line of results) {
        linesSeen++;
        const run = pendingById.get(line.custom_id);
        if (!run || run.status !== "submitted") continue;

        // Claim the run before spending anything on it. The conditional
        // update IS the lock: several tabs stream the same results at once,
        // and only the one whose update still saw 'submitted' writes this
        // student -- without it two tabs insert two sets of result rows for
        // the same run. A claim left 'running' by a call that died is swept
        // at ABANDONED_BATCH_MS.
        const { data: claimed } = await supabase
          .from("ai_grade_runs")
          .update({ status: "running" })
          .eq("id", run.id)
          .eq("status", "submitted")
          .select("id");
        if (!claimed || claimed.length === 0) continue;

        processed++;
        await collectLine(line, run);

        if (processed >= MAX_RESULTS_PER_CALL) {
          truncated = true;
          break;
        }
      }
    } catch (e) {
      // Transient, exactly like a failed retrieve: whatever was written before
      // the stream died stands, the rest still has 28 days of retention, and
      // the batch stays 'ended' so the next call re-reads it. A stream that
      // fails permanently is caught by the 30-hour sweep instead.
      console.error(`[ai-grade collect] results stream failed for ${row.anthropic_batch_id}:`, e);
      streamFailed = true;
    }

    if (truncated) {
      budgetSpent = true;
      break;
    }

    // A results stream can also end early WITHOUT throwing -- a truncated
    // body, a proxy closing the connection part-way through the file -- and
    // from inside the loop that is indistinguishable from a complete one.
    // Anthropic states how many lines the file holds, so compare against it
    // before closing anything out: every unseen line belongs to a run the
    // close-out below would stamp "no result returned", throwing away marking
    // that has been paid for and that Anthropic will still serve for 29 days.
    // Treated exactly like a thrown stream: nothing is settled, the batch
    // stays open, the next call re-streams it.
    const expectedLines =
      batch.request_counts.succeeded +
      batch.request_counts.errored +
      batch.request_counts.canceled +
      batch.request_counts.expired;
    if (streamFailed || linesSeen < expectedLines) {
      if (!streamFailed) {
        console.error(
          `[ai-grade collect] results stream for ${row.anthropic_batch_id} ended after ${linesSeen} of ${expectedLines} lines; leaving the batch open`
        );
      }
      continue;
    }

    // -- Close the batch out ---------------------------------------------------
    const { data: leftovers } = await supabase
      .from("ai_grade_runs")
      .select("id, status, created_at")
      .eq("pending_message_batch_id", row.id);

    // A leftover still 'running' is a claim whose completion never landed:
    // persistGradeOutcome's completionRecorded-false path (rows written, run
    // update lost) or a throw inside collectLine. Until now nothing rescued
    // it before the 30-hour abandoned-batch sweep, which is most of two days
    // of a fully marked student showing as mid-marking. Settle it on the same
    // hour bound the other sweeps use, through the same path: settleSweptRuns
    // promotes a run holding ai_grade_results rows and only fails one holding
    // none.
    //
    // No collect call can hold a claim for more than maxDuration (300s), so
    // an hour is far longer than any write can still be in flight -- but the
    // hour here is measured from created_at, which for an overnight run is
    // already hours old by the time any call claims it, so that bound alone
    // does not prove the claim is dead (same caveat as the backstop above).
    // What makes settling safe anyway is where settleSweptRuns decides from:
    // the presence of result rows, re-checked after its kill, and
    // persistGradeOutcome's own completion update carries no status filter,
    // so a concurrent write that is still alive still lands on 'complete'.
    const stalledClaims: string[] = [];
    for (const left of (leftovers ?? []) as { id: string; status: string; created_at: string }[]) {
      if (left.status === "submitted") {
        // The stream held no line for this run's custom_id at all.
        await failRun(left.id, "Overnight batch returned no result for this student", "submitted");
      } else if (left.status === "running") {
        if (now - new Date(left.created_at).getTime() > LOST_SUBMISSION_MS) {
          stalledClaims.push(left.id);
        }
      } else {
        // Terminal already: its result was written and only the pointer clear
        // was lost. Nothing is owed for it.
        await supabase
          .from("ai_grade_runs")
          .update({ pending_message_batch_id: null })
          .eq("id", left.id);
      }
    }
    await settleSweptRuns(
      stalledClaims,
      "Overnight marking was interrupted while this student's result was being written, and did not resume. Re-submit this student."
    );

    // Whether anyone is still mid-write on this batch has to be re-read here,
    // not taken from the leftovers snapshot above: the failRun loop between
    // the two is 10s-scale of round trips, and that is long enough for another
    // tab to claim a run this one saw as 'submitted' ('submitted' -> 'running')
    // and start its ~25s of crop and persist work. Closing the batch on the
    // stale snapshot takes it out of the open working set while that write is
    // still in flight, and if the other call then dies its run is left
    // 'running' with a pointer at a batch no sweep iterates. Every settled path
    // nulls the pointer, so a fresh count of zero means nothing is owed.
    const { count: stillOpen, error: stillOpenErr } = await supabase
      .from("ai_grade_runs")
      .select("id", { count: "exact", head: true })
      .eq("pending_message_batch_id", row.id);
    // supabase-js reports a failed count as null, so treating "no rows" and
    // "could not ask" alike would close the batch on a transient error and
    // reopen the very window this re-count exists to shut. Leaving the batch
    // open costs one more pass in 30s; closing it early can strand a run.
    if (!stillOpenErr && (stillOpen ?? 0) === 0) await markResultsWritten(row.id);
  }

  // What the page still has to wait for, across every batch on this test.
  // 'running' is excluded: it is a result being written right now (or the
  // debris of a call that died), not a student still queued at Anthropic.
  const { count: pending, error: pendingCountErr } = await supabase
    .from("ai_grade_runs")
    .select("id", { count: "exact", head: true })
    .eq("test_id", testId)
    .eq("status", "submitted");

  return NextResponse.json({
    checked,
    completed,
    failed,
    // null, never 0, when the count itself failed: supabase-js reports a
    // failed count as null, and answering 0 would tell the page that every
    // student has arrived when this call has no idea whether any has.
    pending: pendingCountErr ? null : pending ?? 0,
    // Results were ready and this call ran out of budget, so the client
    // should call straight back rather than wait for its next poll.
    more: budgetSpent,
  });
}
