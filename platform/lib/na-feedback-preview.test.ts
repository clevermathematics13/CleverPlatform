import { describe, it, expect } from "vitest";
import { describeEmptyFeedbackPreview, naScanStatusRank } from "./na-feedback-preview";

describe("naScanStatusRank", () => {
  it("orders the pipeline so released is furthest along", () => {
    expect(naScanStatusRank("split")).toBeLessThan(naScanStatusRank("cropped"));
    expect(naScanStatusRank("cropped")).toBeLessThan(naScanStatusRank("assessed"));
    expect(naScanStatusRank("assessed")).toBeLessThan(naScanStatusRank("reviewed"));
    expect(naScanStatusRank("reviewed")).toBeLessThan(naScanStatusRank("released"));
  });

  it("sorts an unknown status below every real one, so it never reads as progress", () => {
    expect(naScanStatusRank("who-knows")).toBe(-1);
    expect(naScanStatusRank("who-knows")).toBeLessThan(naScanStatusRank("pending"));
  });
});

describe("describeEmptyFeedbackPreview", () => {
  // The case that started this: Agustina Fernandez's 9G roster row exists and
  // resolves, her class was scanned, but no packet scan was ever matched to
  // her -- so the old copy said "No feedback has been released to you yet."
  // and read as a broken feature.
  it("says no scan was matched when the student has no packet scan at all", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "Agustina", scanStatuses: [] });
    expect(copy.headline).toBe("No packet scan has been matched to Agustina yet.");
    expect(copy.detail).toContain("split step");
    // Never the student-voiced line this replaced.
    expect(copy.headline).not.toContain("released to you");
  });

  it("names the release step when the packet is marked but unreleased", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "Davi", scanStatuses: ["assessed"] });
    expect(copy.headline).toBe("Davi's packet scan has been marked but not released yet.");
    expect(copy.detail).toContain("release");
  });

  it("distinguishes cropped-not-marked from marked-not-released", () => {
    const cropped = describeEmptyFeedbackPreview({ studentName: "Yani", scanStatuses: ["cropped"] });
    const assessed = describeEmptyFeedbackPreview({ studentName: "Yani", scanStatuses: ["assessed"] });
    expect(cropped.headline).toContain("not marked yet");
    expect(assessed.headline).toContain("not released yet");
    expect(cropped.headline).not.toBe(assessed.headline);
  });

  it("treats a freshly split scan as uploaded but unprocessed", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "Irene", scanStatuses: ["split"] });
    expect(copy.headline).toContain("uploaded but not processed yet");
  });

  it("describes the furthest-along scan when a student has several", () => {
    const copy = describeEmptyFeedbackPreview({
      studentName: "Maia",
      scanStatuses: ["split", "assessed", "cropped"],
    });
    expect(copy.headline).toContain("not released yet");
    // Speaks for the ONE scan it is describing, never for all three -- only
    // one of Maia's is marked, and claiming otherwise is the exact
    // confidently-wrong sentence this module exists to prevent.
    expect(copy.headline).toBe("The furthest along of Maia's 3 packet scans has been marked but not released yet.");
    // A headline OPENING "Maia's 3 packet scans has been marked" would be
    // both ungrammatical and false; "The furthest along of ... scans has" is
    // neither, so the check has to be anchored rather than a substring.
    expect(copy.headline).not.toMatch(/^Maia's 3 packet scans has been/);
    expect(copy.detail).toContain("The other 2 are further back");
  });

  // Seven students on the live roster sit at exactly this pair, so this is
  // the multi-scan shape the page actually renders today.
  it("does not claim a still-uncropped second scan has been cropped", () => {
    const copy = describeEmptyFeedbackPreview({
      studentName: "Evelyn",
      scanStatuses: ["cropped", "split"],
    });
    expect(copy.headline).toBe(
      "The furthest along of Evelyn's 2 packet scans has been split into answers but not marked yet."
    );
    expect(copy.detail).toContain("The other one is further back");
  });

  it("speaks for every scan, with plural agreement, only when they are all at one stage", () => {
    const copy = describeEmptyFeedbackPreview({
      studentName: "Emilia",
      scanStatuses: ["cropped", "cropped"],
    });
    expect(copy.headline).toBe("Emilia's 2 packet scans have been split into answers but not marked yet.");
    expect(copy.detail).toContain("release the packets");
    expect(copy.detail).not.toContain("further back");
  });

  it("keeps singular agreement for a single scan", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "Davi", scanStatuses: ["cropped"] });
    expect(copy.headline).toBe("Davi's packet scan has been split into answers but not marked yet.");
    expect(copy.detail).toContain("release the packet.");
  });

  it("never attaches a singular verb to the student's whole set of scans", () => {
    const shapes = [
      ["cropped", "split"],
      ["cropped", "cropped"],
      ["assessed", "split", "cropped"],
      ["released", "split"],
      ["quarantined", "split"],
      ["reviewed", "reviewed"],
    ];
    for (const scanStatuses of shapes) {
      const { headline } = describeEmptyFeedbackPreview({ studentName: "Test", scanStatuses });
      // The broken form is the one where the student's whole set of scans is
      // itself the subject -- "Test's 2 packet scans has ...". Anchored,
      // because "The furthest along of Test's 2 packet scans has ..." is
      // correct: its head noun is singular.
      expect(headline).not.toMatch(/^Test's \d+ packet scans (has|is) /);
    }
  });

  it("ignores status order in the input", () => {
    const a = describeEmptyFeedbackPreview({ studentName: "Maia", scanStatuses: ["assessed", "split"] });
    const b = describeEmptyFeedbackPreview({ studentName: "Maia", scanStatuses: ["split", "assessed"] });
    expect(a).toEqual(b);
  });

  it("flags released-but-empty as the contradiction it is, not as unfinished marking", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "Davi", scanStatuses: ["released"] });
    expect(copy.headline).toContain("marked released");
    expect(copy.detail).toContain("should not happen");
  });

  it("falls back readably on a status the pipeline does not know", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "Rafael", scanStatuses: ["quarantined"] });
    expect(copy.headline).toContain("not ready to release yet");
    expect(copy.detail).toContain("quarantined");
  });

  it("substitutes a generic subject rather than rendering an empty name", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "   ", scanStatuses: [] });
    expect(copy.headline).toBe("No packet scan has been matched to This student yet.");
  });

  it("ignores empty strings in the status list", () => {
    const copy = describeEmptyFeedbackPreview({ studentName: "Alonso", scanStatuses: ["", ""] });
    expect(copy.headline).toBe("No packet scan has been matched to Alonso yet.");
  });
});
