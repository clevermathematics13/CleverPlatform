"use client";

import { useEffect } from "react";

interface DocPanelProps {
  title: string;
  url: string;
  onClose: () => void;
}

/** Convert a Google Drive/Docs URL to an embeddable preview URL. */
function toEmbedUrl(url: string): string {
  // Google Drive file: /file/d/ID/view → /file/d/ID/preview
  const driveFile = url.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (driveFile) return `https://drive.google.com/file/d/${driveFile[1]}/preview`;

  // Google Docs: /document/d/ID/... → /document/d/ID/preview
  const gDoc = url.match(/docs\.google\.com\/document\/d\/([^/?]+)/);
  if (gDoc) return `https://docs.google.com/document/d/${gDoc[1]}/preview`;

  // Already a preview link — pass through
  return url;
}

/**
 * Slide-in right-side panel for viewing exam paper or mark scheme documents.
 * Renders an iframe so students can reference the document without navigating away.
 */
export function DocPanel({ title, url, onClose }: DocPanelProps) {
  const embedUrl = toEmbedUrl(url);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label={title}
        className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-2xl flex-col bg-da-surface shadow-2xl border-l border-da-border"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-da-border bg-da-hover">
          <h2 className="font-bold text-da-accent text-base truncate">{title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-da-border px-3 py-1 text-xs font-medium text-da-accent hover:bg-da-hover transition-colors"
            >
              ↗ Open in new tab
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-da-border bg-da-surface px-3 py-1 text-xs font-medium text-da-muted hover:bg-da-hover transition-colors"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* iframe */}
        <iframe
          src={embedUrl}
          title={title}
          allow="fullscreen"
          className="flex-1 w-full border-0"
        />
      </div>
    </>
  );
}
