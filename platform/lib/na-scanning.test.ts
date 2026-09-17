import { describe, it, expect } from "vitest";
import {
  buildCoverPageEscalationUserPrompt,
  mergeEscalatedCoverPageCheck,
  needsNameEscalation,
  transcriptionHasUnreadableGap,
  transcriptionStatesTruncation,
  type CoverPageCheck,
} from "./na-scanning";

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

// Every string below is a real A.1 or A.2 transcription. The board lists an
// unflagged crop on this predicate alone, so a miss here hides a response the
// crop detector already failed to flag -- which is how these eleven went
// unreported until they were counted by hand.
describe("transcriptionStatesTruncation", () => {
  describe("catches the assessor saying the work runs past the edge", () => {
    it("catches the phrasing the first version already had", () => {
      expect(transcriptionStatesTruncation("Row 6: using cost and number of people to find [cut off]")).toBe(true);
      expect(transcriptionStatesTruncation("Row 3: rate of change [continues beyond crop]")).toBe(true);
      expect(transcriptionStatesTruncation("The last line is cut off at the right edge.")).toBe(true);
    });

    it("catches a direction word other than 'beyond'", () => {
      // Q29 and Q14 on A.1, Q3(b) and Q4 on A.2 -- none flagged, all missed
      // while the pattern was the fixed pair "continues beyond".
      expect(
        transcriptionStatesTruncation(
          "the difference between the cost of the tickets and the amount of [continues below crop]"
        )
      ).toBe(true);
      expect(
        transcriptionStatesTruncation(
          "are 5 less than p, which can be written as p-5. Considering [continues off crop]"
        )
      ).toBe(true);
      expect(transcriptionStatesTruncation("Definition: One of the things being [and more continues at edge]")).toBe(
        true
      );
    });

    it("catches the singular verb", () => {
      // Q18 and Q19(b) on A.1 missed on nothing but "continue" vs "continues".
      expect(
        transcriptionStatesTruncation("we get the same [answer/result - text appears to continue beyond crop]")
      ).toBe(true);
      expect(transcriptionStatesTruncation("\u03c0, -1/3, -6\n(appears to continue below crop)")).toBe(true);
    });
  });

  describe("does not fire on the word alone", () => {
    it("ignores 'continues' with no direction word", () => {
      expect(transcriptionStatesTruncation("Row 2: the pattern continues")).toBe(false);
      expect(transcriptionStatesTruncation("the sequence continues to grow by 5 each time")).toBe(false);
    });

    it("ignores a direction word with no verb", () => {
      expect(transcriptionStatesTruncation("30 minutes past the hour")).toBe(false);
      expect(transcriptionStatesTruncation("the answer is written below the box")).toBe(false);
    });

    it("handles absent and empty transcriptions", () => {
      expect(transcriptionStatesTruncation(null)).toBe(false);
      expect(transcriptionStatesTruncation(undefined)).toBe(false);
      expect(transcriptionStatesTruncation("")).toBe(false);
    });
  });

  describe("is narrower than the full gap heuristic", () => {
    it("does not count a bracketed reconstruction", () => {
      // The whole point of the split: over unflagged crops a bracket is mostly
      // illegible handwriting, so the board must not list one on that basis.
      const bracketOnly = "the total will remain the same because the express[ions are equivalent]";
      expect(transcriptionHasUnreadableGap(bracketOnly)).toBe(true);
      expect(transcriptionStatesTruncation(bracketOnly)).toBe(false);
    });

    it("still feeds the full heuristic", () => {
      const stated = "Row 3: rate of change [continues below crop]";
      expect(transcriptionStatesTruncation(stated)).toBe(true);
      expect(transcriptionHasUnreadableGap(stated)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Second read of an unmatched cover page
// ---------------------------------------------------------------------------

function check(overrides: Partial<CoverPageCheck> = {}): CoverPageCheck {
  return {
    isCoverPage: true,
    studentName: "Nicolite",
    rosterMatch: null,
    confidence: "low",
    note: "handwriting is difficult to read",
    ...overrides,
  };
}

describe("needsNameEscalation", () => {
  it("asks for a second read of a cover page with a roster and no match", () => {
    expect(needsNameEscalation(check(), 9)).toBe(true);
  });

  it("asks even when the first read could not read the name at all", () => {
    expect(needsNameEscalation(check({ studentName: null }), 9)).toBe(true);
  });

  it("leaves a matched cover page alone", () => {
    expect(needsNameEscalation(check({ rosterMatch: "Vicente Alarcon" }), 9)).toBe(false);
  });

  it("treats a blank roster match as no match", () => {
    expect(needsNameEscalation(check({ rosterMatch: "  " }), 9)).toBe(true);
  });

  it("never asks about a page that is not a cover page", () => {
    expect(needsNameEscalation(check({ isCoverPage: false }), 9)).toBe(false);
  });

  it("has nothing to ask when no roster was supplied", () => {
    expect(needsNameEscalation(check(), 0)).toBe(false);
  });
});

describe("buildCoverPageEscalationUserPrompt", () => {
  const roster = ["Vicente Alarcon", "Vania De Los Heros"];

  it("tells the model what the first read saw and lists the roster", () => {
    const prompt = buildCoverPageEscalationUserPrompt(roster, check());
    expect(prompt).toContain('transcribed the handwritten name as "Nicolite"');
    expect(prompt).toContain("ROSTER (2 students");
    expect(prompt).toContain("- Vicente Alarcon");
    expect(prompt).toContain("- Vania De Los Heros");
    expect(prompt).toContain("Return the JSON object now.");
  });

  it("says so when the first read had no name to offer", () => {
    const prompt = buildCoverPageEscalationUserPrompt(roster, check({ studentName: null }));
    expect(prompt).toContain("could not read the handwritten name");
    expect(prompt).not.toContain("transcribed");
  });
});

describe("mergeEscalatedCoverPageCheck", () => {
  it("takes the second read's match, confidence and reading, and records both readings", () => {
    const merged = mergeEscalatedCoverPageCheck(
      check(),
      check({ studentName: "Vicente", rosterMatch: "Vicente Alarcon", confidence: "high", note: "looped V, n read as li" })
    );
    expect(merged.rosterMatch).toBe("Vicente Alarcon");
    expect(merged.studentName).toBe("Vicente");
    expect(merged.confidence).toBe("high");
    expect(merged.note).toContain("looped V, n read as li");
    expect(merged.note).toContain("first read as 'Nicolite'");
    expect(merged.note).toContain("matched to 'Vicente Alarcon' on a second read");
  });

  it("never lets the second read flip the cover-page decision", () => {
    const merged = mergeEscalatedCoverPageCheck(
      check(),
      check({ isCoverPage: false, rosterMatch: "Vicente Alarcon", confidence: "high" })
    );
    expect(merged.isCoverPage).toBe(true);
    expect(merged.rosterMatch).toBe("Vicente Alarcon");
  });

  it("keeps the first verdict when the second read matches nobody either, noting the attempt", () => {
    const merged = mergeEscalatedCoverPageCheck(check(), check({ studentName: "Nicolete", note: "still unclear" }));
    expect(merged.rosterMatch).toBeNull();
    expect(merged.confidence).toBe("low");
    expect(merged.studentName).toBe("Nicolete");
    expect(merged.note).toContain("handwriting is difficult to read");
    expect(merged.note).toContain("read it as 'Nicolete'");
    expect(merged.note).toContain("could not match it to the roster either");
  });

  it("keeps the first reading when the second read has none", () => {
    const merged = mergeEscalatedCoverPageCheck(check(), check({ studentName: null, note: "" }));
    expect(merged.studentName).toBe("Nicolite");
    expect(merged.note).toContain("a second read could not match it to the roster either");
  });

  it("falls back to the first reading when the match arrives without one", () => {
    const merged = mergeEscalatedCoverPageCheck(
      check(),
      check({ studentName: "  ", rosterMatch: "Vicente Alarcon", confidence: "medium", note: "" })
    );
    expect(merged.studentName).toBe("Nicolite");
    expect(merged.note).toBe("first read as 'Nicolite', matched to 'Vicente Alarcon' on a second read");
  });
});
