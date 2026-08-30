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
  const isViewingStudent = isTeacher && !!viewStudentId;

  const handleScanChange = (scanId: string) => {
    const params = new URLSearchParams();
    params.set("scanId", scanId);
    if (viewStudentId) params.set("viewStudent", viewStudentId);
    router.push(`/dashboard/na-feedback?${params.toString()}`);
  };

  const selectedScan = scans.find((s) => s.packetScanId === selectedScanId) ?? null;
  const totalMarksAwarded = initialItems.reduce((sum, i) => sum + (i.marksAwarded ?? 0), 0);
  const totalMarksAvailable = initialItems.reduce((sum, i) => sum + (i.marksAvailable ?? 0), 0);

  if (isTeacher && !viewStudentId) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-extrabold mb-2 text-da-text">My Feedback</h1>
        <p className="text-sm text-da-muted">
          Open a student&apos;s row from{" "}
          <Link href="/dashboard/na-review/scan-test" className="text-da-accent hover:underline">
            Results by class
          </Link>{" "}
          and add <code>?viewStudent=&lt;profileId&gt;</code> to preview what they see.
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
            {initialItems.map((item) => (
              <div
                key={item.cropId}
                className="rounded-lg border border-da-border bg-da-surface px-4 py-3"
              >
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
                {item.studentFlaggedMisread && (
                  <p className="mt-2 text-xs text-amber-500">
                    You flagged this as possibly misread{item.studentFlagNote ? `: "${item.studentFlagNote}"` : "."}
                  </p>
                )}
              </div>
            ))}
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
