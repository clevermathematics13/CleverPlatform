"use client";

import { useState, useCallback } from "react";
import { GenericAssignmentSandbox } from "./generic-pdf-sandbox";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft } from "@/lib/assignments";

// ── Formatting (shared across all Grade 9 packets) ───────────────────────────

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

// ── Unit metadata ─────────────────────────────────────────────────────────────

type UnitMeta = {
  unit: number;
  title: string;
  topic: string;
  subtopics: string;
  learningGoals: string;
  estimatedMinutes: number;
  bridgeToNext: string;
};

const UNIT_META: Record<number, UnitMeta> = {
  1: {
    unit: 1,
    title: "Unit 1 Review: Linear Equations & Expressions",
    topic: "Linear equations, expressions, and algebraic reasoning",
    subtopics: "One- and two-step equations, multi-step equations, distributive property, literal equations",
    learningGoals:
      "Solve and verify one-step, two-step, and multi-step linear equations; apply the distributive property; rearrange literal equations; model real-world situations with equations.",
    estimatedMinutes: 60,
    bridgeToNext:
      "Linear equations form the foundation for solving systems — Unit 2 extends single-variable reasoning to two-variable relationships.",
  },
  2: {
    unit: 2,
    title: "Unit 2 Review: Systems of Equations & Inequalities",
    topic: "Systems of linear equations and inequalities",
    subtopics:
      "Graphing systems, substitution method, elimination method, one-variable inequalities, compound inequalities, graphing linear inequalities",
    learningGoals:
      "Solve systems of equations graphically, by substitution, and by elimination; interpret solutions in context; solve and graph linear and compound inequalities.",
    estimatedMinutes: 60,
    bridgeToNext:
      "Systems and inequalities build toward functions — Unit 3 formalises the idea of a rule that assigns exactly one output to each input.",
  },
  3: {
    unit: 3,
    title: "Unit 3 Review: Introduction to Functions",
    topic: "Functions — definition, notation, representations, and families",
    subtopics:
      "Function definition and vertical line test, domain and range, function notation f(x), evaluating and interpreting functions, linear vs. non-linear functions, graphing from tables and equations",
    learningGoals:
      "Determine whether a relation is a function; identify domain and range from graphs, tables, and equations; use function notation to evaluate and interpret outputs; compare linear and non-linear function families; connect multiple representations (graph, table, equation, verbal).",
    estimatedMinutes: 70,
    bridgeToNext:
      "Functions are the central language of all subsequent mathematics — mastering notation and representations here unlocks quadratics, exponentials, and beyond.",
  },
};

// ── Review packet drafts ──────────────────────────────────────────────────────

const UNIT_DRAFTS: Record<number, AssignmentDraft> = {
  1: {
    title: "Unit 1 Review: Linear Equations & Expressions",
    subtitle: "Grade 9 Mathematics",
    instructions: [
      "Show all algebraic steps — unsupported answers receive no credit.",
      "Check each solution by substituting back into the original equation.",
      "Circle or box your final answer.",
    ],
    sections: [
      {
        heading: "A. One- and Two-Step Equations",
        questions: [
          { prompt: "Solve: $x + 14 = -3$", marks: 1, answer: "$x = -17$" },
          { prompt: "Solve: $\\dfrac{m}{-6} = 8$", marks: 1, answer: "$m = -48$" },
          { prompt: "Solve: $3y - 7 = 20$", marks: 2, answer: "$y = 9$" },
          { prompt: "Solve: $\\dfrac{2w + 4}{3} = 6$", marks: 2, answer: "$w = 7$" },
        ],
      },
      {
        heading: "B. Multi-Step & Distributive Property",
        questions: [
          {
            prompt: "Solve: $4(x - 2) + 3x = 22$",
            marks: 3,
            answer: "$7x - 8 = 22 \\Rightarrow x = \\dfrac{30}{7}$",
          },
          {
            prompt: "Solve: $5 - 2(3k + 1) = -11$",
            marks: 3,
            answer: "$5 - 6k - 2 = -11 \\Rightarrow k = \\dfrac{14}{6} = \\dfrac{7}{3}$",
          },
          {
            prompt: "Solve: $3(2n - 4) = 2(n + 6) - 4$",
            marks: 4,
            answer: "$6n - 12 = 2n + 8 \\Rightarrow n = 5$",
          },
        ],
      },
      {
        heading: "C. Literal Equations",
        questions: [
          {
            prompt: "Rearrange $P = 2l + 2w$ to isolate $w$.",
            marks: 2,
            answer: "$w = \\dfrac{P - 2l}{2}$",
          },
          {
            prompt: "Rearrange $A = \\dfrac{1}{2}bh$ to isolate $h$.",
            marks: 2,
            answer: "$h = \\dfrac{2A}{b}$",
          },
        ],
      },
      {
        heading: "D. Word Problems",
        questions: [
          {
            prompt:
              "A phone plan charges a flat fee of \\$15 per month plus \\$0.10 per text message. Write and solve an equation to find how many texts Amara can send if her monthly budget is \\$27.",
            marks: 4,
            answer: "$15 + 0.10t = 27 \\Rightarrow t = 120$ texts",
          },
          {
            prompt:
              "Two friends start with the same amount of money. After Kenji spends \\$18 and Priya spends \\$7, Priya has twice as much as Kenji. How much did they each start with?",
            marks: 5,
            answer:
              "Let $x$ = starting amount. $x - 7 = 2(x - 18) \\Rightarrow x = 29$. They each started with \\$29.",
          },
        ],
      },
    ],
  },

  2: {
    title: "Unit 2 Review: Systems of Equations & Inequalities",
    subtitle: "Grade 9 Mathematics",
    instructions: [
      "For systems, identify the method you will use before solving.",
      "Show full algebraic working for substitution and elimination.",
      "For inequalities, graph your solution on a number line where indicated.",
    ],
    sections: [
      {
        heading: "A. Solving Systems — Graphing",
        questions: [
          {
            prompt:
              "Graph the system and state the solution: $y = 2x - 1$ and $y = -x + 5$. Verify your solution algebraically.",
            marks: 4,
            answer: "Lines intersect at $(2, 3)$. Check: $3 = 2(2)-1 = 3$ ✓ and $3 = -2+5 = 3$ ✓.",
          },
        ],
      },
      {
        heading: "B. Solving Systems — Substitution",
        questions: [
          {
            prompt: "Solve by substitution: $y = 3x - 4$ and $2x + y = 11$",
            marks: 3,
            answer: "$2x + (3x-4) = 11 \\Rightarrow x = 3,\\ y = 5$",
          },
          {
            prompt: "Solve by substitution: $x = 2y + 1$ and $3x - 4y = 7$",
            marks: 4,
            answer:
              "$3(2y+1) - 4y = 7 \\Rightarrow 2y = 4 \\Rightarrow y = 2,\\ x = 5$",
          },
        ],
      },
      {
        heading: "C. Solving Systems — Elimination",
        questions: [
          {
            prompt: "Solve by elimination: $3x + 2y = 16$ and $x - 2y = 0$",
            marks: 3,
            answer: "Add equations: $4x = 16 \\Rightarrow x = 4,\\ y = 2$",
          },
          {
            prompt: "Solve by elimination: $2x + 3y = 13$ and $5x - 3y = 1$",
            marks: 4,
            answer: "Add: $7x = 14 \\Rightarrow x = 2,\\ y = 3$",
          },
        ],
      },
      {
        heading: "D. Inequalities",
        questions: [
          {
            prompt: "Solve and graph on a number line: $3x - 5 > 7$",
            marks: 2,
            answer: "$x > 4$ — open circle at 4, arrow right.",
          },
          {
            prompt:
              "Solve: $-4 \\leq 2x + 2 < 10$ and write the solution in interval notation.",
            marks: 3,
            answer: "$-3 \\leq x < 4$, i.e. $[-3, 4)$.",
          },
          {
            prompt:
              "A school hall can hold at most 300 people. There are already 127 adults seated. Write and solve an inequality to find the maximum number of students $s$ who can still enter.",
            marks: 3,
            answer: "$127 + s \\leq 300 \\Rightarrow s \\leq 173$",
          },
        ],
      },
      {
        heading: "E. Application",
        questions: [
          {
            prompt:
              "A cinema charges \\$9 for adults and \\$6 for children. On Saturday, 200 tickets were sold for a total of \\$1{,}500. How many of each ticket type were sold?",
            marks: 5,
            answer:
              "Let $a$ = adults, $c$ = children. System: $a + c = 200$ and $9a + 6c = 1500$. Solving: $a = 100,\\ c = 100$.",
          },
        ],
      },
    ],
  },

  3: {
    title: "Unit 3 Review: Introduction to Functions",
    subtitle: "Grade 9 Mathematics",
    instructions: [
      "For each relation, clearly justify whether it is or is not a function.",
      "State domain and range using set notation or interval notation as appropriate.",
      "Show all steps when evaluating using function notation.",
    ],
    sections: [
      {
        heading: "A. Relations vs. Functions",
        questions: [
          {
            prompt:
              "State whether each relation is a function. Justify your answer.\n(a) $\\{(1, 3),\\ (2, 5),\\ (3, 3),\\ (4, 7)\\}$\n(b) $\\{(2, 4),\\ (2, -4),\\ (3, 5)\\}$\n(c) A mapping where every student in a class is assigned exactly one seat number.",
            marks: 3,
            answer:
              "(a) Function — each input maps to exactly one output. (b) Not a function — input 2 maps to two outputs. (c) Function — one-to-one assignment.",
          },
          {
            prompt:
              "Apply the vertical line test to determine which of the following graphs represent functions. Explain your reasoning.",
            marks: 2,
            answer:
              "Any vertical line intersects a function's graph at most once. A circle fails the test; a parabola opening up/down passes.",
          },
        ],
      },
      {
        heading: "B. Domain and Range",
        questions: [
          {
            prompt: "For $f(x) = \\dfrac{1}{x - 3}$, state the domain.",
            marks: 2,
            answer: "$x \\in \\mathbb{R},\\ x \\neq 3$",
          },
          {
            prompt:
              "A function is defined by the table below. State its domain and range.\n\\[\n\\begin{array}{c|c} x & f(x) \\\\ \\hline -2 & 5 \\\\ 0 & 1 \\\\ 1 & -3 \\\\ 4 & 5 \\end{array}\n\\]",
            marks: 2,
            answer: "Domain: $\\{-2, 0, 1, 4\\}$ — Range: $\\{-3, 1, 5\\}$",
          },
          {
            prompt:
              "Sketch a graph with domain $[-3, 3]$ and range $[0, 4]$ that passes the vertical line test.",
            marks: 2,
            answer:
              "Any curve (e.g. a parabola) contained within the rectangle $[-3,3] \\times [0,4]$ that passes the VLT.",
          },
        ],
      },
      {
        heading: "C. Function Notation",
        questions: [
          {
            prompt:
              "Let $f(x) = 2x^2 - 3x + 1$. Find:\n(a) $f(0)$\n(b) $f(-2)$\n(c) $f(a + 1)$ in simplified form",
            marks: 4,
            answer:
              "(a) $f(0) = 1$\n(b) $f(-2) = 2(4) + 6 + 1 = 15$\n(c) $f(a+1) = 2(a+1)^2 - 3(a+1) + 1 = 2a^2 + a$",
          },
          {
            prompt: "Given $g(x) = 5 - 3x$, solve for $x$ when $g(x) = -4$.",
            marks: 2,
            answer: "$5 - 3x = -4 \\Rightarrow x = 3$",
          },
          {
            prompt:
              "The function $h(t) = -5t^2 + 20t$ models the height (in metres) of a ball $t$ seconds after it is launched.\n(a) Find $h(0)$ and interpret the result.\n(b) Find the height at $t = 2$ s.\n(c) At what time(s) is $h(t) = 15$?",
            marks: 6,
            answer:
              "(a) $h(0) = 0$ — ball starts at ground level.\n(b) $h(2) = -20 + 40 = 20$ m.\n(c) $-5t^2 + 20t = 15 \\Rightarrow t^2 - 4t + 3 = 0 \\Rightarrow t = 1$ or $t = 3$.",
          },
        ],
      },
      {
        heading: "D. Representations & Families",
        questions: [
          {
            prompt:
              "Complete the table of values for $f(x) = x^2 - 2$, then sketch the graph for $x \\in [-3, 3]$. Identify the shape of the graph and its family.",
            marks: 4,
            answer:
              "Table: $(-3, 7), (-2, 2), (-1, -1), (0, -2), (1, -1), (2, 2), (3, 7)$. Parabola — quadratic function family.",
          },
          {
            prompt:
              "Explain in your own words the difference between a linear function and a non-linear function. Give one example of each and describe how their graphs differ.",
            marks: 3,
            answer:
              "A linear function has a constant rate of change — its graph is a straight line (e.g. $y = 2x + 1$). A non-linear function has a varying rate of change — its graph is curved (e.g. $y = x^2$).",
          },
          {
            prompt:
              "A taxi company charges a flat fee of \\$3 plus \\$2 per kilometre.\n(a) Write a function $C(d)$ for the total cost of a ride of $d$ km.\n(b) Find $C(7)$ and interpret the result.\n(c) For what distance is the cost exactly \\$19?",
            marks: 5,
            answer:
              "(a) $C(d) = 2d + 3$\n(b) $C(7) = 17$ — a 7 km ride costs \\$17.\n(c) $2d + 3 = 19 \\Rightarrow d = 8$ km.",
          },
        ],
      },
    ],
  },
};

// ── Unit input configs ────────────────────────────────────────────────────────

function makeUnitInput(unit: number): AssignmentInput {
  const meta = UNIT_META[unit]!;
  return {
    gradeLevel: "Grade 9",
    documentKind: "review-packet",
    title: meta.title,
    topic: meta.topic,
    learningGoals: meta.learningGoals,
    contextNotes: `Grade 9 Unit ${unit} review. Subtopics: ${meta.subtopics}. ${meta.bridgeToNext}`,
    questionCount: 12,
    challengeMix: "balanced",
    includeRealWorldContext: true,
    tone: "clear",
  };
}

// ── Unit selector panel ───────────────────────────────────────────────────────

type UnitSelectorProps = {
  onSelect: (draft: AssignmentDraft, input: AssignmentInput) => void;
};

const UNIT_COLORS: Record<number, { bg: string; ring: string; badge: string }> = {
  1: { bg: "bg-sky-600",     ring: "ring-sky-400",    badge: "bg-sky-500/20 border-sky-500/40 text-sky-300" },
  2: { bg: "bg-violet-600",  ring: "ring-violet-400", badge: "bg-violet-500/20 border-violet-500/40 text-violet-300" },
  3: { bg: "bg-emerald-600", ring: "ring-emerald-400",badge: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" },
};

function UnitSelector({ onSelect }: UnitSelectorProps) {
  const [expandedUnit, setExpandedUnit] = useState<number | null>(null);

  const handleLoad = useCallback(
    (unitNum: number) => {
      const draft = UNIT_DRAFTS[unitNum];
      const input = makeUnitInput(unitNum);
      if (!draft || !input) return;
      onSelect(draft, input);
    },
    [onSelect]
  );

  return (
    <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">
        📦 Grade 9 Review Packets
      </h3>
      <p className="text-xs text-da-muted leading-relaxed">
        Three pre-built review packets — one per unit. Click a unit to preview its details, then
        load it into the sandbox below. Use the AI Activity Generator to extend or customise any packet.
      </p>

      <div className="space-y-1.5">
        {Object.entries(UNIT_META).map(([key, meta]) => {
          const unitNum = Number(key);
          const isExpanded = expandedUnit === unitNum;
          const colors = UNIT_COLORS[unitNum]!;
          const draft = UNIT_DRAFTS[unitNum]!;
          const totalMarks = draft.sections.reduce(
            (sum, s) => sum + s.questions.reduce((q, question) => q + (question.marks ?? 0), 0),
            0
          );
          const questionCount = draft.sections.reduce((sum, s) => sum + s.questions.length, 0);

          return (
            <div
              key={key}
              className="rounded-lg border border-da-border/50 bg-da-bg/30 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpandedUnit(isExpanded ? null : unitNum)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-da-hover transition-colors"
              >
                <span
                  className={`flex items-center justify-center h-7 w-7 rounded-full ${colors.bg} text-white text-xs font-bold flex-shrink-0`}
                >
                  {unitNum}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-da-text truncate">{meta.title}</p>
                  <p className="text-xs text-da-muted truncate">
                    {meta.topic} · {meta.estimatedMinutes} min · {questionCount} questions · {totalMarks} marks
                  </p>
                </div>
                <span className="flex-shrink-0 text-xs text-da-muted">
                  {isExpanded ? "▲" : "▼"}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-2 border-t border-da-border/30 space-y-2.5">
                  <p className="text-xs text-da-text leading-relaxed">
                    <span className="font-bold text-da-accent">Learning Goals:</span>{" "}
                    {meta.learningGoals}
                  </p>
                  <p className="text-xs text-da-text leading-relaxed">
                    <span className="font-bold text-da-accent">Subtopics:</span>{" "}
                    {meta.subtopics}
                  </p>
                  <p className="text-xs text-da-muted italic leading-relaxed">
                    🔗 {meta.bridgeToNext}
                  </p>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {draft.sections.map((s) => (
                      <span
                        key={s.heading}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colors.badge}`}
                      >
                        {s.heading}
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleLoad(unitNum)}
                    className={`w-full rounded-lg ${colors.bg} px-3 py-2 text-xs font-bold text-white hover:opacity-90 transition-opacity`}
                  >
                    Load Unit {unitNum} Packet into Sandbox
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

// ── Main component ────────────────────────────────────────────────────────────

type Grade9Mode = "units" | "freeform";

const defaultFreeformInput: AssignmentInput = {
  gradeLevel: "Grade 9",
  documentKind: "activity-sheet",
  title: "Grade 9 Mathematics Activity",
  topic: "Describe the topic here",
  learningGoals: "Add your learning goals here.",
  contextNotes: "",
  questionCount: 10,
  challengeMix: "balanced",
  includeRealWorldContext: true,
  tone: "clear",
};

const defaultFreeformDraft: AssignmentDraft = {
  title: "Grade 9 Mathematics Activity",
  subtitle: "Grade 9 Mathematics",
  instructions: [
    "Show all working clearly.",
    "Circle or box your final answer.",
  ],
  sections: [
    {
      heading: "A. Practice",
      questions: [
        { prompt: "Question 1", marks: 2, answer: "" },
      ],
    },
  ],
};

export function Grade9PdfSandbox() {
  const [mode, setMode] = useState<Grade9Mode>("units");
  const [activeDraft, setActiveDraft] = useState<AssignmentDraft>(UNIT_DRAFTS[1]!);
  const [activeInput, setActiveInput] = useState<AssignmentInput>(() => makeUnitInput(1));

  const handleUnitSelect = useCallback(
    (draft: AssignmentDraft, input: AssignmentInput) => {
      setActiveDraft(draft);
      setActiveInput(input);
    },
    []
  );

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("units")}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            mode === "units"
              ? "bg-sky-600 text-white"
              : "border border-da-border text-da-muted hover:text-da-text"
          }`}
        >
          📦 Unit Review Packets
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("freeform");
            setActiveDraft(defaultFreeformDraft);
            setActiveInput(defaultFreeformInput);
          }}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            mode === "freeform"
              ? "bg-amber-500 text-white"
              : "border border-da-border text-da-muted hover:text-da-text"
          }`}
        >
          📝 Freeform Sandbox
        </button>
      </div>

      {/* Unit selector panel */}
      {mode === "units" && (
        <UnitSelector onSelect={handleUnitSelect} />
      )}

      {/* Sandbox — key forces remount when draft changes so preview refreshes */}
      <div key={activeDraft.title}>
        <GenericAssignmentSandbox
          gradeLevel="Grade 9"
          defaultFormatting={grade9Formatting}
          defaultInput={activeInput}
          defaultDraft={activeDraft}
        />
      </div>
    </div>
  );
}
