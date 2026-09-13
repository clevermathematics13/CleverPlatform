/**
 * formative-assessment-pdf-body.ts
 * -----------------------------------------------------------------------------
 * The request body both Formative Assessment PDFs are rendered from, and the
 * formatting a paper gets when nothing else is stored for it.
 *
 * Deliberately free of any server-only import (no puppeteer, no supabase) so
 * the sandbox's own Download buttons and the save route's archiver build the
 * SAME document. They used to have separate copies of this shape; a drift
 * between them would mean the archived PDF was not the paper the teacher
 * previewed, which is the one thing an archive must never get wrong.
 * -----------------------------------------------------------------------------
 */

import type { AssignmentDraft, FormattingRequirements } from "./assignments";

/**
 * The formatting a Formative Assessment is authored with.
 *
 * This was the sandbox's own DEFAULT_FORMATTING. It moved here when the save
 * route started rendering papers server-side: a draft saved before
 * `tests.assessment_formatting` existed has no formatting of its own, and this
 * is what it is rendered with.
 */
export const DEFAULT_ASSESSMENT_FORMATTING: FormattingRequirements = {
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
  answerBoxLines: 4,
  answerStyle: "boxes",
  includeBlockLine: true,
};

export type FormativeAssessmentPdfBody = {
  title: string;
  subtitle: string;
  instructions: string[];
  sections: AssignmentDraft["sections"];
  formatting: FormattingRequirements;
  showSectionScoreSummary?: boolean;
  markingPrinciples?: string[];
  reteachGuide?: AssignmentDraft["reteachGuide"];
};

/**
 * Build the POST body for either PDF.
 *
 * The mark scheme differs from the student paper only in this subtitle suffix
 * and in which renderer consumes the body: `DocumentOrchestratorService.render`
 * draws blank answer boxes, `generateMarkSchemeHtml` draws answers and M/A/R
 * codes from the same `sections`. Sending the mark-scheme body to the student
 * renderer produces a paper that LOOKS right and silently contains no mark
 * scheme at all, so the two are never chosen by a flag on the body.
 */
export function buildFormativeAssessmentPdfBody(
  draft: AssignmentDraft,
  formatting: FormattingRequirements,
  isMarkScheme: boolean,
): FormativeAssessmentPdfBody {
  return {
    title: draft.title,
    subtitle: `${draft.subtitle}${isMarkScheme ? " -- MARK SCHEME" : ""}`,
    instructions: draft.instructions,
    sections: draft.sections,
    formatting,
    showSectionScoreSummary: draft.showSectionScoreSummary,
    markingPrinciples: draft.markingPrinciples,
    reteachGuide: draft.reteachGuide,
  };
}

/** Where a test's archived PDFs live in the `exam-scans` bucket. */
export function assessmentPdfStoragePath(testId: string, kind: "paper" | "mark-scheme"): string {
  return `formative-assessments/${testId}/${kind}.pdf`;
}

/**
 * The filename a teacher gets when they download one.
 *
 * Same squeeze-and-trim the PDF routes apply to their Content-Disposition, with
 * one addition: a title made entirely of punctuation trims to nothing there and
 * yields a nameless ".pdf", so the fallback is applied after sanitising rather
 * than only to an empty title.
 */
export function assessmentPdfFilename(title: string, kind: "paper" | "mark-scheme"): string {
  const base =
    title.replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "assessment";
  return `${base}${kind === "mark-scheme" ? "_mark_scheme" : ""}.pdf`;
}
