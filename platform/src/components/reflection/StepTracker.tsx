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
                ? "bg-green-500 text-white"
                : step.num === current
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-500"
            }`}
          >
            {step.num < current ? "✓" : step.num}
          </div>
          <span
            className={`text-base font-bold ${
              step.num === current
                ? "text-blue-900"
                : step.num < current
                  ? "text-green-700"
                  : "text-gray-500"
            }`}
          >
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <div
              className={`h-0.5 w-8 ${
                step.num < current ? "bg-green-500" : "bg-gray-200"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
