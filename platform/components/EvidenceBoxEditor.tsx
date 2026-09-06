"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DrawnBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Props {
  /** What the teacher is locating, e.g. "Q4 (a)". Shown in the header. */
  title: string;
  /** Full-page render as a data URL, with any existing region already outlined in red by the CV service. */
  imageSrc: string | null;
  page: number;
  pageCount: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onSave: (box: DrawnBox) => void;
  onClose: () => void;
}

/**
 * Drag a rectangle on a scanned page to say where a part's work actually is.
 *
 * Deliberately NOT built on the review page's shared lightbox. That lightbox
 * dismisses on any backdrop click, which is precisely what a drag released
 * outside the image looks like -- and it is also used for three other
 * read-only images that should keep dismissing that way.
 *
 * Coordinates are fractions of the page, measured against the <img> element's
 * own bounding rect. That works only because the element's border box IS the
 * painted image: the img is sized by max-width/max-height with its intrinsic
 * aspect ratio intact, so there is no object-fit letterboxing to correct for,
 * and no need to reason about the render's 300 DPI intrinsic size. Adding a
 * fixed width/height, padding, or object-contain to the img would silently
 * reintroduce the scale bug this whole feature exists to fix.
 */
export default function EvidenceBoxEditor({
  title,
  imageSrc,
  page,
  pageCount,
  loading,
  saving,
  error,
  onPageChange,
  onSave,
  onClose,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [start, setStart] = useState<{ page: number; x: number; y: number } | null>(null);
  // A box drawn on page 3 means nothing on page 4, so what was drawn is stored
  // WITH its page and read back only for the page on show. Deriving it this way
  // rather than clearing it from an effect keeps a page change to a single
  // render -- and means there is no window in which a stale box could be saved
  // against the wrong page.
  const [drawn, setDrawn] = useState<{ page: number; box: DrawnBox } | null>(null);
  const box = drawn && drawn.page === page ? drawn.box : null;
  const dragging = start !== null && start.page === page;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dragging) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging, onClose]);

  const pointToFraction = useCallback((clientX: number, clientY: number) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!imageSrc) return;
    const point = pointToFraction(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    // Capture so a drag that runs off the image still tracks to its release.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setStart({ page, ...point });
    setDrawn({ page, box: { x0: point.x, y0: point.y, x1: point.x, y1: point.y } });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start || start.page !== page) return;
    const point = pointToFraction(e.clientX, e.clientY);
    if (!point) return;
    setDrawn({
      page,
      box: {
        x0: Math.min(start.x, point.x),
        y0: Math.min(start.y, point.y),
        x1: Math.max(start.x, point.x),
        y1: Math.max(start.y, point.y),
      },
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!start) return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    setStart(null);
  };

  const drawnArea = box ? (box.x1 - box.x0) * (box.y1 - box.y0) : 0;
  const canSave = !!box && drawnArea > 0 && !saving && !loading;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-white">
        <h2 className="text-sm font-semibold">Where is the work for {title}?</h2>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="px-1 text-xs tabular-nums">
            Page {page} of {pageCount || "?"}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={(pageCount > 0 && page >= pageCount) || loading}
            className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40"
          >
            Next →
          </button>
        </div>

        <p className="text-xs text-white/70">
          {loading
            ? "Loading page…"
            : box
              ? "Drag again to redraw, or save this region."
              : "Drag a box around this part's work. Any existing region is outlined in red."}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => box && onSave(box)}
            disabled={!canSave}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {saving ? "Re-cutting…" : "Save region"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
          >
            Close ✕
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-2 rounded bg-red-900/70 px-3 py-2 text-xs text-red-100" role="alert">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-auto">
        {imageSrc ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageSrc}
              alt={`Page ${page} of the scanned paper`}
              draggable={false}
              className="block max-h-[78vh] max-w-full select-none rounded shadow-2xl"
            />
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="absolute inset-0 cursor-crosshair touch-none"
            >
              {box && (
                <div
                  className="pointer-events-none absolute border-2 border-blue-500 bg-blue-400/20"
                  style={{
                    left: `${box.x0 * 100}%`,
                    top: `${box.y0 * 100}%`,
                    width: `${(box.x1 - box.x0) * 100}%`,
                    height: `${(box.y1 - box.y0) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-white/70">{loading ? "Loading page…" : "No page to show."}</p>
        )}
      </div>
    </div>
  );
}
