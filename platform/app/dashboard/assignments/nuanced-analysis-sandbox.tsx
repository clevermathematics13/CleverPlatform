"use client";

import { GenericAssignmentSandbox } from "./generic-pdf-sandbox";
import type { FormattingRequirements, AssignmentInput, AssignmentDraft } from "@/lib/assignments";

// ──────────────────────────────────────────────────────────────────────────────
// Defaults for a DP Nuanced Analysis packet.
// These follow the DESIGN_INSTRUCTIONS.md spec:
//   – Paper 1 / Paper 3 alignment
//   – Multi-topic thread (Topics 1, 3, 5 by default)
//   – Conjecture → proof → application → reflection arc
//   – Command terms, vocabulary defined before use, American English
// ──────────────────────────────────────────────────────────────────────────────

const naFormatting: FormattingRequirements = {
  schoolName: "CleverPlatform Mathematics",
  teacherName: "",
  includeNameLine: true,
  includeDateLine: true,
  includeMarksColumn: true,
  includeAnswerKey: false,
  fontSize: 11,
  lineSpacing: "relaxed",
  pageMarginsMm: 16,
  numberingStyle: "numeric",
};

const naInput: AssignmentInput = {
  gradeLevel: "Grade 12",
  documentKind: "investigation",
  title: "Nuanced Analysis",
  topic:
    "A multi-part guided investigation that weaves at least two IB DP syllabus topics into a single mathematical thread.",
  learningGoals:
    "Build representational fluency: the same mathematical object seen as algebra, geometry, series, diagram, and real-world model. " +
    "Move through conjecture → investigation → proof → application → reflection. " +
    "Use precise IB command terms throughout. " +
    "Define all vocabulary before first use. " +
    "Apply the DESIGN_INSTRUCTIONS rules: tiered entry points (★ / ★★ / ★★★), " +
    "micro-box at each Part start, planted error task, translation table, Teacher's Companion at the end.",
  contextNotes:
    "Follow the Nuanced Analysis design rules from DESIGN_INSTRUCTIONS.md. " +
    "Include: (1) Command Terms glossary table with demand-scale visual, " +
    "(2) Vocabulary list defining all terms before first use, " +
    "(3) Progress tracker, " +
    "(4) TOK provocations block, " +
    "(5) International Mindedness box, " +
    "(6) Parts numbered 0, 1, 2 … each with a 'What you need to start this Part' micro-box, " +
    "(7) Reflection section with concept-map table, TOK position frame, and mentor text, " +
    "(8) Extension & IA-Seeding branches (optional, ★★★), " +
    "(9) Teacher's Companion (Integration Map, answer sketches, planted-error key, tiered deadlines, compulsory core list, differentiation notes, design note). " +
    "Use American English throughout (color, recognize, generalize, center, rigor). " +
    "Render all command terms in red bold on every appearance.",
  questionCount: 20,
  challengeMix: "challenge-forward",
  includeRealWorldContext: true,
  tone: "exam-style",
};

const naDraft: AssignmentDraft = {
  title: "Nuanced Analysis",
  subtitle: "IBDP Mathematics — Analysis & Approaches HL",
  instructions: [
    "Read the Command Terms glossary before starting. Tear it off and keep it beside you.",
    "Complete Parts in order. Each Part's micro-box tells you exactly what prior knowledge you need.",
    "Compulsory core: ★ and ★★ questions. ★★★ questions are optional challenge extensions.",
    "You may answer Describe / Explain questions in bullet points, or respond orally — ask your teacher.",
    "Show all working unless the command term is Write down or State.",
  ],
  sections: [
    {
      heading: "Command Terms (tear-off strip)",
      questions: [
        {
          prompt:
            "Write down — A short answer with no working required.\n" +
            "Describe — Give a detailed account.\n" +
            "Explain — Give a detailed account including reasons or causes.\n" +
            "Deduce — Reach a conclusion by logical reasoning from results already established.\n" +
            "Show that — Obtain a stated result; every logical step must appear.\n" +
            "Prove — Establish truth by a rigorous, complete chain of reasoning.\n" +
            "Hence — You must use the immediately preceding result.\n" +
            "Hence or otherwise — Use the previous result or any other valid method.\n" +
            "Sketch — Clear diagram showing key features and relative scale; label exact coordinates.",
          marks: 0,
          answer: "Reference strip — not assessed.",
        },
      ],
    },
    {
      heading: "Part 0 — Activating Prior Knowledge",
      questions: [
        {
          prompt:
            "★ Write down the key result or definition from the prerequisite topic that this analysis builds on. " +
            "(Your teacher will specify the prerequisite topic.)",
          marks: 2,
          answer: "Varies by topic chosen.",
        },
        {
          prompt:
            "★ Describe, in one sentence, the geometric or physical meaning of that result.",
          marks: 2,
          answer: "Geometric reading appropriate to the prerequisite.",
        },
      ],
    },
    {
      heading: "Part 1 — Conjecture (Numerical Investigation)",
      questions: [
        {
          prompt:
            "★ Numerical warm-up. Use specific values (no variables yet) to explore the key relationship. " +
            "Write down your results in a table.",
          marks: 3,
          answer: "Numerical cases correct.",
        },
        {
          prompt:
            "★ Write a conjecture relating the quantities you observed. " +
            "State it precisely using mathematical vocabulary.",
          marks: 2,
          answer: "Conjecture correctly stated.",
        },
        {
          prompt:
            "★★ Show that your conjecture holds in the general case. " +
            "Show every logical step.",
          marks: 4,
          answer: "General proof with all steps shown.",
        },
      ],
    },
    {
      heading: "Part 2 — Proof",
      questions: [
        {
          prompt:
            "★★ Prove the main result by mathematical induction (or by the method specified).\n" +
            "Use this template:\n" +
            "  Base case (n = 1): [verify]\n" +
            "  Inductive hypothesis: [state assumption for n = k]\n" +
            "  Inductive step: [show for n = k+1]\n" +
            "  Conclusion: [standard induction closing sentence]",
          marks: 6,
          answer: "Complete induction proof.",
        },
        {
          prompt:
            "★★ Deduce a corollary or extension of the result proved above.",
          marks: 3,
          answer: "Correct deduction from proved result.",
        },
      ],
    },
    {
      heading: "Part 3 — The Broken Math Critique",
      questions: [
        {
          prompt:
            "The following working was submitted by a student. Your job is not to judge the student — " +
            "errors like this reveal important distinctions. Find the slip and explain its consequence.\n\n" +
            "[Teacher: insert a worked example containing a single identifiable misconception here.]",
          marks: 2,
          answer: "(a) Geometric/structural reason the answer is absurd. (b) Exact line of error identified.",
        },
        {
          prompt:
            "★★ Determine the correct answer and state it in exact form.",
          marks: 3,
          answer: "Correct answer in exact form.",
        },
      ],
    },
    {
      heading: "Part 4 — Application and Transfer",
      questions: [
        {
          prompt:
            "★★ Apply the result from Part 2 to a new context or a different representation " +
            "(geometric, physical, or series). Show the connection explicitly.",
          marks: 4,
          answer: "Correct application with explicit representational link.",
        },
        {
          prompt:
            "★★ Hence (using your result from Part 2) solve the applied problem.",
          marks: 4,
          answer: "Correct solution using prior result.",
        },
        {
          prompt:
            "★★ Explain what feature of the mathematics — proven in Part 2 — makes this method work.",
          marks: 2,
          answer: "Correct causal explanation referencing the proved result.",
        },
      ],
    },
    {
      heading: "Part 5 — Technology Task",
      questions: [
        {
          prompt:
            "★ Use GeoGebra or Desmos to generate a visualization of the key result. " +
            "Describe one feature that is easier to see graphically than algebraically.",
          marks: 2,
          answer: "Valid graphical observation. You may answer with an annotated diagram.",
        },
        {
          prompt:
            "★ Describe one fact about the result that is easier to prove algebraically than to see graphically.",
          marks: 2,
          answer: "Valid algebraic observation.",
        },
      ],
    },
    {
      heading: "Reflection",
      questions: [
        {
          prompt:
            "★ List the major concepts, formulas, and understandings this analysis has confirmed or connected. " +
            "Aim for at least six. Use the table: | Concept | Where it appeared | How it connected to another concept |\n" +
            "You may answer this question in bullet points.",
          marks: 4,
          answer: "At least six concepts named; connections stated.",
        },
        {
          prompt:
            "★★ This packet asked you to prove the same result in more than one way. " +
            "Explain what is gained by holding two independent proofs of one truth. " +
            "Does a second proof make the result more true? " +
            "You may answer in bullet points or respond orally.",
          marks: 3,
          answer: "Substantive reflection on epistemic value of multiple proofs.",
        },
        {
          prompt:
            "★★ TOK: Take and defend a position on one of the TOK provocations from the header. " +
            "Use this frame: 'I argue that [claim]. My evidence from this packet is [specific result]. " +
            "A counterargument would be [X], but I respond that [Y].'",
          marks: 3,
          answer: "Position stated; packet evidence cited; counterargument addressed.",
        },
      ],
    },
    {
      heading: "Extension & IA-Seeding (★★★ Optional)",
      questions: [
        {
          prompt:
            "★★★ Choose one extension branch and begin an investigation. " +
            "These problems are deliberately under-specified, in the spirit of the Internal Assessment Exploration. " +
            "[Teacher: insert two or three under-specified extension branches from different IB topic areas.]",
          marks: 0,
          answer: "Optional — not assessed in the core. Credit at teacher discretion.",
        },
      ],
    },
  ],
};

export function NuancedAnalysisSandbox() {
  return (
    <GenericAssignmentSandbox
      gradeLevel="Grade 12"
      defaultFormatting={naFormatting}
      defaultInput={naInput}
      defaultDraft={naDraft}
    />
  );
}
