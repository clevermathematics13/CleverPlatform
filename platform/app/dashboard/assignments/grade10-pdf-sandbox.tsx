"use client";

import { GenericAssignmentSandbox } from "./generic-pdf-sandbox";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft } from "@/lib/assignments";

const grade10Formatting: FormattingRequirements = {
  schoolName: "CleverPlatform Mathematics",
  teacherName: "",
  includeNameLine: true,
  includeDateLine: true,
  includeMarksColumn: true,
  includeAnswerKey: false,
  fontSize: 11,
  lineSpacing: "normal",
  pageMarginsMm: 16,
  numberingStyle: "numeric",
};

const grade10Input: AssignmentInput = {
  gradeLevel: "Grade 10",
  documentKind: "activity-sheet",
  title: "Quadratic Functions Activity",
  topic: "Analyzing and solving quadratic functions",
  learningGoals: "Identify key features of quadratic functions, solve by factoring and completing the square, and apply to real-world contexts.",
  contextNotes: "Include at least one application problem and one graphing task.",
  questionCount: 12,
  challengeMix: "balanced",
  includeRealWorldContext: true,
  tone: "clear",
};

const grade10Draft: AssignmentDraft = {
  title: "Quadratic Functions Activity",
  subtitle: "Grade 10 Mathematics",
  instructions: [
    "Show all algebraic steps clearly.",
    "For graphing questions, identify the vertex, axis of symmetry, and intercepts.",
    "Check factored forms by expanding.",
  ],
  sections: [
    {
      heading: "A. Solving by Factoring",
      questions: [
        { prompt: "Solve: x² + 7x + 12 = 0", marks: 2, answer: "x = -3 or x = -4" },
      ],
    },
  ],
};

export function Grade10PdfSandbox() {
  return (
    <GenericAssignmentSandbox
      gradeLevel="Grade 10"
      defaultFormatting={grade10Formatting}
      defaultInput={grade10Input}
      defaultDraft={grade10Draft}
    />
  );
}
