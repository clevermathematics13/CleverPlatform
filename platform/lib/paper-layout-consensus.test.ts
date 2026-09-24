import { describe, it, expect } from "vitest";
import {
  CONSENSUS_MIN_GAP,
  CONSENSUS_X_CLAMP,
  proposeLayoutFromObservations,
  quantile,
  type ConsensusObservation,
} from "./paper-layout-consensus";

/**
 * Key Assessment 1 (Grade 9 Standard): the class median of the stored top
 * edge for each part across the 18 latest runs, 23 Sep 2026, with the page
 * the marker put every student's part on. Page 4 carries the one inversion
 * the real data has: Q5's median top (0.43) sits ABOVE 4(c)'s (0.49).
 */
const KA1_MEDIANS: { q: number; p: string | null; page: number; top: number }[] = [
  { q: 1, p: "a", page: 2, top: 0.02 },
  { q: 1, p: "b", page: 2, top: 0.11 },
  { q: 1, p: "c", page: 2, top: 0.3 },
  { q: 2, p: "a", page: 2, top: 0.39 },
  { q: 2, p: "b", page: 2, top: 0.45 },
  { q: 2, p: "c", page: 2, top: 0.59 },
  { q: 2, p: "d", page: 2, top: 0.74 },
  { q: 3, p: "a", page: 3, top: 0.07 },
  { q: 3, p: "b", page: 3, top: 0.21 },
  { q: 3, p: "c", page: 3, top: 0.48 },
  { q: 4, p: "a", page: 4, top: 0.11 },
  { q: 4, p: "b", page: 4, top: 0.21 },
  { q: 4, p: "c", page: 4, top: 0.49 },
  { q: 5, p: null, page: 4, top: 0.43 },
  { q: 8, p: null, page: 7, top: 0.0 },
];

const OFFSETS = [-0.04, -0.02, 0, 0.02, 0.04];

/** Five students per part, scattered around the median as the class really is. */
function ka1Observations(): ConsensusObservation[] {
  const out: ConsensusObservation[] = [];
  KA1_MEDIANS.forEach((m, sortOrder) => {
    for (const d of OFFSETS) {
      const y0 = Math.max(0, Math.min(1, m.top + d));
      out.push({
        questionNumber: m.q,
        partLabel: m.p,
        sortOrder,
        kind: "stored",
        box: { page: m.page, x0: 0.05, y0, x1: 0.95, y1: Math.min(1, y0 + 0.25) },
      });
    }
  });
  return out;
}

const regionFor = (regions: ReturnType<typeof proposeLayoutFromObservations>["regions"], q: number, p: string | null) =>
  regions.find((r) => r.questionNumber === q && r.partLabel === p)!;

describe("quantile", () => {
  it("interpolates on an even-length list and picks the middle of an odd one", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3], 0.5)).toBe(2);
    expect(quantile([10, 20, 30, 40, 50], 0.05)).toBeCloseTo(12, 10);
    expect(quantile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 10);
    expect(quantile([7], 0.5)).toBe(7);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe("proposeLayoutFromObservations", () => {
  const { regions, warnings } = proposeLayoutFromObservations(ka1Observations(), 8);

  it("runs each part from its median top to the next part's median top on the page", () => {
    expect(regionFor(regions, 1, "c")).toMatchObject({ pageIndex: 1, observations: 5 });
    expect(regionFor(regions, 1, "c").y0).toBeCloseTo(0.3, 10);
    expect(regionFor(regions, 1, "c").y1).toBeCloseTo(0.39, 10);
    expect(regionFor(regions, 2, "a").y0).toBeCloseTo(0.39, 10);
    expect(regionFor(regions, 2, "a").y1).toBeCloseTo(0.45, 10);
    expect(regionFor(regions, 1, "a").y0).toBeCloseTo(0.02, 10);
    expect(regionFor(regions, 1, "a").y1).toBeCloseTo(0.11, 10);
  });

  it("runs the last part on a page to the foot of the page", () => {
    expect(regionFor(regions, 2, "d").y0).toBeCloseTo(0.74, 10);
    expect(regionFor(regions, 2, "d").y1).toBe(1);
    expect(regionFor(regions, 3, "c").y1).toBe(1);
    expect(regionFor(regions, 8, null)).toMatchObject({ pageIndex: 6, y0: 0, y1: 1 });
  });

  it("flags the KA1 inversion and gives the earlier part its own median bottom", () => {
    // Q5 is the next part after 4(c) on page 4, but its median top is above
    // 4(c)'s, so 4(c) cannot run down to it.
    const fourC = regionFor(regions, 4, "c");
    expect(fourC.y0).toBeCloseTo(0.49, 10);
    expect(fourC.y1).toBeCloseTo(0.74, 10);
    expect(regionFor(regions, 5, null).y0).toBeCloseTo(0.43, 10);
    expect(regionFor(regions, 5, null).y1).toBe(1);
    expect(warnings.some((w) => w.includes("Q4(c)") && w.includes("Q5") && w.includes("out of reading order"))).toBe(true);
    // Nothing else on the fixture is worth a warning.
    expect(warnings).toHaveLength(1);
  });

  it("uses one content width for the paper, from the class's x edges", () => {
    for (const r of regions) {
      expect(r.x0).toBeCloseTo(0.05, 10);
      expect(r.x1).toBeCloseTo(0.95, 10);
    }
  });

  it("proposes every part exactly once, in reading order", () => {
    expect(regions).toHaveLength(KA1_MEDIANS.length);
    for (let i = 1; i < regions.length; i++) {
      const a = regions[i - 1];
      const b = regions[i];
      expect(a.pageIndex < b.pageIndex || (a.pageIndex === b.pageIndex && a.y0 <= b.y0)).toBe(true);
    }
  });

  it("warns about a part seen fewer than three times but still proposes it", () => {
    const few = ka1Observations().filter((o) => !(o.questionNumber === 3 && o.partLabel === "b") || o.box.y0 < 0.2);
    const out = proposeLayoutFromObservations(few, 8);
    expect(regionFor(out.regions, 3, "b")).toBeDefined();
    expect(out.warnings.some((w) => w.startsWith("Q3(b): only 2 of the class's boxes"))).toBe(true);
  });

  it("keeps the modal page when a minority of students land elsewhere, and says so", () => {
    const obs = ka1Observations().map((o) =>
      o.questionNumber === 3 && o.partLabel === "a" && o.box.y0 < 0.07 ? { ...o, box: { ...o.box, page: 4 } } : o
    );
    const out = proposeLayoutFromObservations(obs, 8);
    expect(regionFor(out.regions, 3, "a")).toMatchObject({ pageIndex: 2, observations: 3 });
    expect(out.warnings.some((w) => w.startsWith("Q3(a): the marker put it on page 3 for most students but elsewhere for 2 of 5"))).toBe(true);
  });

  it("skips a part whose page is outside the paper, with a warning", () => {
    const out = proposeLayoutFromObservations(ka1Observations(), 6);
    expect(out.regions.find((r) => r.questionNumber === 8)).toBeUndefined();
    expect(out.warnings.some((w) => w.startsWith("Q8: the marker's page (7) is outside this 6-page paper"))).toBe(true);
  });

  it("clamps the content width to the page's usable extent", () => {
    const obs = ka1Observations().map((o) => ({ ...o, box: { ...o.box, x0: 0, x1: 1 } }));
    const out = proposeLayoutFromObservations(obs, 8);
    expect(out.regions[0].x0).toBe(CONSENSUS_X_CLAMP[0]);
    expect(out.regions[0].x1).toBe(CONSENSUS_X_CLAMP[1]);
  });

  it("treats two tops closer than the minimum gap as the same place", () => {
    const obs: ConsensusObservation[] = [];
    for (const d of OFFSETS) {
      obs.push({ questionNumber: 1, partLabel: "a", sortOrder: 0, kind: "reported", box: { page: 1, x0: 0.1, y0: 0.3 + d, x1: 0.9, y1: 0.5 + d } });
      obs.push({ questionNumber: 1, partLabel: "b", sortOrder: 1, kind: "reported", box: { page: 1, x0: 0.1, y0: 0.3 + CONSENSUS_MIN_GAP / 2 + d, x1: 0.9, y1: 0.6 + d } });
    }
    const out = proposeLayoutFromObservations(obs, 1);
    expect(regionFor(out.regions, 1, "a").y1).toBeCloseTo(0.5, 10);
    expect(out.warnings).toHaveLength(1);
  });

  it("proposes nothing from nothing", () => {
    expect(proposeLayoutFromObservations([], 8)).toEqual({ regions: [], warnings: [] });
  });
});
