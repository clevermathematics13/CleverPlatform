import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/na-scanning";
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
  na_feedback: { approved_at: string | null } | { approved_at: string | null }[] | null;
};

type ScanRow = {
  id: string;
  invited_student_id: string | null;
  student_profile_id: string | null;
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
    progress: { total: number; reviewed: number; blank: number; possiblyTruncated: number };
  }[] = [];
  let scanStats: { scans: number; students: number; duplicated: number; unidentified: number } | null = null;
  let loadError: string | null = null;

  if (activeVersionId) {
    const { data: anchors } = await supabase
      .from("na_anchors")
      .select("id, qid, base_qid, part_label, marks_available, command_term, sort_order")
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
            .select("id, anchor_id, packet_scan_id, is_blank, possibly_truncated, na_feedback(approved_at)")
            .in("anchor_id", anchorIds)
            .order("id", { ascending: true })
            .range(from, to)
        );
      } catch (e) {
        // fetchAllRows throws where the old destructure swallowed the error.
        // Better a visible failure than a confidently wrong denominator.
        loadError = e instanceof Error ? e.message : "Failed to load scanned responses";
      }

      const byAnchor = new Map<
        string,
        { total: number; reviewed: number; blank: number; possiblyTruncated: number }
      >();
      for (const a of anchors) byAnchor.set(a.id, { total: 0, reviewed: 0, blank: 0, possiblyTruncated: 0 });
      for (const crop of crops) {
        const bucket = byAnchor.get(crop.anchor_id);
        if (!bucket) continue;
        bucket.total += 1;
        if (crop.is_blank) bucket.blank += 1;
        if (crop.possibly_truncated) bucket.possiblyTruncated += 1;
        const fb = Array.isArray(crop.na_feedback) ? crop.na_feedback[0] : crop.na_feedback;
        if (fb?.approved_at) bucket.reviewed += 1;
      }

      questions = anchors.map((a) => ({
        ...a,
        progress: byAnchor.get(a.id) ?? { total: 0, reviewed: 0, blank: 0, possiblyTruncated: 0 },
      }));

      // A student who was re-scanned has more than one packet scan against this
      // version, and every one of their crops counts toward the totals above --
      // so "N responses" can exceed one per student per question without
      // anything being wrong. Say so plainly rather than leaving an inflated
      // denominator to be discovered. Deliberately advisory only: nothing here
      // collapses or hides a scan, because picking a winner per student is a
      // decision the results table (which is per-scan too) has to share.
      const scanIds = Array.from(
        new Set(crops.map((c) => c.packet_scan_id).filter((id): id is string => Boolean(id)))
      );
      if (scanIds.length > 0) {
        try {
          const scans = await fetchAllRows<ScanRow>((from, to) =>
            supabase
              .from("na_packet_scans")
              .select("id, invited_student_id, student_profile_id")
              .in("id", scanIds)
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
        } catch {
          // Advisory only -- a failure here must not cost the teacher the board.
          scanStats = null;
        }
      }
    }
  }

  const totalCrops = questions.reduce((sum, q) => sum + q.progress.total, 0);
  const totalReviewed = questions.reduce((sum, q) => sum + q.progress.reviewed, 0);

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
  const truncationHotspots = questions
    .filter((q) => q.progress.possiblyTruncated > 0)
    .sort((a, b) => b.progress.possiblyTruncated - a.progress.possiblyTruncated);

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
          </div>

          {truncationHotspots.length > 0 && (
            <div className="rounded-xl border border-amber-400/60 bg-amber-500/5 p-4">
              <p className="text-sm font-medium text-amber-500">
                {truncationHotspots.length} anchor{truncationHotspots.length === 1 ? "" : "s"}{" "}
                may be cropping some students&apos; work too tight
              </p>
              <p className="mt-1 text-xs text-da-muted">
                Stage 4&apos;s crop expansion hit its configured limit while ink was still touching the edge -- these
                crops may be missing content. This is a read-only report over data already collected (no new AI
                calls); nothing here re-crops or re-grades automatically. Worth a look, worst first -- if a box is
                genuinely too tight, the fix is widening that anchor&apos;s expand_max_x1_pt/expand_max_y1_pt in
                na_anchors, then re-cropping and re-grading just that anchor&apos;s affected students.
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
                    <span className="text-xs text-amber-300">
                      {q.progress.possiblyTruncated} / {q.progress.total} crop
                      {q.progress.possiblyTruncated === 1 ? "" : "s"} may be cut off
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
                  {q.progress.blank > 0 && (
                    <p className="mt-1.5 text-[11px] text-da-muted">{q.progress.blank} blank</p>
                  )}
                  {q.progress.possiblyTruncated > 0 && (
                    <p className="mt-1.5 text-[11px] text-amber-500">
                      ⚠ {q.progress.possiblyTruncated} may be cut off
                    </p>
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
