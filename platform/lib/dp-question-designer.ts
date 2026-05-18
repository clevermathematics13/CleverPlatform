// Types and utilities for the DP (Diploma Programme) question designer
// Uses DeepSeek to generate IB DP curriculum modules

export type Curriculum = "AA" | "AI";
export type Level = "HL" | "SL";

export type DPQuestionDesignerInput = {
  title: string;
  course: string;
  targetGradeLevel: number;
  assessmentTracker: string;
  pedagogicalGoal: string;
  functionFamilies: string[];
  stageCount: number;
  includeTOKLinks: boolean;
  includeExplorationActivities: boolean;
  includeKeyProofs: boolean;
  tone: "rigorous" | "discovery" | "exam-focused";
};

export type KeyProof = {
  name: string;
  description: string;
};

export type ExplorationActivity = {
  title: string;
  setup: string;
  task: string;
  rigor: string;
};

export type CurriculumStage = {
  stage_number: number;
  function_family: string;
  theme: string;
  core_vocabulary: string[];
  key_proofs: KeyProof[];
  exploration_activity: ExplorationActivity | null;
  tok_link: string | null;
};

export type CurriculumModule = {
  title: string;
  course: string;
  target_grade_level: number;
  assessment_tracker: string;
  pedagogical_goal: string;
  stages: CurriculumStage[];
};

export type DPDesignerTemplate = {
  id: string;
  template_name: string;
  curriculum: Curriculum;
  level: Level;
  input: DPQuestionDesignerInput;
  module: CurriculumModule | null;
  created_at: string;
  updated_at: string;
};

export type DeepSeekTextBlock = {
  type: string;
  text?: string;
};

export type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

export function buildDPSystemPrompt(): string {
  return [
    "You are an expert IB Diploma Programme (DP) Mathematics curriculum designer.",
    "You specialize in creating structured, progressive curriculum modules for AA and AI courses at both HL and SL.",
    "Output only valid JSON.",
    "Return a single object with this exact shape:",
    "{",
    '  "title": string,',
    '  "course": string,  // e.g. "IBDP Mathematics AA HL"',
    '  "target_grade_level": number,',
    '  "assessment_tracker": string,',
    '  "pedagogical_goal": string,',
    '  "stages": [',
    "    {",
    '      "stage_number": number,',
    '      "function_family": string,',
    '      "theme": string,',
    '      "core_vocabulary": string[],',
    '      "key_proofs": [',
    "        {",
    '          "name": string,',
    '          "description": string',
    "        }",
    "      ],",
    '      "exploration_activity": {',
    '        "title": string,',
    '        "setup": string,',
    '        "task": string,',
    '        "rigor": string',
    "      } | null,",
    '      "tok_link": string | null',
    "    }",
    "  ]",
    "}",
    "",
    "Guidelines:",
    "- Each stage must focus on a single function family (e.g., Polynomial, Rational, Exponential, Trigonometric, Inverse Trigonometric).",
    "- Core vocabulary should be 4-8 precise mathematical terms relevant to the stage.",
    "- Key proofs must be mathematically rigorous and appropriate for IB DP level.",
    "- Exploration activities should guide students from numerical/concrete investigation to formal abstraction.",
    "- TOK links should be thought-provoking philosophical questions connecting the mathematics to knowledge theory.",
    "- Use LaTeX for all mathematical notation (e.g., $x^2$, $\\frac{dy}{dx}$, $\\lim_{h \\to 0}$).",
    "- Ensure the module progresses logically from foundational to advanced concepts.",
    "- Stages should build on each other where appropriate.",
    "- Vocabulary, proofs, and activities must be age-appropriate for the target grade level.",
    "- Keep descriptions clear and academically precise.",
  ].join("\n");
}

export function buildDPUserPrompt(
  input: DPQuestionDesignerInput
): string {
  const lines: string[] = [
    `Create an IB DP Mathematics curriculum module with the following specifications:`,
    `Title: ${input.title}`,
    `Course: ${input.course}`,
    `Target grade level: ${input.targetGradeLevel}`,
    `Assessment tracker: ${input.assessmentTracker}`,
    `Pedagogical goal: ${input.pedagogicalGoal}`,
    `Number of stages: ${input.stageCount}`,
    `Function families to cover (in order): ${input.functionFamilies.join(", ")}`,
    `Tone: ${input.tone}`,
  ];

  if (input.includeTOKLinks) {
    lines.push("Include a thought-provoking TOK (Theory of Knowledge) link for each stage.");
  }
  if (input.includeExplorationActivities) {
    lines.push("Include an exploration activity for each stage that progresses from concrete investigation to formal abstraction.");
  }
  if (input.includeKeyProofs) {
    lines.push("Include 1-2 key mathematical proofs per stage that are appropriate for IB DP level.");
  }

  lines.push("");
  lines.push("Each stage should have a compelling theme name that captures the essence of that function family.");
  lines.push("Ensure all mathematical content is in proper LaTeX notation.");
  lines.push("Return only valid JSON with no additional text.");

  return lines.join("\n");
}

export const FUNCTION_FAMILY_PRESETS: Record<string, string[]> = {
  AA_HL: [
    "Polynomial Functions",
    "Rational Functions",
    "Exponential & Logarithmic Functions",
    "Trigonometric Functions",
    "Inverse & Reciprocal Trigonometric Functions",
  ],
  AA_SL: [
    "Polynomial Functions",
    "Rational Functions",
    "Exponential & Logarithmic Functions",
    "Trigonometric Functions",
  ],
  AI_HL: [
    "Linear & Quadratic Functions",
    "Exponential & Logarithmic Functions",
    "Trigonometric Functions",
    "Probability Distributions",
    "Differential Equations",
  ],
  AI_SL: [
    "Linear & Quadratic Functions",
    "Exponential & Logarithmic Functions",
    "Trigonometric Functions",
    "Probability & Statistics Functions",
  ],
};

export const DEFAULT_DP_INPUT: DPQuestionDesignerInput = {
  title: "Foundations of Calculus: A Function-Family Approach to Limits",
  course: "IBDP Mathematics AA HL",
  targetGradeLevel: 12,
  assessmentTracker: "Clev's Marks",
  pedagogicalGoal:
    "Progressive mastery of limits, continuity, and differentiability, strictly restricting derivative shortcuts until formally proven via the difference quotient.",
  functionFamilies: FUNCTION_FAMILY_PRESETS["AA_HL"],
  stageCount: 5,
  includeTOKLinks: true,
  includeExplorationActivities: true,
  includeKeyProofs: true,
  tone: "rigorous",
};

export function extractJsonObject(input: string): string {
  const first = input.indexOf("{");
  const last = input.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("AI response did not include a JSON object.");
  }
  return input.slice(first, last + 1);
}

export function sanitizeCurriculumModule(raw: Record<string, unknown>): CurriculumModule {
  const title = typeof raw.title === "string" ? raw.title.trim() : "Untitled Module";
  const course = typeof raw.course === "string" ? raw.course.trim() : "IBDP Mathematics";
  const targetGradeLevel = clampInt(Number(raw.target_grade_level ?? 12), 9, 12);
  const assessmentTracker = typeof raw.assessment_tracker === "string" ? raw.assessment_tracker.trim() : "Clev's Marks";
  const pedagogicalGoal = typeof raw.pedagogical_goal === "string" ? raw.pedagogical_goal.trim() : "";

  const rawStages = Array.isArray(raw.stages) ? raw.stages : [];

  const stages: CurriculumStage[] = rawStages
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
    .map((s, idx) => {
      const rawProofs = Array.isArray(s.key_proofs) ? s.key_proofs : [];
      const keyProofs: KeyProof[] = rawProofs
        .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
        .map((p) => ({
          name: typeof p.name === "string" ? p.name.trim() : "Unnamed Proof",
          description: typeof p.description === "string" ? p.description.trim() : "",
        }))
        .filter((p) => p.name.length > 0);

      let explorationActivity: ExplorationActivity | null = null;
      if (s.exploration_activity && typeof s.exploration_activity === "object") {
        const ea = s.exploration_activity as Record<string, unknown>;
        explorationActivity = {
          title: typeof ea.title === "string" ? ea.title.trim() : "",
          setup: typeof ea.setup === "string" ? ea.setup.trim() : "",
          task: typeof ea.task === "string" ? ea.task.trim() : "",
          rigor: typeof ea.rigor === "string" ? ea.rigor.trim() : "",
        };
        if (!explorationActivity.title) explorationActivity = null;
      }

      const coreVocab = Array.isArray(s.core_vocabulary)
        ? s.core_vocabulary.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];

      const tokLink = typeof s.tok_link === "string" && s.tok_link.trim().length > 0
        ? s.tok_link.trim()
        : null;

      return {
        stage_number: typeof s.stage_number === "number" ? s.stage_number : idx + 1,
        function_family: typeof s.function_family === "string" ? s.function_family.trim() : `Stage ${idx + 1}`,
        theme: typeof s.theme === "string" ? s.theme.trim() : "Untitled Stage",
        core_vocabulary: coreVocab,
        key_proofs: keyProofs,
        exploration_activity: explorationActivity,
        tok_link: tokLink,
      };
    })
    .filter((s) => s.function_family.length > 0);

  return {
    title,
    course,
    target_grade_level: targetGradeLevel,
    assessment_tracker: assessmentTracker,
    pedagogical_goal: pedagogicalGoal,
    stages,
  };
}