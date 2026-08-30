"use client";

import { useEffect } from "react";

interface CropImagePanelProps {
  title: string;
  promptImageUrl: string | null;
  cropImageUrl: string | null;
  onClose: () => void;
}

/** Slide-in right-side panel showing "my work" for one question: the
 *  printed question (if a prompt crop exists for this anchor) stacked
 *  above the student's own cropped response. Structurally modeled on
 *  components/reflection/DocPanel.tsx's slide-in pattern, but renders
 *  images directly rather than an iframe -- there's no Drive/Docs URL
 *  here, just Storage-hosted crop images. */
export function CropImagePanel({ title, promptImageUrl, cropImageUrl, onClose }: CropImagePanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label={title}
        className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-2xl flex-col bg-da-surface shadow-2xl border-l border-da-border"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-da-border">
          <h2 className="font-bold text-da-text text-base truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-da-border px-3 py-1 text-xs font-medium text-da-muted hover:bg-da-hover transition-colors"
          >
            ✕ Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {promptImageUrl && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-da-muted">Question</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, expires hourly, not a static asset */}
              <img src={promptImageUrl} alt="Printed question" className="w-full rounded-lg border border-da-border" />
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-da-muted">My work</p>
            {cropImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, expires hourly, not a static asset
              <img src={cropImageUrl} alt="My work" className="w-full rounded-lg border border-da-border" />
            ) : (
              <p className="text-sm text-da-muted">No image available.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
