import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAllRows,
  missingAnchorCause,
  summariseApprovalProgress,
  transcriptionHasUnreadableGap,
  transcriptionStatesTruncation,
  type ApprovalProgress,
  type ScanApprovalTally,
} from "@/lib/na-scanning";
import { isUngradedAnchor, type AnchorContext } from "@/lib/na-assessment";
import Link from "next/link";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type PacketVersion = {
  id: string;
  version_label: string | null;
  page_count: number | null;
  nuanced_analysis_id: string | null;
  nuanced_analyses: { title: string | null; slug: string | null } | { title: string | null; slug: string | null }[] | null;
};

type CropRow = {
  id: string;
  anchor_id: string;
  packet_scan_id: string | null;
  is_blank: boolean | null;
  possibly_truncated: boolean | null;
  na_feedback:
    | { approved_at: string | null; released_at: string | null }
    | { approved_at: string | null; released_at: string | null }[]
    | null;
};

type FlaggedRow = {
  id: string;
  anchor_id: string;
  na_feedback: { ai_transcription: string | null } | { ai_transcription: string | null }[] | null;
};

/**
 * Per-anchor tallies over that anchor's student crops.
 *
 * gaps and statedCutOff count disjoint populations on purpose: gaps is over
 * crops possibly_truncated already flagged, statedCutOff is over the ones it
 * did not. Neither subsumes the other, so the board reports them separately.
 */
type AnchorProgress = {
  total: number;
  reviewed: number;
  blank: number;
  possiblyTruncated: number;
  /** Flagged crops whose transcription shows an unreadable gap. */
  gaps: number;
  /** Unflagged crops the assessor says outright run past the crop edge. */
  statedCutOff: number;
};

const emptyProgress = (): AnchorProgress => ({
  total: 0,
  reviewed: 0,
  blank: 0,
  possiblyTruncated: 0,
  gaps: 0,
  statedCutOff: 0,
});

type ScanRow = {
  id: string;
  status: string | null;
  split_storage_path: string | null;
  invited_student_id: string | null;
  student_profile_id: string | null;
  invited_students: { full_name: string | null } | { full_name: string | null }[] | null;
};

/**
 * A scan that produced fewer crops than the packet has anchors, and which of
 * the two causes it is -- they need opposite remedies, so the board must not
 * conflate them.
 *
 * "pages": the missing anchors are a trailing run, so the split PDF simply ran
 * out of pages before the packet did and those answers were never captured.
 * Only a rescan recovers them.
 *
 * "crops": the missing anchors sit inside a scan that has pages either side of
 * them, so the page exists and stage 4 failed on that anchor alone. A re-crop
 * recovers it, and the student's work is not lost.
 */
type IncompleteScan = {
  name: string;
  present: number;
  missing: string[];
  /**
   * "crops-no-source" is "crops" whose split PDF was never retained, so there
   * is nothing left to re-cut and the advice for "crops" would be a dead end.
   * A.1's three pilot-ingested scans are in that state: crops were written
   * directly, with no source PDF and no batch segments behind them.
   */
  kind: "pages" | "crops" | "crops-no-source";
};

/**
 * Which packet version the board lands on when no ?packetVersionId is given.
 *
 * Ordering by created_at alone lands it on whichever print master was created
 * most recently -- which, the moment a new NA's packet is generated, is an
 * empty board with nothing to review, while a half-finished review sits one
 * click away on the previous version with no hint that it is there. Prefer the
 * newest version that actually has scanned work, falling back to the newest
 * overall so a freshly printed packet still resolves to something.
 *
 * Newest-first with a short circuit, so the common case (the newest version is
 * the one being marked) costs one existence probe and stops.
 */
async function resolveDefaultVersionId(
  supabase: SupabaseServerClient,
  packetVersions: PacketVersion[]
): Promise<string | null> {
  for (const pv of packetVersions) {
    const { data: anchors } = await supabase
      .from("na_anchors")
      .select("id")
      .eq("packet_version_id", pv.id);
    const anchorIds = (anchors ?? []).map((a: { id: string }) => a.id);
    if (anchorIds.length === 0) continue;

    const { count } = await supabase
      .from("na_response_crops")
      .select("id", { count: "exact", head: true })
      .in("anchor_id", anchorIds);
    if ((count ?? 0) > 0) return pv.id;
  }
  return packetVersions[0]?.id ?? null;
}

export default async function NaReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ packetVersionId?: string }>;
}) {
  await requireTeacher();
  const { packetVersionId } = await searchParams;
  const supabase = await createClient();

  const { data: packetVersions } = await supabase
    .from("na_packet_versions")
    .select("id, version_label, page_count, nuanced_analysis_id, nuanced_analyses(title, slug)")
    .order("created_at", { ascending: false });

  const versions = (packetVersions ?? []) as PacketVersion[];
  const activeVersionId = packetVersionId ?? (await resolveDefaultVersionId(supabase, versions));

  const activePv = versions.find((pv) => pv.id === activeVersionId) ?? null;
  const activeNa = activePv
    ? Array.isArray(activePv.nuanced_analyses)
      ? activePv.nuanced_analyses[0]
      : activePv.nuanced_analyses
    : null;

  let questions: {
    id: string;
    qid: string;
    base_qid: string;
    part_label: string | null;
    marks_available: number | null;
    command_term: string | null;
    sort_order: number;
    /**
     * A box with no marks and no key of any kind -- A.1 and A.2 each carry one,
     * the Desmos "noticings from the sandbox" thinking space. The assessment
     * pipeline already skips these (isUngradedAnchor, used by the worker, the
     * approve-all route and both release routes), so their crops carry a
     * "not marked" note and can never be reviewed. The board is the last
     * consumer that did not know, and counting them as outstanding marking put
     * 44 unreachable responses in A.1's denominator.
     */
    ungraded: boolean;
    progress: AnchorProgress;
  }[] = [];
  let scanStats: { scans: number; students: number; duplicated: number; unidentified: number } | null = null;
  let approvals: ApprovalProgress | null = null;
  let incompleteScans: IncompleteScan[] = [];
  let loadError: string | null = null;

  if (activeVersionId) {
    const { data: anchors } = await supabase
      .from("na_anchors")
      .select(
        "id, qid, base_qid, part_label, marks_available, command_term, sort_order, question_answer, answer_sketch, open_rubric"
      )
      .eq("packet_version_id", activeVersionId)
      .order("sort_order");

    if (anchors && anchors.length > 0) {
      const anchorIds = anchors.map((a) => a.id);

      // PostgREST caps a single request at 1000 rows, and a packet version's
      // crops run well past that (A.1 alone has ~2000). A plain .select() here
      // silently returned an arbitrary, unordered 1000 of them -- so the
      // progress bar read "/1000" as if that were the total, per-anchor totals
      // came out uneven, and the truncation banner below UNDER-reported,
      // because an anchor whose crops fell outside the window looked clean.
      // Page through with the same helper the release/results routes use.
      //
      // .order("id") matters: .range() without an explicit order has no
      // stability guarantee across requests, so paging can duplicate and omit
      // rows -- exactly the bug this is fixing, in a new disguise.
      let crops: CropRow[] = [];
      try {
        crops = await fetchAllRows<CropRow>((from, to) =>
          supabase
            .from("na_response_crops")
            .select(
              "id, anchor_id, packet_scan_id, is_blank, possibly_truncated, na_feedback(approved_at, released_at)"
            )
            .in("anchor_id", anchorIds)
            .order("id", { ascending: true })
            .range(from, to)
        );
      } catch (e) {
        // fetchAllRows throws where the old destructure swallowed the error.
        // Better a visible failure than a confidently wrong denominator.
        loadError = e instanceof Error ? e.message : "Failed to load scanned responses";
      }

      // Hoisted out of the questions map below because the per-scan tally needs
      // it as well: "finished" has to mean every *gradable* crop approved, or
      // the thinking space would keep every scan permanently unfinished.
      const ungradedAnchorIds = new Set(
        anchors
          .filter((a) =>
            isUngradedAnchor({
              qid: a.qid,
              baseQid: a.base_qid ?? a.qid,
              marksAvailable: a.marks_available,
              commandTerm: a.command_term,
              answerSketch: a.answer_sketch,
              openRubric: a.open_rubric,
              misconceptionContext: null,
              questionAnswer: a.question_answer,
            } satisfies AnchorContext)
          )
          .map((a) => a.id)
      );

      const byAnchor = new Map<string, AnchorProgress>();
      for (const a of anchors) byAnchor.set(a.id, emptyProgress());
      const byScan = new Map<string, ScanApprovalTally>();
      for (const crop of crops) {
        const bucket = byAnchor.get(crop.anchor_id);
        if (!bucket) continue;
        bucket.total += 1;
        if (crop.is_blank) bucket.blank += 1;
        if (crop.possibly_truncated) bucket.possiblyTruncated += 1;
        const fb = Array.isArray(crop.na_feedback) ? crop.na_feedback[0] : crop.na_feedback;
        if (fb?.approved_at) bucket.reviewed += 1;

        if (crop.packet_scan_id && !ungradedAnchorIds.has(crop.anchor_id)) {
          const tally = byScan.get(crop.packet_scan_id) ?? { gradable: 0, approved: 0, released: 0 };
          tally.gradable += 1;
          if (fb?.approved_at) tally.approved += 1;
          if (fb?.released_at) tally.released += 1;
          byScan.set(crop.packet_scan_id, tally);
        }
      }
      approvals = summariseApprovalProgress(byScan.values());

      // The transcriptions only matter for crops the flag already caught, so
      // fetch just those rather than dragging ~2000 transcriptions through the
      // main query to read a few hundred of them.
      if (crops.some((c) => c.possibly_truncated)) {
        try {
          const flagged = await fetchAllRows<FlaggedRow>((from, to) =>
            supabase
              .from("na_response_crops")
              .select("id, anchor_id, na_feedback(ai_transcription)")
              .in("anchor_id", anchorIds)
              .eq("possibly_truncated", true)
              .order("id", { ascending: true })
              .range(from, to)
          );
          for (const row of flagged) {
            const fb = Array.isArray(row.na_feedback) ? row.na_feedback[0] : row.na_feedback;
            if (!transcriptionHasUnreadableGap(fb?.ai_transcription)) continue;
            const bucket = byAnchor.get(row.anchor_id);
            if (bucket) bucket.gaps += 1;
          }
        } catch {
          // Ranking signal only -- without it the banner falls back to
          // ordering by raw flag count, which is where it started.
        }
      }

      // The other half of the picture: crops the flag never caught, where the
      // assessor still says the work runs past the edge. possibly_truncated
      // only fires when stage 4's expansion hit its cap with ink on the edge,
      // so a box whose expansion never started -- the density check reads the
      // blank paper between ruled lines and stops (HANDOFF.md, Q1(e)) -- is
      // invisible to it. On A.1 that is 31 crops over 15 anchors, none of them
      // counted above, since that list tallies flagged crops only; on A.2, 3 of
      // the 7 affected anchors have no flagged crop at all and so do not appear
      // there in any form.
      //
      // The ilike triple is a deliberately loose prefilter, not the verdict.
      // Every alternative in TRUNCATION_STATEMENT contains "cut", "continu" or
      // "beyond", so it is a strict superset of the real test and
      // transcriptionStatesTruncation still decides -- one source of truth, in
      // TypeScript, while the database narrows 1472 unflagged crops to 37 rows
      // instead of dragging every transcription through the page.
      try {
        const stated = await fetchAllRows<FlaggedRow>((from, to) =>
          supabase
            .from("na_response_crops")
            .select("id, anchor_id, na_feedback!inner(ai_transcription)")
            .in("anchor_id", anchorIds)
            .not("possibly_truncated", "is", true)
            .or(
              "ai_transcription.ilike.*cut*,ai_transcription.ilike.*continu*,ai_transcription.ilike.*beyond*",
              { referencedTable: "na_feedback" }
            )
            .order("id", { ascending: true })
            .range(from, to)
        );
        for (const row of stated) {
          const fb = Array.isArray(row.na_feedback) ? row.na_feedback[0] : row.na_feedback;
          if (!transcriptionStatesTruncation(fb?.ai_transcription)) continue;
          const bucket = byAnchor.get(row.anchor_id);
          if (bucket) bucket.statedCutOff += 1;
        }
      } catch {
        // Advisory only -- every count the board reported before this is
        // unaffected, so a failure here costs a section, not the page.
      }

      questions = anchors.map((a) => ({
        id: a.id,
        qid: a.qid,
        base_qid: a.base_qid,
        part_label: a.part_label,
        marks_available: a.marks_available,
        command_term: a.command_term,
        sort_order: a.sort_order,
        ungraded: ungradedAnchorIds.has(a.id),
        progress: byAnchor.get(a.id) ?? emptyProgress(),
      }));

      // A student who was re-scanned has more than one packet scan against this
      // version, and every one of their crops counts toward the totals above --
      // so "N responses" can exceed one per student per question without
      // anything being wrong. Say so plainly rather than leaving an inflated
      // denominator to be discovered. Deliberately advisory only: nothing here
      // collapses or hides a scan, because picking a winner per student is a
      // decision the results table (which is per-scan too) has to share.
      // Query scans by packet version rather than by the scan ids present in
      // crops: a scan whose pages never made it through would have no crops at
      // all, and deriving the list from crops is exactly how such a scan stays
      // invisible.
      try {
        const scans = await fetchAllRows<ScanRow>((from, to) =>
          supabase
            .from("na_packet_scans")
            .select(
              "id, status, split_storage_path, invited_student_id, student_profile_id, invited_students(full_name)"
            )
            .eq("packet_version_id", activeVersionId)
            .order("id", { ascending: true })
            .range(from, to)
        );

        const perStudent = new Map<string, number>();
        let unidentified = 0;
        for (const s of scans) {
          const key = s.invited_student_id ?? s.student_profile_id;
          if (!key) {
            unidentified += 1;
            continue;
          }
          perStudent.set(key, (perStudent.get(key) ?? 0) + 1);
        }
        scanStats = {
          scans: scans.length,
          students: perStudent.size,
          duplicated: Array.from(perStudent.values()).filter((n) => n > 1).length,
          unidentified,
        };

        // A scan should have one crop per anchor. Fewer means the split PDF
        // ran out of pages before the packet did, so stage 4 had nothing to
        // cut -- the answers were never captured at all. That is a different
        // thing from an unmarked crop, and the board used to render it as
        // simply a smaller denominator.
        const anchorsByScan = new Map<string, Set<string>>();
        for (const crop of crops) {
          if (!crop.packet_scan_id) continue;
          const seen = anchorsByScan.get(crop.packet_scan_id) ?? new Set<string>();
          seen.add(crop.anchor_id);
          anchorsByScan.set(crop.packet_scan_id, seen);
        }
        incompleteScans = scans
          .map((s) => {
            const seen = anchorsByScan.get(s.id) ?? new Set<string>();
            const missingAnchors = anchors.filter((a) => !seen.has(a.id));
            const student = Array.isArray(s.invited_students) ? s.invited_students[0] : s.invited_students;
            return {
              name: student?.full_name ?? "Unmatched scan",
              present: seen.size,
              missing: missingAnchors.map((a) => a.qid),
              // anchors is ordered by sort_order, which is what makes
              // "trailing" mean "the scan ran out of pages". A missing crop is
              // only re-cuttable while the split PDF it came from still
              // exists; both crop paths refuse without one.
              kind: ((): IncompleteScan["kind"] => {
                const cause = missingAnchorCause(anchors.map((a) => a.id), seen) ?? "crops";
                if (cause === "crops" && !s.split_storage_path) return "crops-no-source";
                return cause;
              })(),
            };
          })
          .filter((row) => row.missing.length > 0)
          .sort((a, b) => b.missing.length - a.missing.length);
      } catch {
        // Advisory only -- a failure here must not cost the teacher the board.
        scanStats = null;
        incompleteScans = [];
      }
    }
  }

  // Overall progress is a marking figure, so it counts only what can be marked.
  // Leaving the thinking space in made A.1's bar top out at 97.5% forever.
  const gradableQuestions = questions.filter((q) => !q.ungraded);
  const totalCrops = gradableQuestions.reduce((sum, q) => sum + q.progress.total, 0);
  const totalReviewed = gradableQuestions.reduce((sum, q) => sum + q.progress.reviewed, 0);
  const ungradedQuestions = questions.filter((q) => q.ungraded);
  const ungradedCrops = ungradedQuestions.reduce((sum, q) => sum + q.progress.total, 0);

  // Anchors where stage 4's adaptive expansion is genuinely running out of
  // room, not just "may be worth a glance" -- ranked so the worst
  // offenders (most students affected) surface first. This is read-only
  // reporting over data stage 4 already recorded; it changes nothing about
  // grading or crop geometry by itself. The fix, when one's needed, is a
  // manual widen of that anchor's expand_max_x1_pt/expand_max_y1_pt (see
  // HANDOFF.md's Q3/Q6/Q19(c)/Q11 fixes for the pattern) followed by a
  // re-crop + re-grade of the affected students -- deliberately NOT
  // automated here, since a past attempt at automatically loosening this
  // cap (see HANDOFF.md, "bridge ruled-paper gaps") let one anchor's crop
  // swallow the next question's printed answer key and had to be reverted.
  // Ranked by gaps, not by flag count. possibly_truncated fires on anything
  // touching the crop edge, printed rules and axis captions included, so its
  // raw count ranks the loudest anchor rather than the worst one: on A.1 it
  // put Q26(a) top with 42 of 47 students flagged, of which exactly one has a
  // transcription the assessor had to guess at, while Q4 (16 of 20 with gaps,
  // and the real problem) sat third. Flag count still breaks ties, and
  // anchors with no gaps stay listed -- the heuristic ranks, it does not
  // adjudicate.
  // Ungraded anchors are excluded: the remedy this banner recommends is widen,
  // re-crop, re-grade, and there is no grade to redo on a box nobody marks. A
  // row that can only ever read "4 flagged, no unreadable gaps" -- the gap
  // heuristic needs a transcription, and an ungraded crop never gets one -- is
  // an invitation to widen an anchor for no benefit. The tile still shows the
  // flag count for anyone who wants it.
  const truncationHotspots = questions
    .filter((q) => !q.ungraded && q.progress.possiblyTruncated > 0)
    .sort(
      (a, b) =>
        b.progress.gaps - a.progress.gaps || b.progress.possiblyTruncated - a.progress.possiblyTruncated
    );
  const anchorsWithGaps = truncationHotspots.filter((q) => q.progress.gaps > 0).length;

  // Kept separate from truncationHotspots because the cause and the remedy
  // differ. There is no expand_max_x1_pt/expand_max_y1_pt to widen when the
  // expansion never started, and scripts/audit_anchor_geometry.py reports no
  // short anchor on either live packet -- so on current data these are students
  // writing past the box one at a time, checked per student against the
  // original page, not an anchor to re-cut.
  const statedCutOffAnchors = questions
    .filter((q) => q.progress.statedCutOff > 0)
    .sort((a, b) => b.progress.statedCutOff - a.progress.statedCutOff || a.sort_order - b.sort_order);
  const statedCutOffCrops = statedCutOffAnchors.reduce((sum, q) => sum + q.progress.statedCutOff, 0);

  // "N reviewed" counts responses, but a student only hears back when their
  // whole packet is approved and released -- so the same N means very
  // different things depending on whether it is concentrated or scattered.
  // Spell that out rather than leaving the bar to imply progress it does not
  // have: on A.1, 47 approvals were one finished student plus eight loose
  // questions across five others.
  const packets = (n: number) => `${n} packet${n === 1 ? "" : "s"}`;
  const approvalNote = ((): string | null => {
    if (!approvals || approvals.approved === 0) return null;
    const clauses: string[] = [];
    if (approvals.approvedOnComplete > 0) {
      const state =
        approvals.readyScans === 0
          ? "released"
          : approvals.releasedScans === 0
            ? `ready to release`
            : `${approvals.releasedScans} released, ${approvals.readyScans} ready to release`;
      clauses.push(
        `${approvals.approvedOnComplete} of those finish ${packets(approvals.completeScans)} (${state})`
      );
    }
    if (approvals.approvedOnPartial > 0) {
      clauses.push(
        `${approvals.approvedOnComplete > 0 ? "the other " : ""}${approvals.approvedOnPartial} ` +
          `${approvals.approvedOnPartial === 1 ? "sits" : "sit"} on ${packets(approvals.partialScans)} ` +
          `still part-reviewed, which cannot be released until the rest of their questions are approved`
      );
    }
    return clauses.length > 0 ? `${clauses.join("; ")}.` : null;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-da-text font-serif">Scanned Response Review</h1>
        <p className="text-da-muted text-sm mt-1">
          Mark vertically: one question at a time, across every student.
        </p>
        {activePv && (
          <p className="text-sm mt-2">
            <span className="text-da-text font-medium">{activeNa?.title ?? "Untitled NA"}</span>{" "}
            {activePv.version_label && <span className="text-da-muted">({activePv.version_label})</span>}
          </p>
        )}
      </div>

      {versions.length > 1 && (
        <div className="flex gap-2">
          {versions.map((pv) => {
            const na = Array.isArray(pv.nuanced_analyses) ? pv.nuanced_analyses[0] : pv.nuanced_analyses;
            return (
              <Link
                key={pv.id}
                href={`/dashboard/na-review?packetVersionId=${pv.id}`}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  pv.id === activeVersionId
                    ? "bg-da-accent/15 border-da-accent text-da-accent"
                    : "border-da-border text-da-muted hover:bg-da-hover"
                }`}
              >
                {na?.title ?? pv.version_label}
              </Link>
            );
          })}
        </div>
      )}

      {loadError && (
        <div className="rounded-xl border border-red-500/60 bg-red-500/5 p-4">
          <p className="text-sm font-medium text-red-400">Could not load the scanned responses</p>
          <p className="mt-1 text-xs text-da-muted">
            The counts below would be wrong, so they are not being shown. {loadError}
          </p>
        </div>
      )}

      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-da-border bg-da-surface p-12 text-center">
          <p className="text-da-muted text-sm">
            No anchors found for this packet version. Run the anchor extractor and crop
            pipeline first.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-da-border bg-da-surface p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-da-text font-medium">Overall progress</span>
              <span className="text-da-muted">
                {totalReviewed} / {totalCrops} responses reviewed
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-da-hover overflow-hidden">
              <div
                className="h-full bg-da-accent transition-all"
                style={{ width: totalCrops > 0 ? `${(totalReviewed / totalCrops) * 100}%` : "0%" }}
              />
            </div>
            {scanStats && (
              <p className="mt-2 text-xs text-da-muted">
                Across {scanStats.scans} scan{scanStats.scans === 1 ? "" : "s"} -- {scanStats.students} student
                {scanStats.students === 1 ? "" : "s"}
                {scanStats.duplicated > 0 &&
                  `, ${scanStats.duplicated} with more than one scan`}
                {scanStats.unidentified > 0 &&
                  `, ${scanStats.unidentified} scan${scanStats.unidentified === 1 ? "" : "s"} not matched to a student`}
                {scanStats.duplicated > 0 && ". A re-scanned student's responses are all counted here."}
              </p>
            )}
            {ungradedCrops > 0 && (
              <p className="mt-1 text-xs text-da-muted">
                Excludes {ungradedCrops} response{ungradedCrops === 1 ? "" : "s"} in{" "}
                {ungradedQuestions.length === 1
                  ? "an ungraded thinking space"
                  : `${ungradedQuestions.length} ungraded thinking spaces`}{" "}
                ({ungradedQuestions.map((q) => q.qid).join(", ")}) -- still listed below to read, but never marked.
              </p>
            )}
            {approvalNote && (
              <p className={`mt-1 text-xs ${approvals && approvals.readyScans > 0 ? "text-emerald-400" : "text-da-muted"}`}>
                {approvalNote}
              </p>
            )}
          </div>

          {incompleteScans.length > 0 && (
            <div className="rounded-xl border border-rose-500/60 bg-rose-500/5 p-4">
              <p className="text-sm font-medium text-rose-400">
                {incompleteScans.length} scan{incompleteScans.length === 1 ? "" : "s"} have questions with no crop
              </p>
              <p className="mt-1 text-xs text-da-muted">
                A scan should produce one crop per question. Fewer has more than one cause, and they need different
                fixes -- sometimes none is available -- so they are separated here.
              </p>
              {(["pages", "crops", "crops-no-source"] as const).map((kind) => {
                const rows = incompleteScans.filter((r) => r.kind === kind);
                if (rows.length === 0) return null;
                return (
                  <div key={kind} className="mt-3">
                    <p className="text-xs font-medium text-da-text">
                      {kind === "pages"
                        ? "Pages never captured -- the answers are not in the system, and only a rescan recovers them."
                        : kind === "crops"
                          ? "Page scanned but the crop failed -- the work is not lost; re-crop that anchor."
                          : "Crop missing and the split PDF was not retained -- there is nothing left to re-cut, so only the original paper recovers this."}
                    </p>
                    <ul className="mt-1 divide-y divide-da-border/40">
                      {rows.map((scan, i) => (
                        <li
                          key={`${kind}-${scan.name}-${i}`}
                          className="flex items-center justify-between gap-3 py-1.5 text-sm"
                        >
                          <span className="text-da-text">{scan.name}</span>
                          <span className={`text-xs ${kind === "crops" ? "text-da-muted" : "text-rose-300"}`}>
                            {scan.present} of {questions.length} -- missing {scan.missing.slice(0, 6).join(", ")}
                            {scan.missing.length > 6 && ` and ${scan.missing.length - 6} more`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {truncationHotspots.length > 0 && (
            <div className="rounded-xl border border-amber-400/60 bg-amber-500/5 p-4">
              <p className="text-sm font-medium text-amber-500">
                {anchorsWithGaps > 0
                  ? `${anchorsWithGaps} anchor${anchorsWithGaps === 1 ? "" : "s"} look${
                      anchorsWithGaps === 1 ? "s" : ""
                    } to be cropping students' work too tight`
                  : `${truncationHotspots.length} anchor${
                      truncationHotspots.length === 1 ? "" : "s"
                    } touched their crop limit, none with unreadable work`}
              </p>
              <p className="mt-1 text-xs text-da-muted">
                Stage 4&apos;s crop expansion hit its configured limit while ink was still touching the edge -- these
                crops may be missing content. This is a read-only report over data already collected (no new AI
                calls); nothing here re-crops or re-grades automatically.
              </p>
              <p className="mt-1 text-xs text-da-muted">
                Ordered by how many of those crops the assessor had to <em>guess at</em> -- a transcription with
                bracketed gaps like &quot;the express[ions are equivalent]&quot; is much stronger evidence than the
                flag alone, which also fires on printed rules and axis captions that touch the crop edge. An anchor
                with many flags and no gaps is usually a printed element, not a student running out of room. If a
                box is genuinely too tight, the fix is widening that anchor&apos;s
                expand_max_x1_pt/expand_max_y1_pt in na_anchors, then re-cropping and re-grading just that
                anchor&apos;s affected students.
              </p>
              <ul className="mt-3 divide-y divide-da-border/40">
                {truncationHotspots.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <Link
                      href={`/dashboard/na-review/${q.id}`}
                      className="text-da-text hover:text-da-accent hover:underline"
                    >
                      {q.qid}
                    </Link>
                    <span className={`text-xs ${q.progress.gaps > 0 ? "text-amber-300" : "text-da-muted"}`}>
                      {q.progress.gaps > 0
                        ? `${q.progress.gaps} of ${q.progress.possiblyTruncated} flagged crop${
                            q.progress.possiblyTruncated === 1 ? "" : "s"
                          } ${q.progress.gaps === 1 ? "has an unreadable gap" : "have unreadable gaps"}`
                        : `${q.progress.possiblyTruncated} flagged, no unreadable gaps`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {statedCutOffAnchors.length > 0 && (
            <div className="rounded-xl border border-sky-400/60 bg-sky-500/5 p-4">
              <p className="text-sm font-medium text-sky-400">
                {statedCutOffCrops} response{statedCutOffCrops === 1 ? "" : "s"} the crop detector did not flag, where
                the assessor says the work runs past the edge anyway
              </p>
              <p className="mt-1 text-xs text-da-muted">
                A crop is only flagged when stage 4&apos;s expansion hit its limit with ink still on the edge. Where
                the expansion never started -- the density check reads the blank paper between ruled lines and stops
                -- nothing is flagged, so these crops are missing from the amber list above even for an anchor that
                appears in it, because that list counts flagged crops only.
              </p>
              <p className="mt-1 text-xs text-da-muted">
                Listed on the assessor&apos;s own words alone -- &quot;[cut off]&quot;, &quot;[continues below
                crop]&quot; -- which run about 2% of unflagged crops against 14% of flagged ones. A bracketed guess
                is deliberately not enough to appear here: away from the flag those are mostly illegible handwriting
                rather than missing text. Worth opening before you approve, since approving one sends a student
                feedback on work the assessor could not fully see.
              </p>
              <ul className="mt-3 divide-y divide-da-border/40">
                {statedCutOffAnchors.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <Link
                      href={`/dashboard/na-review/${q.id}`}
                      className="text-da-text hover:text-da-accent hover:underline"
                    >
                      {q.qid}
                    </Link>
                    <span className="text-xs text-sky-300">
                      {q.progress.statedCutOff} unflagged crop{q.progress.statedCutOff === 1 ? "" : "s"}
                      {q.progress.statedCutOff === 1 ? " says" : " say"} the work continues past the edge
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {questions.map((q) => {
              const pct = q.progress.total > 0 ? Math.round((q.progress.reviewed / q.progress.total) * 100) : 0;
              const done = q.progress.total > 0 && q.progress.reviewed === q.progress.total;
              return (
                <Link
                  key={q.id}
                  href={`/dashboard/na-review/${q.id}`}
                  className="group block rounded-xl border border-da-border bg-da-surface px-5 py-4 transition-all hover:bg-da-hover hover:border-da-accent/60 hover:shadow-lg hover:shadow-black/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-da-text group-hover:text-da-accent transition-colors">
                        {q.qid}
                      </h3>
                      {q.command_term && (
                        <p className="text-xs text-da-muted mt-0.5">{q.command_term}</p>
                      )}
                    </div>
                    {done && <span className="text-green-500 text-lg">✓</span>}
                  </div>

                  {q.ungraded ? (
                    <div className="mt-3">
                      <span className="inline-block rounded-full border border-da-border bg-da-hover px-2 py-0.5 text-[11px] text-da-muted">
                        Thinking space -- not marked
                      </span>
                      <p className="mt-1.5 text-xs text-da-muted">
                        {q.progress.total} response{q.progress.total === 1 ? "" : "s"} to read, none to mark
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="mt-3 flex items-center justify-between text-xs text-da-muted">
                        <span>
                          {q.progress.reviewed}/{q.progress.total} reviewed
                        </span>
                        {q.marks_available != null && <span>{q.marks_available} Clev&apos;s Marks</span>}
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-da-hover overflow-hidden">
                        <div
                          className={`h-full transition-all ${done ? "bg-green-500" : "bg-da-accent"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  )}
                  {q.progress.blank > 0 && (
                    <p className="mt-1.5 text-[11px] text-da-muted">{q.progress.blank} blank</p>
                  )}
                  {q.progress.gaps > 0 ? (
                    <p className="mt-1.5 text-[11px] text-amber-500">⚠ {q.progress.gaps} may be cut off</p>
                  ) : (
                    q.progress.possiblyTruncated > 0 && (
                      <p className="mt-1.5 text-[11px] text-da-muted">
                        {q.progress.possiblyTruncated} touched the crop limit
                      </p>
                    )
                  )}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
