"use client";

import { GenericAssignmentSandbox } from "./generic-pdf-sandbox";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft } from "@/lib/assignments";

const grade11Formatting: FormattingRequirements = {
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

const grade11Input: AssignmentInput = {
  gradeLevel: "Grade 11",
  documentKind: "activity-sheet",
  title: "Trigonometric Identities Practice",
  topic: "Proving and applying trigonometric identities",
  learningGoals: "Prove fundamental identities, simplify trigonometric expressions, and solve equations using identities.",
  contextNotes: "Include proofs, simplifications, and equation-solving tasks.",
  questionCount: 10,
  challengeMix: "balanced",
  includeRealWorldContext: false,
  tone: "exam-style",
};

const grade11Draft: AssignmentDraft = {
  title: "Trigonometric Identities Practice",
  subtitle: "Grade 11 Mathematics",
  instructions: [
    "Clearly state which identities you use in each step.",
    "Work from the more complex side to the simpler side of each equation.",
    "Check solutions in the given domain.",
  ],
  sections: [
    {
      heading: "A. Proof by Identity",
      questions: [
        { prompt: "Prove: sin²(x) + cos²(x) = 1", marks: 3, answer: "By definition of unit circle" },
      ],
    },
  ],
};

export function Grade11PdfSandbox() {
  return (
    <GenericAssignmentSandbox
      gradeLevel="Grade 11"
      defaultFormatting={grade11Formatting}
      defaultInput={grade11Input}
      defaultDraft={grade11Draft}
    />
  );
}
