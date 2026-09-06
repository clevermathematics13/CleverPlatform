"use client";

import type { ReflectionStep } from "@/lib/reflection-types";

const STEPS = [
  { num: 1 as const, label: "Self-Grade" },
  { num: 2 as const, label: "Compare" },
  { num: 3 as const, label: "Upload Corrections" },
  { num: 4 as const, label: "Done" },
];

export function StepTracker({
  current,
  onSelect,
  skippedSteps = [],
}: {
  current: ReflectionStep;
  /** When given, any step BEFORE the current one becomes a button that goes
   *  back to it. Only backwards: the later steps gate on real state (the
   *  teacher's marks, a disagreement of 0), so letting the tracker jump
   *  forward would skip those checks. */
  onSelect?: (step: ReflectionStep) => void;
  /** Steps that were legitimately not done rather than completed -- shown as
   *  "optional", not ticked. Without this, a test whose self-assessment is
   *  switched off opens on Compare with a green tick against a Self-Grade the
   *  student never did. */
  skippedSteps?: ReflectionStep[];
}) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((step, i) => {
        const isSkipped = skippedSteps.includes(step.num);
        const isDone = step.num < current && !isSkipped;
        const isCurrent = step.num === current;
        const canGoBack = !!onSelect && step.num < current;

        const circle = (
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
              isDone
                ? "bg-green-700/70 text-da-text"
                : isCurrent
                  ? "bg-da-accent text-da-bg"
                  : isSkipped
                    ? "border border-dashed border-da-border bg-da-surface text-da-muted"
                    : "bg-da-surface border border-da-border text-da-muted"
            }`}
          >
            {isDone ? "✓" : step.num}
          </div>
        );

        const text = (
          <span
            className={`text-base font-bold ${
              isCurrent
                ? "text-da-amber"
                : isDone
                  ? "text-green-400"
                  : "text-da-muted"
            }`}
          >
            {step.label}
            {isSkipped && <span className="ml-1 text-xs font-normal">(optional)</span>}
          </span>
        );

        return (
          <div key={step.num} className="flex items-center gap-2">
            {canGoBack ? (
              <button
                type="button"
                onClick={() => onSelect(step.num)}
                title={`Go back to ${step.label}`}
                className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-da-hover focus:outline-none focus:ring-2 focus:ring-da-accent"
              >
                {circle}
                {text}
              </button>
            ) : (
              <>
                {circle}
                {text}
              </>
            )}
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-8 ${isDone ? "bg-green-700/60" : "bg-da-border/50"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
