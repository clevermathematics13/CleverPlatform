"use client";

import { useState, useCallback } from "react";
import { GenericAssignmentSandbox } from "./generic-pdf-sandbox";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft } from "@/lib/assignments";
import {
  ALL_ACTIVITY_DRAFTS,
  ACTIVITY_META,
} from "@/lib/calculus-activity-sheets";

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
          answer: "r = (250/\u03c0)^(1/3), h = 2r",
        },
      ],
    },
  ],
};

type ActivitySelectorProps = {
  onSelect: (draft: AssignmentDraft, input: AssignmentInput) => void;
};

function ActivitySelector({ onSelect }: ActivitySelectorProps) {
  const [expandedActivity, setExpandedActivity] = useState<number | null>(null);

  const handleLoad = useCallback(
    (stageNum: number) => {
      const draft = ALL_ACTIVITY_DRAFTS[stageNum];
      const meta = ACTIVITY_META[stageNum];
      if (!draft || !meta) return;

      const input: AssignmentInput = {
        gradeLevel: "Grade 12",
        documentKind: "activity-sheet",
        title: meta.title,
        topic: `${meta.functionFamily} \u2014 ${meta.theme}`,
        learningGoals:
          "Progressive mastery of limits, continuity, and differentiability\u2014strictly restricting derivative shortcuts until formally proven via the difference quotient.",
        contextNotes: `IBDP AA HL Function-Family Approach. ${meta.bridgeToNext}`,
        questionCount: 12,
        challengeMix: "challenge-forward",
        includeRealWorldContext: true,
        tone: "discovery",
      };

      onSelect(draft, input);
    },
    [onSelect]
  );

  return (
    <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">
        \ud83c\udf93 Calculus Activity Sheets (IB AA HL)
      </h3>
      <p className="text-xs text-da-muted">
        5 interconnected 2-hour activities covering all function families. Each
        includes numerical exploration, algebraic formalisation, proof, TOK
        reflection, and bridge questions.
      </p>
      <div className="space-y-1">
        {Object.entries(ACTIVITY_META).map(([key, meta]) => {
          const stageNum = Number(key);
          const isExpanded = expandedActivity === stageNum;
          const marksSummary = ALL_ACTIVITY_DRAFTS[stageNum]?.sections
            .filter((s) => !s.heading.includes("TOK") && !s.heading.includes("Bridge") && !s.heading.includes("Reflection"))
            .reduce((sum, s) => sum + s.questions.reduce((qsum, q) => qsum + (q.marks ?? 0), 0), 0) ?? 0;

          return (
            <div
              key={key}
              className="rounded-lg border border-da-border/50 bg-da-bg/30 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpandedActivity(isExpanded ? null : stageNum)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-da-hover transition-colors"
              >
                <span className="flex items-center justify-center h-7 w-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex-shrink-0">
                  {key}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-da-text truncate">
                    {meta.title}
                  </p>
                  <p className="text-xs text-da-muted truncate">
                    {meta.functionFamily} \u00b7 {meta.estimatedMinutes} min \u00b7 ~{marksSummary} marks
                  </p>
                </div>
                <span className="flex-shrink-0 text-xs text-da-muted">
                  {isExpanded ? "\u25B2" : "\u25BC"}
                </span>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-da-border/30 space-y-2">
                  <p className="text-xs text-da-text leading-relaxed">
                    <span className="font-bold text-indigo-500">Theme:</span>{" "}
                    {meta.theme}
                  </p>
                  <p className="text-xs text-da-text leading-relaxed">
                    <span className="font-bold text-indigo-500">Family:</span>{" "}
                    {meta.functionFamily}
                  </p>
                  <p className="text-xs text-da-text leading-relaxed">
                    <span className="font-bold text-indigo-500">
                      Bridge:
                    </span>{" "}
                    {meta.bridgeToNext}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleLoad(stageNum)}
                    className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition-colors"
                  >
                    Load This Activity Sheet
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Grade12SandboxMode = "default" | "activity";

export function Grade12PdfSandbox() {
  const [mode, setMode] = useState<Grade12SandboxMode>("activity");
  const [activityDraft, setActivityDraft] = useState<AssignmentDraft>(
    ALL_ACTIVITY_DRAFTS[1]
  );
  const [activityInput, setActivityInput] = useState<AssignmentInput>(() => {
    const meta = ACTIVITY_META[1];
    return {
      gradeLevel: "Grade 12",
      documentKind: "activity-sheet",
      title: meta.title,
      topic: `${meta.functionFamily} \u2014 ${meta.theme}`,
      learningGoals:
        "Progressive mastery of limits, continuity, and differentiability\u2014strictly restricting derivative shortcuts until formally proven via the difference quotient.",
      contextNotes: `IBDP AA HL Function-Family Approach. ${meta.bridgeToNext}`,
      questionCount: 12,
      challengeMix: "challenge-forward",
      includeRealWorldContext: true,
      tone: "discovery",
    };
  });

  const handleActivitySelect = useCallback(
    (draft: AssignmentDraft, input: AssignmentInput) => {
      setActivityDraft(draft);
      setActivityInput(input);
    },
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("activity")}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            mode === "activity"
              ? "bg-indigo-600 text-white"
              : "border border-da-border text-da-muted hover:text-da-text"
          }`}
        >
          \ud83c\udf93 Calculus Activity Sheets (IB AA HL)
        </button>
        <button
          type="button"
          onClick={() => setMode("default")}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            mode === "default"
              ? "bg-amber-500 text-white"
              : "border border-da-border text-da-muted hover:text-da-text"
          }`}
        >
          \ud83d\udcdd General Grade 12 Sandbox
        </button>
      </div>

      {mode === "activity" && (
        <ActivitySelector onSelect={handleActivitySelect} />
      )}

      <div key={mode === "activity" ? activityDraft.title : "default-grade12"}>
        <GenericAssignmentSandbox
          gradeLevel="Grade 12"
          defaultFormatting={grade12Formatting}
          defaultInput={mode === "activity" ? activityInput : grade12Input}
          defaultDraft={mode === "activity" ? activityDraft : grade12Draft}
        />
      </div>
    </div>
  );
}
