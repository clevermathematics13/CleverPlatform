import { describe, it, expect } from "vitest";
import {
  editorSnapshot,
  needsDiscardConfirmation,
  isAlreadyOpen,
  formatSavedDate,
} from "./load-saved-assessment";
import { DEFAULT_ASSESSMENT_FORMATTING } from "@/lib/formative-assessment-pdf-body";
import type { AssignmentDraft } from "@/lib/assignments";

const draft: AssignmentDraft = {
  title: "Formative Assessment 1",
  subtitle: "Grade 9 Mathematics -- Extended",
  instructions: ["Answer every part."],
  sections: [
    {
      heading: "LEVEL 1",
      questions: [{ prompt: "Coefficient of x in 3x + 7?", marks: 1, answer: "3", markScheme: "A1" }],
    },
  ],
};

describe("editorSnapshot", () => {
  it("is stable for an unchanged editor", () => {
    expect(editorSnapshot(draft, DEFAULT_ASSESSMENT_FORMATTING)).toBe(
      editorSnapshot(draft, DEFAULT_ASSESSMENT_FORMATTING),
    );
  });

  it("changes when a mark scheme is edited", () => {
    const edited: AssignmentDraft = {
      ...draft,
      sections: [
        {
          ...draft.sections[0],
          questions: [{ ...draft.sections[0].questions[0], markScheme: "A1 for the sign too." }],
        },
      ],
    };
    expect(editorSnapshot(edited, DEFAULT_ASSESSMENT_FORMATTING)).not.toBe(
      editorSnapshot(draft, DEFAULT_ASSESSMENT_FORMATTING),
    );
  });

  it("changes when only the formatting is edited", () => {
    // Formatting decides what the exported and archived PDFs look like, so a
    // font-size change alone is still unsaved work worth warning about.
    const bigger = { ...DEFAULT_ASSESSMENT_FORMATTING, fontSize: 12 as const };
    expect(editorSnapshot(draft, bigger)).not.toBe(
      editorSnapshot(draft, DEFAULT_ASSESSMENT_FORMATTING),
    );
  });
});

describe("needsDiscardConfirmation", () => {
  const clean = editorSnapshot(draft, DEFAULT_ASSESSMENT_FORMATTING);

  it("does not ask when nothing has been edited since the last save or load", () => {
    expect(needsDiscardConfirmation({ current: clean, clean, confirmed: false })).toBe(false);
  });

  it("asks when the editor has moved away from that state", () => {
    const edited = editorSnapshot({ ...draft, title: "Formative Assessment 2" }, DEFAULT_ASSESSMENT_FORMATTING);
    expect(needsDiscardConfirmation({ current: edited, clean, confirmed: false })).toBe(true);
  });

  it("does not ask twice once the teacher has confirmed", () => {
    const edited = editorSnapshot({ ...draft, title: "Formative Assessment 2" }, DEFAULT_ASSESSMENT_FORMATTING);
    expect(needsDiscardConfirmation({ current: edited, clean, confirmed: true })).toBe(false);
  });

  it("does not ask on a pristine editor that has never been saved", () => {
    // The snapshot taken at mount is the default draft, so opening something
    // straight after landing on the tab goes through without a prompt.
    expect(needsDiscardConfirmation({ current: clean, clean, confirmed: false })).toBe(false);
  });
});

describe("isAlreadyOpen", () => {
  it("is true only for the row currently in the editor", () => {
    expect(isAlreadyOpen("abc", "abc")).toBe(true);
    expect(isAlreadyOpen("abc", "def")).toBe(false);
  });

  it("is false when nothing is selected or nothing is saved", () => {
    // Both empty must not count as a match, or the button reads "Already open"
    // with no assessment chosen at all.
    expect(isAlreadyOpen("", null)).toBe(false);
    expect(isAlreadyOpen("", "")).toBe(false);
    expect(isAlreadyOpen("abc", null)).toBe(false);
  });
});

describe("formatSavedDate", () => {
  it("renders a real timestamp", () => {
    expect(formatSavedDate("2026-09-04T20:06:06.394Z")).toContain("2026");
  });

  it("hands back an unparseable value rather than throwing or showing Invalid Date", () => {
    expect(formatSavedDate("not a date")).toBe("not a date");
  });
});
