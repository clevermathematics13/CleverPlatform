import { describe, it, expect } from "vitest";
import { transcriptionHasUnreadableGap } from "./na-scanning";

describe("transcriptionHasUnreadableGap", () => {
  it("catches a mid-word reconstruction", () => {
    // Q17 on A.1: the answer runs off the right edge mid-word, and the crop
    // was confirmed truncated by eye.
    expect(
      transcriptionHasUnreadableGap(
        "For every value of a and c put into the expressions the total will remain the same because the express[ions are equivalent]"
      )
    ).toBe(true);
  });

  it("catches several short gaps in one line", () => {
    // Q30 on A.1, cut off on three edges.
    expect(
      transcriptionHasUnreadableGap("and 60 is the cos[t] per ticket. Some people [sa]y that it does not")
    ).toBe(true);
  });

  it("does not fire on a complete transcription", () => {
    // Q26(a): flagged, but only the printed axis caption is clipped -- the
    // student's plotted line ends inside the crop.
    expect(
      transcriptionHasUnreadableGap(
        "Graph with points plotted at approximately (0,19), (1,17), (2,15) — but the points appear to be connected with a line."
      )
    ).toBe(false);
  });

  it("ignores a bracketed span too long to be a guessed-at gap", () => {
    const aside = `[${"x".repeat(41)}]`;
    expect(transcriptionHasUnreadableGap(aside)).toBe(false);
  });

  it("does not treat ellipsis as a gap", () => {
    // Q17 asks students to begin "For every...", so ellipsis is legitimate.
    expect(transcriptionHasUnreadableGap("For every... the total stays the same")).toBe(false);
  });

  it("handles absent transcriptions", () => {
    expect(transcriptionHasUnreadableGap(null)).toBe(false);
    expect(transcriptionHasUnreadableGap(undefined)).toBe(false);
    expect(transcriptionHasUnreadableGap("")).toBe(false);
  });

  it("does not fire on empty brackets", () => {
    expect(transcriptionHasUnreadableGap("a[]b")).toBe(false);
  });
});
