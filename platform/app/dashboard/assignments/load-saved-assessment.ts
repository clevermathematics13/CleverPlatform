/**
 * load-saved-assessment.ts
 * -----------------------------------------------------------------------------
 * Whether opening a saved Formative Assessment would discard unsaved work.
 *
 * Split out of formative-assessment-sandbox.tsx for the same reason
 * tab-visibility.ts was split out of assignments-client.tsx: the decision is
 * the part worth testing, and it cannot be tested through a DOM. Getting it
 * wrong in either direction costs something real -- too eager and a teacher is
 * trained to click through the one prompt that matters, too lax and a paper
 * they were half way through writing vanishes with no warning.
 * -----------------------------------------------------------------------------
 */

import type { AssignmentDraft, FormattingRequirements } from "@/lib/assignments";

/**
 * What the editor holds, as a comparable value.
 *
 * Formatting is part of it, not just the questions: it decides what the
 * exported and archived PDFs look like, so changing only the font size and
 * then opening something else is still losing work.
 *
 * Key order is stable because both objects are built by the same code paths,
 * so `JSON.stringify` is sound here and far cheaper than a deep compare on a
 * draft that runs to tens of KB.
 */
export function editorSnapshot(
  draft: AssignmentDraft,
  formatting: FormattingRequirements,
): string {
  return JSON.stringify({ draft, formatting });
}

/**
 * Should opening `nextId` ask first?
 *
 * `clean` is the snapshot taken at the last save or load -- the state the
 * editor could be restored to. Anything else on screen is unsaved.
 */
export function needsDiscardConfirmation(args: {
  current: string;
  clean: string;
  /** The teacher has already seen the prompt and chosen to discard. */
  confirmed: boolean;
}): boolean {
  if (args.confirmed) return false;
  return args.current !== args.clean;
}

/**
 * Is this row the one already in the editor?
 *
 * Opening it would be a no-op that still wipes any edits made since it loaded,
 * so the button offers nothing and is disabled instead.
 */
export function isAlreadyOpen(loadId: string, savedTestId: string | null): boolean {
  return loadId !== "" && loadId === savedTestId;
}

/**
 * A saved assessment's date for the picker, falling back to the raw value.
 *
 * The invalid case is checked rather than caught: `new Date("nonsense")` does
 * not throw, it yields an Invalid Date whose toLocaleDateString returns the
 * string "Invalid Date" -- so a try/catch alone puts that in the dropdown.
 */
export function formatSavedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
