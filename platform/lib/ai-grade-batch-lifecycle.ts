/**
 * When an open Anthropic Message Batch may be given up on, and when its
 * results must still be collected.
 *
 * This lives here, pure and tested, because getting it wrong is silent and
 * expensive. Until 14 Sep 2026 the collect route failed every batch more than
 * 30 hours old BEFORE asking Anthropic anything: a class submitted for
 * overnight marking and opened a day and a half later was stamped "never
 * returned results -- re-submit this student" while Anthropic still held the
 * finished results in full, and re-submitting paid for the same marking
 * twice. Nothing in the UI said the marks had been thrown away rather than
 * lost, so the only symptom was a class that had to be marked again.
 *
 * The rule that replaces it: age alone never ends a batch that has FINISHED.
 * A finished batch stays collectable for as long as Anthropic serves it,
 * because the AI grade page is the only collector there is (no worker, no
 * cron -- see the collect route) and so the window for opening that page has
 * to be Anthropic's retention window, not a shorter one invented here.
 *
 * Every give-up below is therefore something Anthropic itself reports:
 * results archived, batch gone, or still unprocessed long past the 24h
 * ceiling Anthropic guarantees.
 */

/**
 * How long a batch may sit UNFINISHED at Anthropic before it is declared
 * stuck. Anthropic's own ceiling for processing a batch is 24h (its
 * `expires_at` is set 24h after creation), so one still not 'ended' past 30
 * is never going to end.
 *
 * This bounds PROCESSING only. It says nothing about how long a finished
 * batch stays collectable.
 */
export const STUCK_PROCESSING_MS = 30 * 60 * 60 * 1000;

/**
 * How long Anthropic keeps a batch's results. Past this they are gone
 * whatever any status says, so runs still waiting on the batch can never be
 * answered and are failed rather than polled for ever.
 *
 * A backstop only: results that have already gone are normally reported
 * directly, by `archived_at` or by a 404 from retrieve, well before this.
 */
export const RESULTS_RETENTION_MS = 29 * 24 * 60 * 60 * 1000;

/** What the teacher is told, and why. Shared so the messages cannot drift. */
export const GIVE_UP_MESSAGES = {
  pastRetention:
    "Overnight results are past the 29 days Anthropic keeps them for and can no longer be read. Re-submit this student.",
  notFound:
    "Overnight results are no longer available from Anthropic (a batch and its results are kept for 29 days). Re-submit this student.",
  archived:
    "Overnight results have been archived by Anthropic and can no longer be read. Re-submit this student.",
  stuck:
    "Overnight batch never finished processing at Anthropic (still unfinished 30 hours after it was sent). Re-submit this student.",
} as const;

/** What a retrieve told us about the batch. */
export type BatchProbe =
  /** The retrieve itself failed. `notFound` distinguishes a 404 from a blip. */
  | { retrieved: false; notFound: boolean }
  | { retrieved: true; archivedAt: string | null; processingStatus: string };

export type BatchDisposition =
  /** Finished and readable: stream the results and write them. */
  | { kind: "collect" }
  /** Still processing inside its window: leave it open, ask again later. */
  | { kind: "wait" }
  /** Nothing could be learned this time. Leave it open, ask again later. */
  | { kind: "retry" }
  /** Anthropic can never answer for this batch. Fail the runs waiting on it. */
  | { kind: "give-up"; message: string };

/**
 * Decide what to do with one open batch.
 *
 * `ageMs` is measured from when the batch was submitted. It is used for
 * exactly two things -- the retention backstop and the stuck-processing
 * check -- and for neither of them can it end a batch that has finished
 * within retention. That is the property the test file pins.
 */
export function batchDisposition(ageMs: number, probe: BatchProbe): BatchDisposition {
  // First, because past this nothing else is worth acting on: whatever the
  // batch says about itself, its results are no longer there to be read.
  if (ageMs > RESULTS_RETENTION_MS) {
    return { kind: "give-up", message: GIVE_UP_MESSAGES.pastRetention };
  }

  if (!probe.retrieved) {
    // A batch Anthropic no longer knows about is the one retrieve failure
    // that is terminal. Every other one -- a blip, a 429, a 500 -- must not
    // fail a batch whose results are still sitting there.
    return probe.notFound
      ? { kind: "give-up", message: GIVE_UP_MESSAGES.notFound }
      : { kind: "retry" };
  }

  // The batch object outlives its results; archived_at is Anthropic saying
  // the results themselves have gone. Streaming would fail every call from
  // here on, so there is no point keeping it open.
  if (probe.archivedAt) {
    return { kind: "give-up", message: GIVE_UP_MESSAGES.archived };
  }

  if (probe.processingStatus !== "ended") {
    return ageMs > STUCK_PROCESSING_MS
      ? { kind: "give-up", message: GIVE_UP_MESSAGES.stuck }
      : { kind: "wait" };
  }

  // Ended, not archived, inside retention: collectable, however old it is.
  return { kind: "collect" };
}
