"use client";

import { useState } from "react";
import { Grade9PdfSandbox } from "./grade9-pdf-sandbox";
import { Grade10PdfSandbox } from "./grade10-pdf-sandbox";
import { Grade11PdfSandbox } from "./grade11-pdf-sandbox";
import { Grade12PdfSandbox } from "./grade12-pdf-sandbox";

type GradeLevel = "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";

export function AssignmentsClient() {
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel>("Grade 9");

  const gradeOptions: Array<{ value: GradeLevel; label: string }> = [
    { value: "Grade 9", label: "Grade 9" },
    { value: "Grade 10", label: "Grade 10" },
    { value: "Grade 11", label: "Grade 11" },
    { value: "Grade 12", label: "Grade 12" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {gradeOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setSelectedGrade(option.value)}
            className={`rounded-lg border px-4 py-2 font-semibold transition-colors ${
              selectedGrade === option.value
                ? "border-da-accent bg-da-accent/20 text-da-accent"
                : "border-da-border bg-da-bg/40 text-da-text hover:border-da-accent/60 hover:bg-da-hover"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {selectedGrade === "Grade 9" && <Grade9PdfSandbox />}
      {selectedGrade === "Grade 10" && <Grade10PdfSandbox />}
      {selectedGrade === "Grade 11" && <Grade11PdfSandbox />}
      {selectedGrade === "Grade 12" && <Grade12PdfSandbox />}
    </div>
  );
}
