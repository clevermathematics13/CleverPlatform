import { describe, it, expect } from "vitest";
import { missingAnchorCause } from "./na-scanning";

// A.1 has 40 anchors in sort_order; these ids stand in for them.
const ALL = Array.from({ length: 40 }, (_, i) => `a${i}`);
const present = (missing: string[]) => new Set(ALL.filter((id) => !missing.includes(id)));

describe("missingAnchorCause", () => {
  it("returns null when the scan is complete", () => {
    expect(missingAnchorCause(ALL, new Set(ALL))).toBeNull();
  });

  it("calls a trailing run pages, since the scan ran out", () => {
    // Vania: last 2 anchors, from a source PDF two pages short.
    expect(missingAnchorCause(ALL, present(["a38", "a39"]))).toBe("pages");
    // Zaira: last 4.
    expect(missingAnchorCause(ALL, present(["a36", "a37", "a38", "a39"]))).toBe("pages");
    // The degenerate end of the same case: nothing cropped at all.
    expect(missingAnchorCause(ALL, new Set())).toBe("pages");
  });

  it("calls an interior gap crops, since the page was there", () => {
    // The three assessed scans missing only Q26(a), which is mid-packet.
    expect(missingAnchorCause(ALL, present(["a25"]))).toBe("crops");
    expect(missingAnchorCause(ALL, present(["a0"]))).toBe("crops");
  });

  it("calls a gap plus a trailing run crops, not pages", () => {
    // A short scan explains the tail but not the hole, so the hole decides:
    // treating this as "pages" would tell the teacher to rescan and stop,
    // leaving the interior anchor uncropped forever.
    expect(missingAnchorCause(ALL, present(["a10", "a38", "a39"]))).toBe("crops");
  });

  it("treats the whole tail as pages even when it is one anchor", () => {
    expect(missingAnchorCause(ALL, present(["a39"]))).toBe("pages");
  });
});
