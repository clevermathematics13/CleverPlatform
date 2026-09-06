/**
 * What a teacher's "view as this student" preview of NA feedback should say
 * when it has nothing to show.
 *
 * The page this serves used to render one line -- "No feedback has been
 * released to you yet." -- for every empty case, including a teacher
 * previewing someone else. That single sentence is second-person copy
 * written for a student reading their own page, and it collapses three
 * completely different situations into one screen:
 *
 *   1. the student's packet was never scanned (no na_packet_scans row),
 *   2. it was scanned but the teacher has not released it yet,
 *   3. something is actually broken.
 *
 * A teacher looking at (1) cannot tell it from (3), which is exactly how a
 * correct page gets reported as a bug. Splitting the copy by the scan states
 * the student actually has ends that guess: the page states the step the
 * packet is really waiting on, so the next action is obvious.
 *
 * Pure on purpose -- the page passes in the statuses it read and renders the
 * string. AGENTS.md wants a test beside any extracted pure function, and this
 * is the piece worth pinning: the mapping from pipeline state to what the
 * teacher is told.
 */

/** na_packet_scans.status values, in pipeline order. 'released' is the only
 *  one the student-facing read treats as visible. */
export const NA_SCAN_STATUS_ORDER = ["pending", "split", "cropped", "assessed", "reviewed", "released"] as const;

/** How far along the scan pipeline a status is, for picking the furthest
 *  state to describe when a student has several scans at once. Unknown
 *  statuses sort first, so they never masquerade as progress. */
export function naScanStatusRank(status: string): number {
  const i = (NA_SCAN_STATUS_ORDER as readonly string[]).indexOf(status);
  return i === -1 ? -1 : i;
}

export interface EmptyFeedbackPreviewInput {
  /** The student being previewed, as the teacher picked them. */
  studentName: string;
  /** Every na_packet_scans.status this student has, in any order. Empty
   *  means no packet of theirs has ever been scanned. */
  scanStatuses: string[];
}

export interface EmptyFeedbackPreviewCopy {
  /** The sentence stating what is true right now. */
  headline: string;
  /** The next step, or what to check. Empty when there is nothing to add. */
  detail: string;
}

/**
 * The empty-state copy for a teacher preview. Never call this for a student
 * reading their own page -- they get the plain "no feedback yet" line, which
 * is the right thing to tell them and gives away nothing about where in the
 * marking pipeline their teacher currently is.
 */
export function describeEmptyFeedbackPreview(input: EmptyFeedbackPreviewInput): EmptyFeedbackPreviewCopy {
  const name = input.studentName.trim() || "This student";
  const statuses = input.scanStatuses.filter((s) => typeof s === "string" && s.length > 0);

  if (statuses.length === 0) {
    return {
      headline: `No packet scan has been matched to ${name} yet.`,
      detail:
        `Nothing has been uploaded and split to ${name}, so there is no work to mark and nothing to release. ` +
        `Upload the batch containing their packet in Results by class, or check that their pages were assigned ` +
        `to them at the split step.`,
    };
  }

  // Several scans can sit at different stages at once (a re-upload, or two
  // packets). Describe the furthest one along: it is the one closest to
  // being released, so it is the one whose next step matters.
  const furthest = statuses.reduce((best, s) => (naScanStatusRank(s) > naScanStatusRank(best) ? s : best), statuses[0]);
  const count = statuses.length;

  // Only speak for every scan when every scan really is at this stage.
  // Saying "Evelyn's 2 packet scans have been split into answers" when one
  // of them is still un-cropped is exactly the kind of confident-but-wrong
  // sentence this whole module exists to stop, so a mixed set names the one
  // scan being described and leaves the rest to the trailing note below.
  const allSame = statuses.every((s) => s === furthest);
  const plural = count > 1 && allSame;
  const subject = plural
    ? `${name}'s ${count} packet scans`
    : count === 1
      ? `${name}'s packet scan`
      : `The furthest along of ${name}'s ${count} packet scans`;
  const verb = plural ? "have" : "has";
  const isVerb = plural ? "are" : "is";
  const them = plural ? "them" : "it";
  const packetWord = plural ? "packets" : "packet";
  const behind = count - 1;
  const othersNote = allSame
    ? ""
    : ` The other ${behind === 1 ? "one is" : `${behind} are`} further back in the pipeline.`;

  switch (furthest) {
    case "released":
      // Reachable only if the release left no student-visible rows behind,
      // which the release route refuses to do. Say so plainly rather than
      // implying the marking is unfinished.
      return {
        headline: `${subject} ${isVerb} marked released, but no released feedback came back for ${them}.`,
        detail:
          `That combination should not happen -- releasing writes the student-visible rows and the released ` +
          `status together. Re-open this ${packetWord} in Results by class and release it again.` +
          othersNote,
      };
    case "reviewed":
    case "assessed":
      return {
        headline: `${subject} ${verb} been marked but not released yet.`,
        detail:
          `${name} sees nothing until you release it. Approve every question in Results by class, then release ` +
          `the ${packetWord} -- this page fills in the moment you do.` +
          othersNote,
      };
    case "cropped":
      return {
        headline: `${subject} ${verb} been split into answers but not marked yet.`,
        detail:
          `Run the marking pass in Results by class, approve the questions, then release the ${packetWord}.` +
          othersNote,
      };
    case "split":
    case "pending":
      return {
        headline: `${subject} ${verb} been uploaded but not processed yet.`,
        detail:
          `The answers still need to be cropped out and marked before the ${packetWord} can be released. ` +
          `Carry on in Results by class.` +
          othersNote,
      };
    default:
      return {
        headline: `${subject} ${isVerb} not ready to release yet.`,
        detail: `Its state is "${furthest}". Continue with the ${packetWord} in Results by class.` + othersNote,
      };
  }
}
