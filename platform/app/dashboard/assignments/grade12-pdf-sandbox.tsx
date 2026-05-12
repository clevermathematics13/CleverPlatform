"use client";

import { GenericAssignmentSandbox } from "../generic-pdf-sandbox";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft } from "@/lib/assignments";

const grade12Formatting: FormattingRequirements = {
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

const grade12Input: AssignmentInput = {
  gradeLevel: "Grade 12",
  documentKind: "activity-sheet",
  title: "Calculus Applications Investigation",
  topic: "Optimization and rate of change applications",
  learningGoals: "Apply derivatives to find extrema, analyze rates of change, and optimize real-world quantities.",
  contextNotes: "Include context-rich optimization problems and derivative applications.",
  questionCount: 8,
  challengeMix: "challenge-forward",
  includeRealWorldContext: true,
  tone: "discovery",
};

const grade12Draft: AssignmentDraft = {
  title: "Calculus Applications Investigation",
  subtitle: "Grade 12 Mathematics",
  instructions: [
    "Identify variables and set up equations carefully.",
    "Show derivative work and critical point analysis.",
    "Justify why critical points are maxima, minima, or neither.",
    "Interpret results in the context of the problem.",
  ],
  sections: [
    {
      heading: "A. Optimization",
      questions: [
        {
          prompt: "A cylindrical can is to hold 500 mL. Find the dimensions that minimize surface area.",
          marks: 5,
          answer: "r = (250/π)^(1/3), h = 2r",
        },
      ],
    },
  ],
};

export function Grade12PdfSandbox() {
  return (
    <GenericAssignmentSandbox
      gradeLevel="Grade 12"
      defaultFormatting={grade12Formatting}
      defaultInput={grade12Input}
      defaultDraft={grade12Draft}
    />
  );
}
