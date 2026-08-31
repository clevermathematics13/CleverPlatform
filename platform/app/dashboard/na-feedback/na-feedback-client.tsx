"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ReleasedPacketScan, NaFeedbackItem } from "@/lib/na-feedback-service";
import { CropImagePanel } from "@/components/na-feedback/CropImagePanel";

interface NaFeedbackClientProps {
  isTeacher: boolean;
  viewStudentId: string | null;
  viewStudentName: string | null;
  scans: ReleasedPacketScan[];
  selectedScanId: string | null;
  initialItems: NaFeedbackItem[];
}

export function NaFeedbackClient({
  isTeacher,
  viewStudentId,
  viewStudentName,
  scans,
  selectedScanId,
  initialItems,
}: NaFeedbackClientProps) {
  const router = useRouter();
  const [openPanel, setOpenPanel] = useState<NaFeedbackItem | null>(null);
  const [items, setItems] = useState<NaFeedbackItem[]>(initialItems);
  const [flagDraft, setFlagDraft] = useState<{ cropId: string; note: string } | null>(null);
  const [flagSaving, setFlagSaving] = useState<string | null>(null);
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(new Set());
  // Keyed on the resolved name, not on viewStudentId: a teacher can
  // preview by ?scanId= alone (a class where nobody has signed in yet has
  // no profile id to pass), and that path still resolves a name from the
  // roster row.
  const isViewingStudent = isTeacher && !!viewStudentName;
  // A teacher previewing a student's view can look, but flagging is the
  // student's own act -- never let a teacher submit it on their behalf.
  const canFlag = !isTeacher;

  const handleScanChange = (scanId: string) => {
    const params = new URLSearchParams();
    params.set("scanId", scanId);
    if (viewStudentId) params.set("viewStudent", viewStudentId);
    router.push(`/dashboard/na-feedback?${params.toString()}`);
  };

  const submitFlag = async (cropId: string, flagged: boolean, note: string | null) => {
    setFlagSaving(cropId);
    try {
      const res = await fetch(`/api/na-feedback/${cropId}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagged, note: note ?? undefined }),
      });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((i) =>
          i.cropId === cropId
            ? { ...i, studentFlaggedMisread: flagged, studentFlagNote: flagged ? note : null }
            : i
        )
      );
      setFlagDraft(null);
    } finally {
      setFlagSaving(null);
    }
  };

  const selectedScan = scans.find((s) => s.packetScanId === selectedScanId) ?? null;
  const totalMarksAwarded = items.reduce((sum, i) => sum + (i.marksAwarded ?? 0), 0);
  const totalMarksAvailable = items.reduce((sum, i) => sum + (i.marksAvailable ?? 0), 0);

  /** Consecutive questions the student never wrote in collapse into one
   *  summary row instead of one card each. Roberto Aurelio Gamio's A.1
   *  packet is why: he stopped after Q12, so 24 of 39 questions were
   *  untouched, and one card apiece buries the feedback on the 15 he did
   *  attempt under a wall of near-identical notes. Runs are grouped
   *  rather than all blanks pooled together, so the summary keeps the
   *  packet's real shape ("Q13 to Q30") instead of implying he skipped
   *  questions at random. Expandable, because a student who believes
   *  they DID answer one needs to see the scan and flag it. */
  type Group =
    | { kind: "item"; key: string; item: NaFeedbackItem }
    | { kind: "unattempted"; key: string; items: NaFeedbackItem[] };
  const groups: Group[] = [];
  for (const item of items) {
    if (item.attempted) {
      groups.push({ kind: "item", key: item.cropId, item });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.kind === "unattempted") last.items.push(item);
    else groups.push({ kind: "unattempted", key: `gap-${item.cropId}`, items: [item] });
  }

  const labelOf = (i: NaFeedbackItem) => `${i.qid}${i.partLabel ? ` (${i.partLabel})` : ""}`;

  const renderItem = (item: NaFeedbackItem) => {
    const draftOpen = flagDraft?.cropId === item.cropId;
    return (
      <div key={item.cropId} className="rounded-lg border border-da-border bg-da-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-da-text">
                  {item.qid}
                  {item.partLabel ? ` (${item.partLabel})` : ""}
                </span>
                {item.fullMarks ? (
                  <span className="text-green-500 text-lg" title="Full marks">
                    ✓
                  </span>
                ) : (
                  <span className="text-xs text-da-muted">
                    {item.marksAwarded ?? 0} / {item.marksAvailable ?? "?"}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpenPanel(item)}
                className="shrink-0 rounded border border-da-border px-2 py-1 text-xs text-da-muted hover:bg-da-hover"
              >
                See my work
              </button>
            </div>
            {!item.fullMarks && (item.marginComment || item.nextStep) && (
              <div className="mt-2 space-y-1 text-sm">
                {item.marginComment && <p className="text-da-text">{item.marginComment}</p>}
                {item.nextStep && <p className="text-da-muted">Next step: {item.nextStep}</p>}
              </div>
            )}

            {item.studentFlaggedMisread ? (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-amber-500">
                  Flagged as possibly misread{item.studentFlagNote ? `: "${item.studentFlagNote}"` : "."}
                </span>
                {canFlag && (
                  <button
                    type="button"
                    disabled={flagSaving === item.cropId}
                    onClick={() => void submitFlag(item.cropId, false, null)}
                    className="text-da-muted hover:underline disabled:opacity-50"
                  >
                    Undo
                  </button>
                )}
              </div>
            ) : (
              canFlag && (
              <div className="mt-2">
                {draftOpen ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      autoFocus
                      value={flagDraft?.note ?? ""}
                      onChange={(e) => setFlagDraft({ cropId: item.cropId, note: e.target.value })}
                      placeholder="What do you think was misread? (optional)"
                      className="flex-1 rounded border border-da-border bg-da-surface px-2 py-1 text-xs text-da-text focus:ring-1 focus:ring-da-accent"
                    />
                    <button
                      type="button"
                      disabled={flagSaving === item.cropId}
                      onClick={() => void submitFlag(item.cropId, true, flagDraft?.note.trim() || null)}
                      className="shrink-0 rounded border border-da-border px-2 py-1 text-xs text-da-text hover:bg-da-hover disabled:opacity-50"
                    >
                      {flagSaving === item.cropId ? "Saving…" : "Submit"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFlagDraft(null)}
                      className="shrink-0 text-xs text-da-muted hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFlagDraft({ cropId: item.cropId, note: "" })}
                    className="text-xs text-da-muted hover:underline"
                  >
                    🚩 Flag this mark as possibly misread
                  </button>
                )}
              </div>
              )
            )}
      </div>
    );
  };

  if (isTeacher && !isViewingStudent) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-extrabold mb-2 text-da-text">My Feedback</h1>
        <p className="text-sm text-da-muted">
          Click &quot;View feedback&quot; next to a released student in{" "}
          <Link href="/dashboard/na-review/scan-test" className="text-da-accent hover:underline">
            Results by class
          </Link>{" "}
          to preview what they see.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {isViewingStudent && (
        <div className="mb-4">
          <Link href="/dashboard/na-feedback" className="text-sm text-da-accent hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      )}
      <h1 className="text-2xl font-extrabold mb-2 text-da-text">
        {isViewingStudent ? `${viewStudentName}'s Feedback` : "My Feedback"}
      </h1>

      {scans.length === 0 && (
        <p className="text-sm text-da-muted">No feedback has been released to you yet.</p>
      )}

      {scans.length > 0 && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <label htmlFor="scan-selector" className="text-sm font-semibold text-da-text">
              Packet:
            </label>
            <select
              id="scan-selector"
              value={selectedScanId ?? ""}
              onChange={(e) => handleScanChange(e.target.value)}
              className="rounded border border-da-border bg-da-surface px-3 py-1.5 text-sm font-medium text-da-text focus:ring-2 focus:ring-da-accent"
            >
              {scans.map((s) => (
                <option key={s.packetScanId} value={s.packetScanId}>
                  {s.title}
                  {s.versionLabel ? ` (${s.versionLabel})` : ""}
                </option>
              ))}
            </select>
          </div>

          {selectedScan && (
            <p className="mb-4 text-xs text-da-muted">
              Released {new Date(selectedScan.releasedAt).toLocaleDateString()} — {totalMarksAwarded} /{" "}
              {totalMarksAvailable} Clev&apos;s Marks.
            </p>
          )}

          <div className="space-y-2">
            {groups.map((group) => {
              if (group.kind === "unattempted") {
                const open = expandedGaps.has(group.key);
                const gapMarks = group.items.reduce((sum, i) => sum + (i.marksAvailable ?? 0), 0);
                return (
                  <div key={group.key} className="space-y-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedGaps((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      className="w-full rounded-lg border border-dashed border-da-border bg-da-surface/50 px-4 py-3 text-left hover:bg-da-hover"
                    >
                      <span className="text-sm text-da-muted">
                        {group.items.length === 1
                          ? `${labelOf(group.items[0])} — not attempted`
                          : `${labelOf(group.items[0])} to ${labelOf(group.items[group.items.length - 1])} — ${group.items.length} questions not attempted`}
                        {gapMarks > 0 ? ` (${gapMarks} Clev's Marks)` : ""}
                      </span>
                      <span className="ml-2 text-xs text-da-accent">{open ? "Hide" : "Show these"}</span>
                    </button>
                    {open && <div className="space-y-2 pl-3">{group.items.map(renderItem)}</div>}
                  </div>
                );
              }
              return renderItem(group.item);
            })}
          </div>
        </>
      )}

      {openPanel && (
        <CropImagePanel
          title={`${openPanel.qid}${openPanel.partLabel ? ` (${openPanel.partLabel})` : ""}`}
          promptImageUrl={openPanel.promptCropImageUrl}
          cropImageUrl={openPanel.cropImageUrl}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </div>
  );
}
