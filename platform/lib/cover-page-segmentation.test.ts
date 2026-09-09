import { describe, expect, it } from "vitest";
import {
  planSegmentsFromCoverVerdicts,
  segmentByCoverPages,
  QUICK_READ_CONCURRENCY,
  QUICK_READ_MAX_PAGES,
  type CoverPageSegmentationPlan,
  type CoverPageVerdict,
} from "./cover-page-segmentation";
import type { CoverPageCheck } from "./na-scanning";

/** A cover-page verdict, named by whichever of the two name fields is given. */
function cover(page: number, fields: Partial<CoverPageVerdict> = {}): CoverPageVerdict {
  return {
    page,
    isCoverPage: true,
    studentName: null,
    rosterMatch: null,
    confidence: "high",
    note: "",
    ...fields,
  };
}

/** A page inside a student's script. */
function body(page: number): CoverPageVerdict {
  return { page, isCoverPage: false, studentName: null, rosterMatch: null, confidence: "high", note: "" };
}

/** A page whose check threw or came back unusable. */
function failed(page: number): CoverPageVerdict {
  return {
    page,
    isCoverPage: false,
    studentName: null,
    rosterMatch: null,
    confidence: "low",
    note: "model down",
    checkFailed: true,
  };
}

/**
 * Every page the plan accounts for, ascending. Compared against 1..pageCount
 * this asserts the invariant the route depends on: each page belongs to
 * exactly one student or to unassignedPages, never both and never neither.
 */
function coverage(plan: CoverPageSegmentationPlan): number[] {
  return [...plan.students.flatMap((s) => s.pages), ...plan.unassignedPages].sort((a, b) => a - b);
}

function pages(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

describe("planSegmentsFromCoverVerdicts", () => {
  it("runs each student from their cover page to the page before the next", () => {
    const verdicts = pages(12).map((p) => ([1, 5, 9].includes(p) ? cover(p, { studentName: `S${p}` }) : body(p)));
    const plan = planSegmentsFromCoverVerdicts(12, verdicts);

    expect(plan.students.map((s) => s.pages)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ]);
    expect(plan.students.map((s) => s.label)).toEqual(["S1", "S5", "S9"]);
    expect(plan.unassignedPages).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(coverage(plan)).toEqual(pages(12));
  });

  it("gives the trailing pages after the last cover to the last student", () => {
    const verdicts = pages(10).map((p) => (p === 1 || p === 4 ? cover(p, { studentName: `S${p}` }) : body(p)));
    const plan = planSegmentsFromCoverVerdicts(10, verdicts);

    expect(plan.students.map((s) => s.pages)).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7, 8, 9, 10],
    ]);
    expect(coverage(plan)).toEqual(pages(10));
  });

  it("carries each student's confidence and note from their own cover verdict", () => {
    const plan = planSegmentsFromCoverVerdicts(4, [
      cover(1, { studentName: "A", confidence: "high", note: "clear name field" }),
      body(2),
      cover(3, { studentName: "B", confidence: "low", note: "smudged" }),
      body(4),
    ]);
    expect(plan.students.map((s) => [s.confidence, s.note])).toEqual([
      ["high", "clear name field"],
      ["low", "smudged"],
    ]);
  });

  it("prefers the roster match over the raw handwriting read", () => {
    const plan = planSegmentsFromCoverVerdicts(2, [
      cover(1, { studentName: "Maria Fernandez", rosterMatch: "  María Fernández Soto  " }),
      body(2),
    ]);
    expect(plan.students[0].label).toBe("María Fernández Soto");
    expect(plan.warnings).toEqual([]);
  });

  it("falls back to the handwriting read when no roster match was made", () => {
    const plan = planSegmentsFromCoverVerdicts(2, [
      cover(1, { studentName: " Maria Fernandez ", rosterMatch: null }),
      body(2),
    ]);
    expect(plan.students[0].label).toBe("Maria Fernandez");
    expect(plan.warnings).toEqual([]);
  });

  it("labels an unreadable cover page by its page number and warns", () => {
    const plan = planSegmentsFromCoverVerdicts(4, [
      cover(1, { studentName: "A" }),
      body(2),
      cover(3, { studentName: "   ", rosterMatch: null }),
      body(4),
    ]);
    expect(plan.students[1].label).toBe("(name unreadable, page 3)");
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("page 3");
    expect(coverage(plan)).toEqual(pages(4));
  });

  it("leaves the pages before the first cover unassigned with one warning naming them", () => {
    const verdicts = pages(8).map((p) => (p === 3 || p === 6 ? cover(p, { studentName: `S${p}` }) : body(p)));
    const plan = planSegmentsFromCoverVerdicts(8, verdicts);

    expect(plan.unassignedPages).toEqual([1, 2]);
    expect(plan.students.map((s) => s.pages)).toEqual([
      [3, 4, 5],
      [6, 7, 8],
    ]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("1-2");
    expect(plan.warnings[0]).toContain("Deep read");
    expect(coverage(plan)).toEqual(pages(8));
  });

  it("does not warn about leading pages when page 1 is a cover", () => {
    const verdicts = pages(4).map((p) => (p === 1 ? cover(p, { studentName: "A" }) : body(p)));
    expect(planSegmentsFromCoverVerdicts(4, verdicts).warnings).toEqual([]);
  });

  it("keeps a failed check with the student it interrupts and names the page", () => {
    const plan = planSegmentsFromCoverVerdicts(6, [
      cover(1, { studentName: "A" }),
      body(2),
      failed(3),
      body(4),
      cover(5, { studentName: "B" }),
      body(6),
    ]);
    expect(plan.students.map((s) => s.pages)).toEqual([
      [1, 2, 3, 4],
      [5, 6],
    ]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("Page 3");
    expect(coverage(plan)).toEqual(pages(6));
  });

  it("treats a page with no verdict at all like a failed check", () => {
    const plan = planSegmentsFromCoverVerdicts(4, [cover(1, { studentName: "A" }), body(2), body(4)]);
    expect(plan.students.map((s) => s.pages)).toEqual([[1, 2, 3, 4]]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("Page 3");
    expect(coverage(plan)).toEqual(pages(4));
  });

  it("returns no students and every page unassigned when nothing looks like a cover", () => {
    const plan = planSegmentsFromCoverVerdicts(5, pages(5).map(body));
    expect(plan.students).toEqual([]);
    expect(plan.unassignedPages).toEqual(pages(5));
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("Deep read");
    expect(coverage(plan)).toEqual(pages(5));
  });

  it("ignores verdicts for pages outside the document", () => {
    const plan = planSegmentsFromCoverVerdicts(3, [
      cover(0, { studentName: "ghost" }),
      cover(1, { studentName: "A" }),
      body(2),
      body(3),
      cover(9, { studentName: "ghost" }),
    ]);
    expect(plan.students.map((s) => [s.label, s.pages])).toEqual([["A", [1, 2, 3]]]);
    expect(coverage(plan)).toEqual(pages(3));
  });

  it("produces the same plan whatever order the verdicts arrive in", () => {
    const inOrder = pages(9).map((p) => ([1, 4, 7].includes(p) ? cover(p, { studentName: `S${p}` }) : body(p)));
    const shuffled = [7, 2, 9, 1, 5, 8, 4, 3, 6].map((p) => inOrder[p - 1]);
    expect(planSegmentsFromCoverVerdicts(9, shuffled)).toEqual(planSegmentsFromCoverVerdicts(9, inOrder));
  });

  it("reports an empty document rather than inventing a student", () => {
    const plan = planSegmentsFromCoverVerdicts(0, []);
    expect(plan).toEqual({ students: [], unassignedPages: [], warnings: ["Empty document."] });
  });
});

describe("segmentByCoverPages", () => {
  /** A fake page check with cover pages at the given 1-indexed pages. */
  function checksWithCoversAt(coverPages: number[]) {
    const calls: number[] = [];
    const checkPage = async (page: number): Promise<CoverPageCheck> => {
      calls.push(page);
      const isCoverPage = coverPages.includes(page);
      return {
        isCoverPage,
        studentName: isCoverPage ? `S${page}` : null,
        rosterMatch: null,
        confidence: "high",
        note: "",
      };
    };
    return { checkPage, calls };
  }

  it("checks every page exactly once and plans from the answers", async () => {
    const { checkPage, calls } = checksWithCoversAt([1, 5]);
    const plan = await segmentByCoverPages({ pageCount: 8, checkPage, concurrency: 4 });

    expect(plan.pagesChecked).toBe(8);
    expect([...calls].sort((a, b) => a - b)).toEqual(pages(8));
    expect(plan.students.map((s) => [s.label, s.pages])).toEqual([
      ["S1", [1, 2, 3, 4]],
      ["S5", [5, 6, 7, 8]],
    ]);
    expect(coverage(plan)).toEqual(pages(8));
  });

  it("turns one page's thrown check into a flagged page, not a lost upload", async () => {
    const calls: number[] = [];
    const checkPage = async (page: number): Promise<CoverPageCheck> => {
      calls.push(page);
      if (page === 4) throw new Error("model overloaded");
      return {
        isCoverPage: page === 1 || page === 5,
        studentName: page === 1 || page === 5 ? `S${page}` : null,
        rosterMatch: null,
        confidence: "high",
        note: "",
      };
    };

    const plan = await segmentByCoverPages({ pageCount: 6, checkPage, concurrency: 2 });

    expect(plan.pagesChecked).toBe(6);
    expect([...calls].sort((a, b) => a - b)).toEqual(pages(6));
    expect(plan.students.map((s) => s.pages)).toEqual([
      [1, 2, 3, 4],
      [5, 6],
    ]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("Page 4");
    expect(coverage(plan)).toEqual(pages(6));
  });

  it("flags a page whose check answers with something unusable", async () => {
    const checkPage = async (page: number): Promise<CoverPageCheck> =>
      page === 2
        ? (null as unknown as CoverPageCheck)
        : { isCoverPage: page === 1, studentName: "A", rosterMatch: null, confidence: "high", note: "" };

    const plan = await segmentByCoverPages({ pageCount: 3, checkPage, concurrency: 1 });

    expect(plan.students.map((s) => s.pages)).toEqual([[1, 2, 3]]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("Page 2");
    expect(plan.pagesChecked).toBe(3);
  });

  it("never runs more checks at once than the concurrency allows", async () => {
    let inFlight = 0;
    let peak = 0;
    const checkPage = async (page: number): Promise<CoverPageCheck> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { isCoverPage: page === 1, studentName: "A", rosterMatch: null, confidence: "high", note: "" };
    };

    const plan = await segmentByCoverPages({ pageCount: 20, checkPage, concurrency: 3 });

    expect(peak).toBe(3);
    expect(plan.pagesChecked).toBe(20);
    expect(coverage(plan)).toEqual(pages(20));
  });

  it("clamps the concurrency to at least one and to the page count", async () => {
    let peak = 0;
    let inFlight = 0;
    const checkPage = async (): Promise<CoverPageCheck> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { isCoverPage: true, studentName: "A", rosterMatch: null, confidence: "high", note: "" };
    };

    expect((await segmentByCoverPages({ pageCount: 2, checkPage, concurrency: 50 })).pagesChecked).toBe(2);
    expect(peak).toBe(2);
    peak = 0;
    expect((await segmentByCoverPages({ pageCount: 3, checkPage, concurrency: 0 })).pagesChecked).toBe(3);
    expect(peak).toBe(1);
  });

  it("checks nothing for an empty document", async () => {
    const plan = await segmentByCoverPages({
      pageCount: 0,
      checkPage: async () => {
        throw new Error("should not be called");
      },
    });
    expect(plan).toEqual({ students: [], unassignedPages: [], warnings: ["Empty document."], pagesChecked: 0 });
  });
});

describe("quick read tunables", () => {
  it("keeps a full pass inside one serverless request", () => {
    // ~3s per check, QUICK_READ_CONCURRENCY in flight -> the longest allowed
    // scan must still finish well inside the 300s request budget.
    expect((QUICK_READ_MAX_PAGES / QUICK_READ_CONCURRENCY) * 3).toBeLessThan(300);
  });
});
