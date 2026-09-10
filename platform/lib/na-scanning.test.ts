import { describe, it, expect } from "vitest";
import { transcriptionHasUnreadableGap } from "./na-scanning";

// Strings here are taken from A.1's real transcriptions, so the cases track
// what the assessor actually writes rather than what it might write.
describe("transcriptionHasUnreadableGap", () => {
  describe("counts a gap when the assessor could not read the whole crop", () => {
    it("catches a mid-word reconstruction", () => {
      // Q17: the answer runs off the right edge mid-word, confirmed by eye.
      expect(
        transcriptionHasUnreadableGap(
          "the total will remain the same because the express[ions are equivalent]"
        )
      ).toBe(true);
    });

    it("catches several short reconstructions in one line", () => {
      // Q30, cut off on three edges.
      expect(
        transcriptionHasUnreadableGap("and 60 is the cos[t] per ticket. Some people [sa]y that it does not")
      ).toBe(true);
    });

    it("catches an outright statement that content is missing", () => {
      expect(transcriptionHasUnreadableGap("Row 6: using cost and number of people to find [cut off]")).toBe(true);
      expect(transcriptionHasUnreadableGap("Row 3: rate of change [continues beyond crop]")).toBe(true);
    });

    it("catches a statement without brackets around it", () => {
      expect(transcriptionHasUnreadableGap("The last line is cut off at the right edge.")).toBe(true);
    });
  });

  describe("does not count the assessor describing what is there", () => {
    it("ignores annotation brackets", () => {
      // These inflated Q4 from 12 real to 16 before the exclusion existed.
      for (const t of [
        "Factor: [blank]",
        "Coefficient: A number next to a variable [marked with checkmark]",
        "Term: the solution [crossed out]",
        "Row 5: Plotting Expression | [blank] | [blank]",
        "answer [circled]",
        "working [underlined]",
        "[marked with x]",
      ]) {
        expect(transcriptionHasUnreadableGap(t), t).toBe(false);
      }
    });

    it("ignores transcribed working", () => {
      expect(transcriptionHasUnreadableGap("60(2) + 30(1) [30(6) = 180]")).toBe(false);
    });

    it("ignores a bracketed span with no letters", () => {
      expect(transcriptionHasUnreadableGap("a = b [??]")).toBe(false);
    });

    it("ignores a complete transcription", () => {
      // Q26(a): flagged, but only the printed axis caption is clipped.
      expect(
        transcriptionHasUnreadableGap(
          "Graph with points plotted at approximately (0,19), (1,17) — connected with a line."
        )
      ).toBe(false);
    });
  });

  describe("edges", () => {
    it("ignores a bracketed span too long to be a guessed-at gap", () => {
      expect(transcriptionHasUnreadableGap(`[${"x".repeat(41)}]`)).toBe(false);
    });

    it("does not treat bare ellipsis as a gap", () => {
      // Q17 asks students to begin "For every...".
      expect(transcriptionHasUnreadableGap("For every... the total stays the same")).toBe(false);
    });

    it("still counts a real gap alongside an annotation", () => {
      expect(transcriptionHasUnreadableGap("Factor: [blank]. Constant: a number that repres[ents]")).toBe(true);
    });

    it("handles absent and empty transcriptions", () => {
      expect(transcriptionHasUnreadableGap(null)).toBe(false);
      expect(transcriptionHasUnreadableGap(undefined)).toBe(false);
      expect(transcriptionHasUnreadableGap("")).toBe(false);
      expect(transcriptionHasUnreadableGap("a[]b")).toBe(false);
      expect(transcriptionHasUnreadableGap("a[  ]b")).toBe(false);
    });
  });
});
