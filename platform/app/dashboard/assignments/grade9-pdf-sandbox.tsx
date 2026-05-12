"use client";

import { GenericAssignmentSandbox } from "./generic-pdf-sandbox";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft } from "@/lib/assignments";

const grade9Formatting: FormattingRequirements = {
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

const grade9Input: AssignmentInput = {
  gradeLevel: "Grade 9",
  documentKind: "activity-sheet",
  title: "Linear Equations Activity",
  topic: "Solving linear equations and checking solutions",
  learningGoals:
    "Solve one-step and two-step linear equations, justify solution steps, and verify answers by substitution.",
  contextNotes: "Include at least two word problems and one error-analysis question.",
  questionCount: 10,
  challengeMix: "balanced",
  includeRealWorldContext: true,
  tone: "clear",
};

const grade9Draft: AssignmentDraft = {
  title: "Linear Equations Activity",
  subtitle: "Grade 9 Mathematics",
  instructions: [
    "Show all working and use clear mathematical notation.",
    "Check each solution by substitution where possible.",
    "Circle final answers clearly.",
  ],
  sections: [
    {
      heading: "A. Core Practice",
      questions: [
        { prompt: "Solve: 3x + 5 = 23", marks: 2, answer: "x = 6" },
        { prompt: "Solve: 5(2x - 1) = 35", marks: 3, answer: "x = 4" },
      ],
    },
    {
      heading: "B. Application",
      questions: [
        {
          prompt:
            "A concert ticket costs $12 plus a booking fee of $4. If Maya pays $64 in total, write and solve an equation to find how many tickets she bought.",
          marks: 4,
          answer: "12t + 4 = 64, so t = 5 tickets.",
        },
      ],
    },
  ],
};

export function Grade9PdfSandbox() {
  return (
    <GenericAssignmentSandbox
      gradeLevel="Grade 9"
      defaultFormatting={grade9Formatting}
      defaultInput={grade9Input}
      defaultDraft={grade9Draft}
    />
  );
}
