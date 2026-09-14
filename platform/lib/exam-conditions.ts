/**
 * exam-conditions.ts
 * -----------------------------------------------------------------------------
 * The block of exam conditions printed at the top of an assessment: calculator
 * policy, time allowed, total marks, and the academic honesty declaration.
 *
 * ONE renderer, used by both of the orchestrator's cover blocks. Those two --
 * `buildHtml`'s `.doc-head` for the student paper and `generateMarkSchemeHtml`'s
 * header for the teacher copy -- share no code at all today and have already
 * drifted: the student cover carries a name/block/date grid, a score box and
 * the instructions, the mark scheme carries none of them. That is survivable
 * for a formative, where the cover is decoration. It is not survivable here. A
 * calculator policy that prints on the paper but not on the mark scheme means
 * the person marking it cannot see the rule the student was working under, and
 * "was a GDC allowed?" is exactly the question a disputed summative mark turns
 * on.
 *
 * So the conditions are built once and the CSS travels with them.
 * -----------------------------------------------------------------------------
 */

import { escapeHtml, type CalculatorPolicy } from "./assignments";

export type { CalculatorPolicy };

const CALCULATOR_LABELS: Record<CalculatorPolicy, string> = {
  "not-permitted": "No calculator permitted",
  basic: "Basic (four-function) calculator permitted",
  graphing: "Graphing calculator permitted",
  "graphing-required": "Graphing calculator required",
};

/** The teacher-facing wording for the calculator policy dropdown. */
export const CALCULATOR_POLICY_OPTIONS: Array<{ value: CalculatorPolicy; label: string }> =
  (Object.keys(CALCULATOR_LABELS) as CalculatorPolicy[]).map((value) => ({
    value,
    label: CALCULATOR_LABELS[value],
  }));

export function calculatorPolicyLabel(policy: CalculatorPolicy): string {
  return CALCULATOR_LABELS[policy];
}

/** Everything this block can print. Each part is independently optional. */
export type ExamConditions = {
  calculatorPolicy?: CalculatorPolicy;
  timeAllowedMinutes?: number;
  /** Print "TOTAL: n marks". The caller supplies n, since only it knows the paper. */
  showTotalMarks?: boolean;
  academicHonestyLine?: string;
};

/**
 * "50 minutes", "1 hour", "1 hour 15 minutes".
 *
 * Whole hours print as hours because that is how a teacher says it and how it
 * appears on a timetable; a bare "75 minutes" makes the student do arithmetic
 * before they have started the paper.
 */
export function formatTimeAllowed(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (mins > 0) parts.push(`${mins} minute${mins === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/**
 * The conditions strip, or "" when nothing was asked for.
 *
 * Returning "" rather than an empty container is what keeps every existing
 * document byte-identical: a formative that sets none of these fields renders
 * exactly the cover it rendered before this module existed.
 */
export function buildExamConditionsHtml(
  conditions: ExamConditions,
  totalMarks: number,
): string {
  const facts: string[] = [];

  if (conditions.calculatorPolicy) {
    facts.push(
      `<span class="ec-fact"><strong>Calculator:</strong> ${escapeHtml(
        calculatorPolicyLabel(conditions.calculatorPolicy),
      )}</span>`,
    );
  }

  const time = conditions.timeAllowedMinutes ? formatTimeAllowed(conditions.timeAllowedMinutes) : "";
  if (time) {
    facts.push(`<span class="ec-fact"><strong>Time allowed:</strong> ${escapeHtml(time)}</span>`);
  }

  // Printed even when the paper is worth 0 marks: a summative that totals zero
  // is a mistake worth seeing on the cover rather than one that hides itself.
  if (conditions.showTotalMarks) {
    facts.push(`<span class="ec-fact"><strong>Total:</strong> ${totalMarks} marks</span>`);
  }

  const honesty = conditions.academicHonestyLine?.trim();

  if (facts.length === 0 && !honesty) return "";

  const factsHtml = facts.length > 0 ? `<div class="ec-facts">${facts.join("")}</div>` : "";
  const honestyHtml = honesty
    ? `<div class="ec-honesty">${escapeHtml(honesty)}</div>`
    : "";

  return `<div class="exam-conditions">${factsHtml}${honestyHtml}</div>`;
}

/**
 * The CSS for the block above, appended to whichever stylesheet is being built.
 *
 * Lives here and not in the orchestrator's two `buildCss` functions for the
 * reason at the top of this file: one of the two would have been updated and
 * the other forgotten, and the forgotten one is the mark scheme, which nobody
 * looks at until a mark is being argued over.
 */
export const EXAM_CONDITIONS_CSS = `
    .exam-conditions {
      margin: 6px 0 10px;
      padding: 6px 10px;
      border: 1pt solid #111827;
      border-radius: 3px;
      background: #f9fafb;
    }
    .ec-facts {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 18px;
      font-size: 0.92em;
    }
    .ec-fact { white-space: nowrap; }
    .ec-honesty {
      margin-top: 5px;
      padding-top: 5px;
      border-top: 0.5pt solid #d1d5db;
      font-size: 0.85em;
      font-style: italic;
      line-height: 1.35;
    }
`;
