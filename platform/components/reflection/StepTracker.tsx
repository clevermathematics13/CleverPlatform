"use client";

import type { ReflectionStep } from "@/lib/reflection-types";

const STEPS = [
  { num: 1 as const, label: "Self-Grade" },
  { num: 2 as const, label: "Compare" },
  { num: 3 as const, label: "Upload Corrections" },
  { num: 4 as const, label: "Done" },
];

export function StepTracker({ current }: { current: ReflectionStep }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((step, i) => (
        <div key={step.num} className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
              step.num < current
                ? "bg-green-700/70 text-da-text"
                : step.num === current
                  ? "bg-da-accent text-da-bg"
                  : "bg-da-surface border border-da-border text-da-muted"
            }`}
          >
            {step.num < current ? "✓" : step.num}
          </div>
          <span
            className={`text-base font-bold ${
              step.num === current
                ? "text-da-amber"
                : step.num < current
                  ? "text-green-400"
                  : "text-da-muted"
            }`}
          >
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <div
              className={`h-0.5 w-8 ${
                step.num < current ? "bg-green-700/60" : "bg-da-border/50"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
