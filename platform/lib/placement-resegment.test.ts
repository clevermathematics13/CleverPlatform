import { describe, it, expect } from "vitest";
import { canResegment, resegmentBlockedReason } from "./placement-resegment";

describe("resegmentBlockedReason", () => {
  it("allows a retry on a paper nobody has marked", () => {
    expect(resegmentBlockedReason(0)).toBeNull();
    expect(canResegment(0)).toBe(true);
  });

  it("refuses as soon as a single mark exists", () => {
    const reason = resegmentBlockedReason(1);
    expect(reason).not.toBeNull();
    expect(canResegment(1)).toBe(false);
    // Says what would be lost, not just that something is wrong.
    expect(reason).toContain("1 mark");
    expect(reason).toContain("delete");
  });

  it("counts in the plural past one", () => {
    expect(resegmentBlockedReason(12)).toContain("12 marks");
  });

  it("tells the teacher what to do instead", () => {
    const reason = resegmentBlockedReason(3) ?? "";
    expect(reason).toMatch(/grade it again/i);
    expect(reason).toMatch(/upload it again|re-upload/i);
  });

  it("treats a missing or nonsensical count as nothing to protect", () => {
    // A count that came back null reads as 0 at the call sites; negative is
    // not reachable, but refusing to segment over one would be a stuck test.
    expect(resegmentBlockedReason(-1)).toBeNull();
  });
});
