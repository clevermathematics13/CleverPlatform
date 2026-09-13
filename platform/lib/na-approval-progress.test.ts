import { describe, it, expect } from "vitest";
import { summariseApprovalProgress, type ScanApprovalTally } from "./na-scanning";

const scan = (over: Partial<ScanApprovalTally> = {}): ScanApprovalTally => ({
  gradable: 39,
  approved: 0,
  released: 0,
  ...over,
});

describe("summariseApprovalProgress", () => {
  it("splits A.1's real distribution the way the board reports it", () => {
    // One student finished and released; eight approvals scattered one or four
    // at a time across five others; the rest untouched. The raw count of 47
    // reads like a sixth of the class and is actually one student.
    const out = summariseApprovalProgress([
      scan({ approved: 39, released: 39 }), // Davi Verma
      scan({ approved: 4 }), // Giulia Bernal
      scan({ approved: 1 }), // Freya Delisle
      scan({ approved: 1 }), // Kaito Fujii
      scan({ approved: 1 }), // Santiago Caipo
      scan({ approved: 1 }), // an unmatched scan
      ...Array.from({ length: 38 }, () => scan()),
    ]);
    expect(out).toEqual({
      approved: 47,
      completeScans: 1,
      releasedScans: 1,
      readyScans: 0,
      approvedOnComplete: 39,
      partialScans: 5,
      approvedOnPartial: 8,
    });
  });

  it("separates finished-but-unsent from finished-and-sent", () => {
    const out = summariseApprovalProgress([
      scan({ approved: 39, released: 39 }),
      scan({ approved: 39, released: 0 }),
    ]);
    expect(out.completeScans).toBe(2);
    expect(out.releasedScans).toBe(1);
    expect(out.readyScans).toBe(1);
  });

  it("counts a scan whose pages were never captured against the crops it has", () => {
    // Zaira lost the last four pages, so her scan holds 35 gradable crops --
    // and the release route lets her be released once those 35 are approved.
    // Measuring against the packet's anchor count would strand her forever.
    const out = summariseApprovalProgress([scan({ gradable: 35, approved: 35 })]);
    expect(out.completeScans).toBe(1);
    expect(out.readyScans).toBe(1);
    expect(out.partialScans).toBe(0);
  });

  it("does not call an untouched scan part-reviewed", () => {
    const out = summariseApprovalProgress([scan({ approved: 0 }), scan({ approved: 0 })]);
    expect(out.partialScans).toBe(0);
    expect(out.completeScans).toBe(0);
    expect(out.approved).toBe(0);
  });

  it("skips a scan with nothing gradable rather than calling it finished", () => {
    // A crop set that is all thinking space: 0 of 0 approved is not an
    // achievement, and counting it would inflate "packets finished".
    const out = summariseApprovalProgress([scan({ gradable: 0 }), scan({ approved: 39, released: 39 })]);
    expect(out.completeScans).toBe(1);
    expect(out.releasedScans).toBe(1);
  });

  it("handles an empty packet version", () => {
    expect(summariseApprovalProgress([]).approved).toBe(0);
    expect(summariseApprovalProgress([]).completeScans).toBe(0);
  });
});
