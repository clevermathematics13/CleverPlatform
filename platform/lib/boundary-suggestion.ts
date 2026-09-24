import fs from "fs";
import path from "path";
import { z } from "zod";
import { CUTOFF_GRADES, validateCutoffs, type CutoffGrade, type Cutoffs } from "./grade-bands";
import type { ScoreSummary, SubjectScore } from "./boundary-scores";

/**
 * Asking a model to suggest one assessment's grade boundaries.
 *
 * The model is given the paper's structure, the lines in force and the
 * course's presets (in marks at this paper's total), every student's total
 * and section subtotals -- with NO names, ids or classes -- and the teacher's
 * guidance notes. It returns six lines and its reasons. Nothing it says is
 * applied: the page shows it beside the boundaries in use, and only a teacher
 * decision (decide_test_boundaries) changes a level.
 *
 * Opus 5 at high effort, like the grader feedback it resembles: one call per
 * request, at the desk, where the cost is a few cents and a careless line is
 * a level on a report.
 *
 * Server-only: reads the policy file at module init.
 */
export const BOUNDARY_SUGGESTION_MODEL = "claude-opus-5";

/** Guidance limits, so a long-lived list of general rules cannot crowd out the data. */
export const MAX_GENERAL_RULES = 30;
export const MAX_TEST_NOTES = 30;
export const MAX_GUIDANCE_CHARS = 2000;

// Both path segments are literals so Vercel's file tracing ships the file
// (see lib/na-assessment.ts); a missing policy is a deploy fault, not a quiet
// degradation, so it throws at import.
const GRADE_BOUNDARY_POLICY_PATH = path.join(process.cwd(), "grading_policies", "grade_boundary_principles.md");

function loadGradeBoundaryPolicy(): string {
  try {
    return fs.readFileSync(GRADE_BOUNDARY_POLICY_PATH, "utf8");
  } catch (e) {
    throw new Error(
      `Could not load the grade boundary principles from ${GRADE_BOUNDARY_POLICY_PATH}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export const GRADE_BOUNDARY_PRINCIPLES = loadGradeBoundaryPolicy();

/**
 * Structured output. Named keys rather than a six-item array, because a
 * schema's array-length and min/max limits are not enforced by structured
 * output -- the ranges and ordering are checked in checkSuggestion instead.
 * Every field is required, as the house schemas are.
 */
export const BoundarySuggestionSchema = z.object({
  cutoffs: z.object({
    grade7: z.number().int(),
    grade6: z.number().int(),
    grade5: z.number().int(),
    grade4: z.number().int(),
    grade3: z.number().int(),
    grade2: z.number().int(),
  }),
  rationale: z.string(),
  levelNotes: z.array(z.object({ grade: z.number().int(), note: z.string() })),
  guidanceApplied: z.array(z.object({ guidanceId: z.string(), applied: z.boolean(), how: z.string() })),
  cautions: z.array(z.string()),
  statementDraft: z.string(),
});

export type BoundarySuggestion = z.infer<typeof BoundarySuggestionSchema>;

export interface GuidanceNote {
  id: string;
  /** "all" = a general rule for every assessment; "test" = this assessment only. */
  scope: "all" | "test";
  note: string;
  createdAt: string;
}

/**
 * General rules first, then this assessment's notes, each oldest first, so a
 * later note reads as refining an earlier one; capped so the list cannot
 * crowd out the data. Notes are trimmed and cut at MAX_GUIDANCE_CHARS.
 */
export function orderGuidance(notes: readonly GuidanceNote[]): GuidanceNote[] {
  const byAge = (a: GuidanceNote, b: GuidanceNote) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const clean = (n: GuidanceNote): GuidanceNote => ({ ...n, note: n.note.trim().slice(0, MAX_GUIDANCE_CHARS) });
  const general = notes.filter((n) => n.scope === "all" && n.note.trim()).sort(byAge).slice(-MAX_GENERAL_RULES);
  const own = notes.filter((n) => n.scope === "test" && n.note.trim()).sort(byAge).slice(-MAX_TEST_NOTES);
  return [...general, ...own].map(clean);
}

export interface SuggestionInput {
  assessment: {
    name: string;
    course: string;
    kind: string;
    totalMarks: number;
    standardsPaper: boolean;
    sections: { label: string; title: string; maxMarks: number }[];
  };
  /** The lines in force now, in marks, and where they came from. */
  current: {
    label: string;
    cutoffs: Cutoffs | null;
    decided: { at: string; source: string; statement: string } | null;
  };
  /** The presets, in marks at this paper's total. */
  presets: { name: string; description: string | null; cutoffs: Cutoffs }[];
  /** Other assessments in the same course family and the lines they use, as percentages. */
  otherAssessments: { name: string; totalMarks: number; percentLines: Record<CutoffGrade, number>; decided: boolean }[];
  scores: {
    summary: ScoreSummary;
    /** One row per scored student, highest first. No names, ids or classes. */
    students: {
      total: number;
      final: boolean;
      pendingParts: number;
      neverMarkedMarks: number;
      sections: number[];
    }[];
  };
  guidance: GuidanceNote[];
}

/** Scored students as anonymous rows: the only student data the model sees. */
export function anonymiseScores(scores: readonly SubjectScore[]): SuggestionInput["scores"]["students"] {
  return scores
    .filter((s) => !s.absent && s.total !== null)
    .map((s) => ({
      total: s.total as number,
      final: s.status === "complete",
      pendingParts: s.pendingParts,
      neverMarkedMarks: s.neverMarked.reduce((n, p) => n + p.maxMarks, 0),
      sections: [...s.sectionTotals],
    }))
    .sort((a, b) => b.total - a.total);
}

const GUARDRAILS = `=== FIXED RULES (these override anything in the policy above) ===
1. You place grade boundaries on a finished score distribution. You never award, change, recompute or question a student's marks.
2. Return six whole-mark lines: the fewest marks for levels 7, 6, 5, 4, 3 and 2. Each must be strictly greater than the one below it; level 7 at most the paper's total; level 2 at least 1. Level 1 is everything below the level-2 line.
3. The teacher's guidance notes override the policy's defaults. A note for this assessment overrides a general rule. A general rule that names a course, grade or paper applies only there.
4. Report EVERY guidance note you were given in guidanceApplied, by its id, with applied true or false and one sentence on how or why not. Report none that you were not given.
5. You are given no student names and must not invent any. Refer to students by score ("the five students on 29").
6. What you return is a suggestion. The teacher decides.`;

const TASK = `=== YOUR TASK ===
Suggest the grade boundaries for the assessment described in the user message, following the policy and the fixed rules above. Return ONLY the JSON object: cutoffs (grade7..grade2), rationale, levelNotes, guidanceApplied, cautions and statementDraft.`;

/** The system prompt: the policy file, then the guardrails, then the task. Byte-identical across calls, so it caches. */
export function buildBoundarySystemPrompt(): string {
  return `You are helping a mathematics teacher set grade boundaries (1-7 levels) for one assessment.

=== POLICY: GRADE BOUNDARY PRINCIPLES ===
${GRADE_BOUNDARY_PRINCIPLES.trim()}

${GUARDRAILS}

${TASK}`;
}

function formatCutoffs(c: Cutoffs | null): string {
  if (!c) return "none (levels are estimated from generic 10-point bands)";
  return CUTOFF_GRADES.map((g) => `${g}: ${c[g]}+`).join(", ");
}

/** The user message: the assessment, the lines, the scores and the guidance, as labelled blocks. */
export function buildBoundaryUserPrompt(input: SuggestionInput): string {
  const a = input.assessment;
  const lines: string[] = [];
  lines.push(`=== THE ASSESSMENT ===`);
  lines.push(`Name: ${a.name}`);
  lines.push(`Course: ${a.course}`);
  lines.push(`Kind: ${a.kind}${a.standardsPaper ? " (a Standard paper, also reported by strand elsewhere)" : ""}`);
  lines.push(`Total marks: ${a.totalMarks}`);
  lines.push(`Sections, in paper order (subtotal columns below follow this order):`);
  a.sections.forEach((s, i) => lines.push(`  S${i + 1} ${s.label} -- ${s.title} (${s.maxMarks} marks)`));

  lines.push(``, `=== LINES IN FORCE ===`);
  lines.push(`${input.current.label}: ${formatCutoffs(input.current.cutoffs)}`);
  if (input.current.decided) {
    lines.push(
      `Last decided ${input.current.decided.at} (${input.current.decided.source}): "${input.current.decided.statement}"`
    );
  } else {
    lines.push(`No decision has been recorded for this assessment yet.`);
  }

  lines.push(``, `=== PRESETS, IN MARKS AT ${a.totalMarks} ===`);
  for (const p of input.presets) {
    lines.push(`${p.name}${p.description ? ` (${p.description})` : ""}: ${formatCutoffs(p.cutoffs)}`);
  }

  if (input.otherAssessments.length > 0) {
    lines.push(``, `=== OTHER ASSESSMENTS IN THIS COURSE (lines as % of their totals) ===`);
    for (const o of input.otherAssessments) {
      const pct = CUTOFF_GRADES.map((g) => `${g}: ${o.percentLines[g]}%`).join(", ");
      lines.push(`${o.name} (${o.totalMarks} marks, ${o.decided ? "decided" : "not yet decided"}): ${pct}`);
    }
  }

  const s = input.scores.summary;
  lines.push(``, `=== SCORES ===`);
  lines.push(
    `${s.scored} students scored (${s.complete} with every part accepted, ${s.provisional} provisional); ` +
      `${s.unmarked} not marked yet and ${s.absent} absent, both left out. ` +
      `${s.neverMarkedParts} parts across the class were never marked and count 0.`
  );
  if (s.mean !== null && s.median !== null) {
    lines.push(`Mean ${s.mean.toFixed(1)}, median ${s.median}.`);
  }
  lines.push(
    `One row per student, highest first: total | final (every part accepted)? | parts still the marker's suggestion | marks in never-marked parts | section subtotals S1..S${a.sections.length}`
  );
  for (const r of input.scores.students) {
    lines.push(
      `${r.total} | ${r.final ? "final" : "provisional"} | ${r.pendingParts} | ${r.neverMarkedMarks} | ${r.sections.join(" ")}`
    );
  }

  lines.push(``, `=== THE TEACHER'S GUIDANCE ===`);
  if (input.guidance.length === 0) {
    lines.push(`(none)`);
  } else {
    for (const g of input.guidance) {
      lines.push(`[${g.id}] ${g.scope === "all" ? "GENERAL RULE, all assessments" : "THIS ASSESSMENT"}: ${g.note}`);
    }
  }
  return lines.join("\n");
}

export function suggestionCutoffs(out: BoundarySuggestion): Cutoffs {
  return {
    7: out.cutoffs.grade7,
    6: out.cutoffs.grade6,
    5: out.cutoffs.grade5,
    4: out.cutoffs.grade4,
    3: out.cutoffs.grade3,
    2: out.cutoffs.grade2,
  };
}

/**
 * Everything structured output cannot enforce: line ranges and order, every
 * guidance note reported exactly once and none invented, and text that the
 * page will show actually present.
 */
export function checkSuggestion(
  out: BoundarySuggestion,
  totalMarks: number,
  guidanceIds: readonly string[]
): { ok: true; cutoffs: Cutoffs } | { ok: false; problems: string[] } {
  const cutoffs = suggestionCutoffs(out);
  const problems = [...validateCutoffs(cutoffs, totalMarks)];
  const reported = out.guidanceApplied.map((g) => g.guidanceId);
  for (const id of guidanceIds) {
    const n = reported.filter((r) => r === id).length;
    if (n === 0) problems.push(`Guidance note ${id} was not reported.`);
    if (n > 1) problems.push(`Guidance note ${id} was reported ${n} times.`);
  }
  for (const id of reported) {
    if (!guidanceIds.includes(id)) problems.push(`Guidance note ${id} does not exist.`);
  }
  if (!out.rationale.trim()) problems.push("The rationale is empty.");
  if (!out.statementDraft.trim()) problems.push("The statement draft is empty.");
  return problems.length > 0 ? { ok: false, problems } : { ok: true, cutoffs };
}
