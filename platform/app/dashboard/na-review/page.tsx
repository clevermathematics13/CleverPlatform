import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

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

  const activeVersionId = packetVersionId ?? packetVersions?.[0]?.id ?? null;

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

  if (activeVersionId) {
    const { data: anchors } = await supabase
      .from("na_anchors")
      .select("id, qid, base_qid, part_label, marks_available, command_term, sort_order")
      .eq("packet_version_id", activeVersionId)
      .order("sort_order");

    if (anchors && anchors.length > 0) {
      const anchorIds = anchors.map((a) => a.id);
      const { data: crops } = await supabase
        .from("na_response_crops")
        .select("id, anchor_id, is_blank, possibly_truncated, na_feedback(approved_at)")
        .in("anchor_id", anchorIds);

      const byAnchor = new Map<
        string,
        { total: number; reviewed: number; blank: number; possiblyTruncated: number }
      >();
      for (const a of anchors) byAnchor.set(a.id, { total: 0, reviewed: 0, blank: 0, possiblyTruncated: 0 });
      for (const crop of crops ?? []) {
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
      </div>

      {packetVersions && packetVersions.length > 1 && (
        <div className="flex gap-2">
          {packetVersions.map((pv) => {
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
          </div>

          {truncationHotspots.length > 0 && (
            <div className="rounded-xl border border-amber-400/60 bg-amber-500/5 p-4">
              <p className="text-sm font-medium text-amber-500">
                {truncationHotspots.length} anchor{truncationHotspots.length === 1 ? "" : "s"} may be cropping some
                students&apos; work too tight
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
