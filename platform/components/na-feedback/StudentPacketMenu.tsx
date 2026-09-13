"use client";

/**
 * The sphere menu on a student's Feedback page: a button that stays put while
 * the page scrolls, holding the switch between the detailed feedback and the
 * plain answers list.
 *
 * WHY THE SPHERE, AND WHY IT IS ALLOWED TO MOVE HERE. components/brand/Sphere
 * carries a standing rule that the loop belongs to the sign-in page and not to
 * the working dashboard, because motion competes with reading. This is the one
 * exception, and it earns it on the same terms the rule is written in: the
 * button is 44px in the corner rather than a focal object, it is the only
 * animated thing on the page, and a reader who does not want it never gets it
 * -- Sphere checks prefers-reduced-motion before playing, and a reduced-motion
 * student is served the static CSS orb without the video being fetched at all.
 *
 * The artwork's backdrop is keyed to --color-da-bg and is opaque, not
 * transparent, so the video only disappears into a surface actually painted
 * that colour. The button is painted it, and clips to a circle inside its own
 * ring, which is why the frame reads as an orb here rather than as the dark
 * square it would be on a card or on the body gradient.
 *
 * The 1.7 MB file is not a new cost on this page: every student passes through
 * the sign-in page, which serves the same URL, so it arrives from the HTTP
 * cache.
 */

import { useEffect, useRef } from "react";
import { Sphere } from "@/components/brand/Sphere";

export type FeedbackView = "detailed" | "answers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: FeedbackView;
  onViewChange: (view: FeedbackView) => void;
  /** Null hides the filter entirely -- on a packet with nothing to review,
   *  offering to show only the questions that need reviewing is noise. */
  lostMarksCount: number | null;
  onlyLostMarks: boolean;
  onOnlyLostMarksChange: (only: boolean) => void;
  /** False on a packet whose rubric holds no answers at all, so the menu
   *  never offers a view that would open empty. */
  answersAvailable: boolean;
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
        selected
          ? "bg-da-accent text-da-on-accent"
          : "text-da-muted hover:bg-da-hover hover:text-da-text"
      }`}
    >
      {children}
    </button>
  );
}

export function StudentPacketMenu({
  open,
  onOpenChange,
  view,
  onViewChange,
  lostMarksCount,
  onlyLostMarks,
  onOnlyLostMarksChange,
  answersAvailable,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Escape and click-away. Bound only while the panel is open, so a closed
  // menu costs the page nothing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div
          id="packet-menu-panel"
          className="w-64 rounded-xl border border-da-border bg-da-surface p-3 shadow-2xl shadow-black/50"
        >
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-da-muted">View</p>
          <div role="radiogroup" aria-label="View" className="mb-3 flex gap-1 rounded-lg bg-da-bg p-1">
            <Choice selected={view === "detailed"} onClick={() => onViewChange("detailed")}>
              Detailed
            </Choice>
            <Choice
              selected={view === "answers"}
              onClick={() => answersAvailable && onViewChange("answers")}
            >
              Answers
            </Choice>
          </div>
          {!answersAvailable && (
            <p className="-mt-2 mb-3 text-[11px] text-da-muted">
              This packet&apos;s answers have not been written up yet.
            </p>
          )}

          {lostMarksCount !== null && (
            <>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-da-muted">
                Show
              </p>
              <div role="radiogroup" aria-label="Show" className="mb-3 flex gap-1 rounded-lg bg-da-bg p-1">
                <Choice selected={!onlyLostMarks} onClick={() => onOnlyLostMarksChange(false)}>
                  Everything
                </Choice>
                <Choice selected={onlyLostMarks} onClick={() => onOnlyLostMarksChange(true)}>
                  To review ({lostMarksCount})
                </Choice>
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              onOpenChange(false);
            }}
            className="w-full rounded px-3 py-1.5 text-left text-xs text-da-muted hover:bg-da-hover hover:text-da-text"
          >
            Back to the top
          </button>
        </div>
      )}

      <button
        type="button"
        aria-label={open ? "Close packet menu" : "Open packet menu"}
        aria-expanded={open}
        aria-controls="packet-menu-panel"
        onClick={() => onOpenChange(!open)}
        className="grid h-14 w-14 place-items-center overflow-hidden rounded-full border border-da-border bg-da-bg shadow-xl shadow-black/50 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-da-accent"
      >
        <Sphere size={56} />
      </button>
    </div>
  );
}
