/**
 * load-saved-assessment.ts
 * -----------------------------------------------------------------------------
 * Which of the two ways into this editor is showing, and whether taking one of
 * them would discard unsaved work.
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
import type { AssessmentKind } from "@/lib/assessment-kind";

/**
 * What the editor holds, as a comparable value.
 *
 * Formatting is part of it, not just the questions: it decides what the
 * exported and archived PDFs look like, so changing only the font size and
 * then opening something else is still losing work. So is the kind -- a paper
 * switched from formative to summative and back looks identical here but is
 * saved differently, and the teacher who made that switch should not lose it
 * silently.
 *
 * `kind` is optional so the calls that predate it still mean what they meant:
 * an undefined value is dropped by JSON.stringify, leaving the old two-field
 * snapshot byte-for-byte.
 *
 * Key order is stable because both objects are built by the same code paths,
 * so `JSON.stringify` is sound here and far cheaper than a deep compare on a
 * draft that runs to tens of KB.
 */
export function editorSnapshot(
  draft: AssignmentDraft,
  formatting: FormattingRequirements,
  kind?: AssessmentKind,
): string {
  return JSON.stringify({ draft, formatting, kind });
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

/** Is this row the one already in the editor? */
export function isAlreadyOpen(loadId: string, savedTestId: string | null): boolean {
  return loadId !== "" && loadId === savedTestId;
}

/**
 * What the open button says, and whether it does anything.
 *
 * The subtle case is the row that is already open. Re-opening it is a no-op
 * only while the editor still matches what was loaded; once there are unsaved
 * edits, re-opening is how you throw them away and get the saved paper back,
 * which is worth offering rather than disabling. Getting this backwards leaves
 * a teacher who has made a mess of a paper with no way to undo it short of
 * reloading the page.
 */
export function loadButtonState(args: {
  loadId: string;
  savedTestId: string | null;
  hasUnsavedWork: boolean;
  isLoading: boolean;
}): { disabled: boolean; label: string } {
  if (args.isLoading) return { disabled: true, label: "Opening…" };
  if (!args.loadId) return { disabled: true, label: "Open in the editor" };

  if (isAlreadyOpen(args.loadId, args.savedTestId)) {
    return args.hasUnsavedWork
      ? { disabled: false, label: "Reload, discarding changes" }
      : { disabled: true, label: "Already open" };
  }
  return { disabled: false, label: "Open in the editor" };
}

/**
 * The two ways a paper gets into this editor.
 *
 * They are mutually exclusive in the UI: one of them ends with a saved paper on
 * screen and the other ends with a freshly written one, and both of them
 * replace whatever was there. Showing the inputs for both at once made the tab
 * read as four ways to start rather than two.
 */
export type StartMode = "open" | "create";

export const START_MODES: Array<{ value: StartMode; label: string; blurb: string }> = [
  {
    value: "open",
    label: "Open a saved one",
    blurb:
      "Reopen a paper you have already made. Questions, mark scheme and cover settings all come " +
      "back, and saving writes to the same test.",
  },
  {
    value: "create",
    label: "Generate a new one",
    blurb:
      "Have the model write a new paper from what this class has been taught. It replaces what is " +
      "in the editor.",
  },
];

/**
 * Which way in to open on, for a teacher who has not chosen yet.
 *
 * Decided ONCE, from the saved list, and then left alone -- a first save adds a
 * row to that list, and a panel that re-derived this on every render would
 * switch itself from Generate to Open the moment a teacher saved the paper they
 * had just generated. The caller freezes it; this only says what the answer is.
 *
 * "Open" when there is anything to open, because resuming is the first question
 * on a tab that already has papers in it, and answering it after generating one
 * means throwing that generation away.
 */
export function defaultStartMode(savedCount: number): StartMode {
  return savedCount > 0 ? "open" : "create";
}
