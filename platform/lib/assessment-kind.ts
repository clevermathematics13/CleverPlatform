/**
 * assessment-kind.ts
 * -----------------------------------------------------------------------------
 * Formative or summative, and everything that follows from the answer.
 *
 * The creator builds both from the same draft shape and both are graded through
 * the same `tests` pipeline, so the kind is not a separate content type -- it is
 * a small set of rules that a single flag turns on. They are collected here,
 * rather than scattered across the sandbox, the save route and the grading
 * routes, because "what makes this a summative?" has to be answerable in one
 * place: a paper that is summative on the cover and formative in the grading is
 * worse than one that is neither.
 *
 * WHAT A SUMMATIVE ADDS
 *   1. Exam conditions on the cover -- calculator policy, time allowed, total
 *      marks, and an academic honesty declaration (lib/exam-conditions.ts).
 *      They print on the mark scheme too, so the marker sees the rules the
 *      student worked under.
 *   2. A grade boundary set, so the mark reports as a grade rather than a raw
 *      score. Without one the gradebook falls back to generic bands and shows
 *      an "~approx" badge -- fine for a formative, wrong for a paper that
 *      counts.
 *   3. Teacher intervention on every AI-suggested mark the model was not fully
 *      confident about. See lib/summative-grading-gate.ts: batch accept stops
 *      covering those, and they wait for someone to look.
 *   4. Self-assessment before marks are released -- not offered as a choice.
 *
 * WHAT A SUMMATIVE LEAVES OUT
 *   1. Hints. A formative may print "Hint: try substituting x = 2" beside a
 *      question; on a summative that is marks given away, and the renderer
 *      prints any hint it is handed. So they are stripped on the way in rather
 *      than trusted not to be generated.
 *
 * WHAT DELIBERATELY DOES NOT CHANGE
 *   - The marking policy. A summative loads the same
 *     grading_policies/g9_formative_assessment_marking_principles.md that
 *     lib/ai-grading.ts already loads for every `source = 'custom'` item.
 *     M/A/R/FT does not mean something different because the paper counts, and
 *     a second policy file is a second thing to keep in step.
 *   - The LEVEL bands. The increasing-demand ramp is how these papers are
 *     written and the gradebook already parses "LEVEL n" headings.
 *   - The reteach guide. It lives on the mark scheme, teacher-only, and a
 *     summative is exactly when a teacher needs to know what to go back over.
 * -----------------------------------------------------------------------------
 */

import type { AssignmentDraft, CalculatorPolicy, FormattingRequirements } from "./assignments";

export type AssessmentKind = "formative" | "summative";

export const ASSESSMENT_KINDS: Array<{ value: AssessmentKind; label: string; blurb: string }> = [
  {
    value: "formative",
    label: "Formative",
    blurb: "Practice that informs teaching. Hints allowed, marks released on the usual terms.",
  },
  {
    value: "summative",
    label: "Summative",
    blurb:
      "A paper that counts. Exam conditions printed, no hints, grade boundaries required, " +
      "and any AI mark below high confidence waits for you.",
  },
];

/** Narrow an untrusted value to a kind, defaulting to the safer one. */
export function parseAssessmentKind(value: unknown): AssessmentKind {
  return value === "summative" ? "summative" : "formative";
}

export function isSummative(kind: AssessmentKind): boolean {
  return kind === "summative";
}

/**
 * The declaration a student sits a summative under.
 *
 * A default rather than a hard-coded string: a school's own wording belongs on
 * its own papers, and this is editable in the creator. It is worded as
 * something the student does, not something the school forbids, because it is
 * read by the person it is about.
 */
export const DEFAULT_ACADEMIC_HONESTY_LINE =
  "Academic honesty: the work in this booklet is my own. I have not given or received help, " +
  "and I have used only the materials permitted above.";

/**
 * The courses an assessment may be authored against.
 *
 * Every course in the database is offered by the gradebook and the test detail
 * form; this creator is narrower on purpose. Two classes are taught from these
 * papers, and a dropdown that also offers 9A, 9C, 9D, two archived years and a
 * Grade 9 Standard cohort that has been declined is a dropdown where the wrong
 * one gets picked. Matched by name, because that is what the teacher reads.
 *
 * A saved assessment's OWN course is always offered alongside these, whatever
 * it is -- Formative Assessment 1 hangs off 9G, and re-saving it must not
 * quietly move it. See allowedCourses below.
 */
export const ASSESSMENT_COURSE_NAMES = ["27AH", "Grade 9 Extended"] as const;

/**
 * The courses to show, given everything that exists and what is loaded.
 *
 * Order is preserved from the input so the list reads the same every time.
 */
export function allowedCourses<T extends { id: string; name: string }>(
  all: T[],
  loadedCourseId: string | null,
): T[] {
  const names = new Set<string>(ASSESSMENT_COURSE_NAMES);
  return all.filter((c) => names.has(c.name) || (loadedCourseId !== null && c.id === loadedCourseId));
}

/**
 * Whether a calculator is permitted, from the grade this paper is for.
 *
 * Grade 9 here is pre-DP, preparing for IBDP Mathematics AA, and those students
 * work with a graphing calculator -- so a Grade 9 paper starts permitting one.
 * "Permitted" and not "required": a paper may be sat without touching it.
 *
 * Everything else starts at not-permitted, which is the safer way round for a
 * grade whose conventions this function does not know: a paper that wrongly
 * forbids a calculator is an argument before the exam, and one that wrongly
 * allows it is an argument after the marks.
 */
export function calculatorPolicyForGrade(gradeLevel: string, courseName?: string): CalculatorPolicy {
  const haystack = `${gradeLevel} ${courseName ?? ""}`;
  return /\bgrade\s*9\b/i.test(haystack) ? "graphing" : "not-permitted";
}

/** Sensible starting conditions for a summative cover. All of it editable. */
export const SUMMATIVE_FORMATTING_DEFAULTS = {
  calculatorPolicy: "not-permitted",
  timeAllowedMinutes: 50,
  showTotalMarks: true,
  academicHonestyLine: DEFAULT_ACADEMIC_HONESTY_LINE,
} as const satisfies Partial<FormattingRequirements>;

/**
 * Formatting with this kind's cover conditions applied.
 *
 * Switching to formative CLEARS the four fields rather than leaving them set:
 * a calculator policy printed on a paper that is no longer being sat under
 * exam conditions is a rule nobody is enforcing, and teaching students that
 * the cover can be ignored is how the line stops working on the paper where it
 * matters. `undefined` is what buildExamConditionsHtml treats as absent.
 */
export function applyKindFormatting(
  kind: AssessmentKind,
  formatting: FormattingRequirements,
  /** What the paper is for, so the calculator rule starts at the grade's own. */
  context?: { gradeLevel?: string; courseName?: string },
): FormattingRequirements {
  if (kind === "summative") {
    return {
      ...formatting,
      ...SUMMATIVE_FORMATTING_DEFAULTS,
      calculatorPolicy: calculatorPolicyForGrade(context?.gradeLevel ?? "", context?.courseName),
    };
  }
  return {
    ...formatting,
    calculatorPolicy: undefined,
    timeAllowedMinutes: undefined,
    showTotalMarks: undefined,
    academicHonestyLine: undefined,
  };
}

/**
 * Re-apply the grade's calculator rule when the grade or course changes.
 *
 * Only when the current value is still the PREVIOUS grade's default -- a policy
 * the teacher chose is theirs, and having it silently change because they
 * corrected a course name is exactly the kind of thing that puts the wrong rule
 * on a paper. Same rule the title switch uses.
 */
export function retargetCalculatorPolicy(
  current: CalculatorPolicy | undefined,
  previous: { gradeLevel: string; courseName?: string },
  next: { gradeLevel: string; courseName?: string },
): CalculatorPolicy | undefined {
  if (current === undefined) return current;
  const wasDefault = current === calculatorPolicyForGrade(previous.gradeLevel, previous.courseName);
  return wasDefault ? calculatorPolicyForGrade(next.gradeLevel, next.courseName) : current;
}

/**
 * The draft as this kind is allowed to print it.
 *
 * Only hints are removed today, and only for a summative. Done on the draft
 * rather than in the renderer on purpose: the renderer is shared with NA
 * packets and the generic sandboxes, where a hint is the point, and a rule
 * that says "print hints unless..." in there would eventually be read the
 * wrong way round.
 */
export function applyKindRules(kind: AssessmentKind, draft: AssignmentDraft): AssignmentDraft {
  if (kind !== "summative") return draft;
  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => {
        const stripped = withoutHint(question);
        return question.subparts
          ? { ...stripped, subparts: question.subparts.map(withoutHint) }
          : stripped;
      }),
    })),
  };
}

/**
 * A copy with no `hint` key -- or the original when there was none.
 *
 * `delete` on a copy rather than destructuring the key away, so the key is
 * genuinely absent (an explicit `hint: undefined` would survive JSON round
 * trips into `custom_content` as a null) and so nothing unused is declared.
 */
function withoutHint<T extends { hint?: string }>(item: T): T {
  if (item.hint === undefined) return item;
  const copy = { ...item };
  delete copy.hint;
  return copy;
}

/** Did stripping actually remove anything? Used to tell the teacher it happened. */
export function countHints(draft: AssignmentDraft): number {
  return draft.sections.reduce(
    (total, section) =>
      total +
      section.questions.reduce(
        (n, q) => n + (q.hint ? 1 : 0) + (q.subparts?.filter((sp) => sp.hint).length ?? 0),
        0,
      ),
    0,
  );
}

/**
 * Whether students must self-grade before Clev's Marks appear.
 *
 * A summative forces it on and does not take no for an answer. The teacher
 * asked for exactly this: students self-assess BEFORE seeing the marks the
 * teacher approved from AI grading. Leaving it as a toggle would make that a
 * thing to remember on every save, and the one paper it gets forgotten on is
 * the one where a student sees a grade before they have judged their own work.
 */
export function resolveRequireSelfAssessment(kind: AssessmentKind, requested: boolean): boolean {
  return kind === "summative" ? true : requested;
}
