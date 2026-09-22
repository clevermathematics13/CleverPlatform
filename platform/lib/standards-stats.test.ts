import { describe, expect, it } from "vitest";
import {
  MIN_STUDENTS_FOR_DISCRIMINATION,
  buildStandardsStats,
  buildStandardsStatsCsv,
  correlation,
  mean,
  median,
  percentOf,
  standardDeviation,
  statsHighlights,
  type StatsSubject,
} from "./standards-stats";
import type { RubricItem, StandardsRubric } from "./standards-rubric";
import { KA1_UNIT1_ITEMS, KA1_UNIT1_RUBRIC, KA1_UNIT1_TOTAL_MARKS } from "./fixtures/g9-standard-ka1-unit1";

/** The fixture's parts as test_items rows, keyed the way the report keys them. */
const KA1_ITEMS: RubricItem[] = KA1_UNIT1_ITEMS.map((it) => ({
  id: `item-${it.questionNumber}${it.partLabel}`,
  question_number: it.questionNumber,
  part_label: it.partLabel,
  max_marks: it.maxMarks,
}));

/** A student whose mark on every part is decided by `pick`. */
function subject(
  name: string,
  pick: (item: RubricItem) => number | null,
  className: string | null = "9D"
): StatsSubject {
  const marks = new Map<string, number>();
  for (const item of KA1_ITEMS) {
    const m = pick(item);
    if (m !== null) marks.set(item.id, m);
  }
  return { subjectId: name, name, className, marks };
}

const full = (name: string, className?: string | null) =>
  subject(name, (i) => i.max_marks, className);
const blank = (name: string, className?: string | null) => subject(name, () => 0, className);

describe("small statistics", () => {
  it("means, medians and a population standard deviation", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    // Population, not sample: mean of squared deviations, divided by n.
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(standardDeviation([5, 5, 5])).toBe(0);
  });

  it("percentOf never divides by zero", () => {
    expect(percentOf(3, 4)).toBe(75);
    expect(percentOf(0, 0)).toBe(0);
  });

  it("correlation is null when nothing varies, rather than zero", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(correlation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 10);
    // A part every student got right correlates with nothing -- and saying
    // "0" would read as "did not sort the class" rather than "cannot".
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(correlation([1, 2], [1])).toBeNull();
    expect(correlation([1], [1])).toBeNull();
  });
});

describe("a paper nobody has marked", () => {
  const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects: [] });

  it("reports zero students everywhere without dividing by zero", () => {
    expect(stats.paper.attempted).toBe(0);
    expect(stats.paper.n).toBe(0);
    expect(stats.paper.max).toBe(KA1_UNIT1_TOTAL_MARKS);
    expect(stats.paper.mean).toBe(0);
    expect(stats.paper.meanPercent).toBe(0);
    expect(stats.paper.lowest).toBe(0);
    expect(stats.paper.highest).toBe(0);
  });

  it("still lists every part, question and strand of the paper", () => {
    expect(stats.parts).toHaveLength(26);
    expect(stats.questions).toHaveLength(9);
    expect(stats.strands.map((s) => s.code)).toEqual(["A", "B", "C", "D"]);
    expect(stats.parts.every((p) => p.n === 0 && p.discrimination === null)).toBe(true);
  });
});

describe("a whole class at full marks", () => {
  const subjects = ["a", "b", "c", "d", "e", "f"].map((n) => full(n));
  const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects });

  it("puts the paper at 100% and everyone at Exceeding", () => {
    expect(stats.paper.n).toBe(6);
    expect(stats.paper.mean).toBe(KA1_UNIT1_TOTAL_MARKS);
    expect(stats.paper.meanPercent).toBe(100);
    expect(stats.paper.sd).toBe(0);
    expect(stats.paper.levelCounts.exceeding).toBe(6);
    expect(stats.paper.levelCounts.beginning).toBe(0);
  });

  it("gives every part a null discrimination, because nothing varies", () => {
    expect(subjects.length).toBeGreaterThanOrEqual(MIN_STUDENTS_FOR_DISCRIMINATION);
    expect(stats.parts.every((p) => p.discrimination === null)).toBe(true);
    expect(stats.parts.every((p) => p.fullPercent === 100 && p.zeroPercent === 0)).toBe(true);
  });
});

describe("question grouping", () => {
  // One student with full marks on Q1 and nothing anywhere else.
  const onlyQ1 = subject("q1 only", (i) => (i.question_number === 1 ? i.max_marks : 0));
  const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects: [onlyQ1] });

  it("sums each question's parts and keeps paper order", () => {
    expect(stats.questions.map((q) => q.questionNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const q1 = stats.questions[0];
    expect(q1.label).toBe("Q1");
    expect(q1.parts.map((p) => p.ref)).toEqual(["1a", "1b", "1c"]);
    expect(q1.max).toBe(3);
    expect(q1.mean).toBe(3);
    expect(q1.meanPercent).toBe(100);
  });

  it("names the strands a question feeds, in rubric order", () => {
    // Q2 is (a)(b)(c) in strand B and (d) in strand D on the KA1 rubric.
    const q2 = stats.questions.find((q) => q.questionNumber === 2)!;
    expect(q2.strandCodes).toEqual(["B", "D"]);
    expect(stats.questions.find((q) => q.questionNumber === 1)!.strandCodes).toEqual(["A"]);
  });

  it("every part of the paper lands in exactly one question", () => {
    const grouped = stats.questions.flatMap((q) => q.parts.map((p) => p.ref));
    expect(grouped).toHaveLength(stats.parts.length);
    expect(new Set(grouped).size).toBe(stats.parts.length);
    expect(stats.questions.reduce((sum, q) => sum + q.max, 0)).toBe(KA1_UNIT1_TOTAL_MARKS);
  });
});

describe("strand grouping matches the rubric's own totals", () => {
  const stats = buildStandardsStats({
    items: KA1_ITEMS,
    rubric: KA1_UNIT1_RUBRIC,
    subjects: [full("top"), blank("bottom")],
  });

  it("reproduces the printed strand maxima", () => {
    // Strand A 11, B 13, C 9, D 9 -- the four totals on the teacher rubric.
    expect(stats.strands.map((s) => `${s.code}${s.max}`)).toEqual(["A11", "B13", "C9", "D9"]);
    expect(stats.strands.reduce((sum, s) => sum + s.max, 0)).toBe(KA1_UNIT1_TOTAL_MARKS);
  });

  it("bands each strand from the marks, one student at each end", () => {
    for (const strand of stats.strands) {
      expect(strand.n).toBe(2);
      expect(strand.levelCounts.exceeding).toBe(1);
      expect(strand.levelCounts.beginning).toBe(1);
      expect(strand.meanPercent).toBe(50);
    }
  });
});

describe("a missing mark is not a zero", () => {
  // Marked on Q1 only; the other 23 parts have no row at all.
  const partial = subject("partly marked", (i) => (i.question_number === 1 ? 1 : null));
  const done = full("fully marked");
  const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects: [partial, done] });

  it("counts the partly marked student on the parts they have and nowhere else", () => {
    const q1a = stats.parts.find((p) => p.ref === "1a")!;
    expect(q1a.n).toBe(2);
    expect(q1a.mean).toBe(1); // both scored 1 of 1
    const q2a = stats.parts.find((p) => p.ref === "2a")!;
    expect(q2a.n).toBe(1);
  });

  it("keeps a half-marked paper out of every cross-part average", () => {
    expect(stats.paper.attempted).toBe(2);
    expect(stats.paper.n).toBe(1);
    expect(stats.paper.mean).toBe(KA1_UNIT1_TOTAL_MARKS);
    // Q1 has both (both complete on it); Q2 has only the finished student.
    expect(stats.questions.find((q) => q.questionNumber === 1)!.n).toBe(2);
    expect(stats.questions.find((q) => q.questionNumber === 2)!.n).toBe(1);
    expect(stats.strands.every((s) => s.n === 1)).toBe(true);
  });
});

describe("part distribution and the full / zero counts", () => {
  // Q5 is a single 4-mark part on the KA1 paper: one student at 0, one at
  // half of it and one at full marks.
  const at = (marks: number) => subject(`got ${marks}`, (i) => (i.question_number === 5 ? marks : 0));
  const stats = buildStandardsStats({
    items: KA1_ITEMS,
    rubric: KA1_UNIT1_RUBRIC,
    subjects: [at(0), at(2), at(4)],
  });
  const q5 = stats.parts.find((p) => p.ref === "5")!;

  it("buckets every whole mark from 0 to the maximum", () => {
    expect(q5.max).toBe(4);
    expect(q5.distribution).toEqual([1, 0, 1, 0, 1]);
    expect(q5.distribution.reduce((a, b) => a + b, 0)).toBe(q5.n);
  });

  it("counts full marks and zeroes as percentages of the students marked", () => {
    expect(q5.n).toBe(3);
    expect(q5.mean).toBe(2);
    expect(q5.meanPercent).toBe(50);
    expect(q5.fullMarks).toBe(1);
    expect(q5.zeroMarks).toBe(1);
    expect(q5.fullPercent).toBeCloseTo(100 / 3, 10);
    expect(q5.zeroPercent).toBeCloseTo(100 / 3, 10);
  });
});

describe("discrimination", () => {
  /** Five students scoring 0, 1, 2, 3 and 4 marks-worth of the paper's easy parts. */
  const laddered = (flip: boolean) => {
    // Rank r gets every part right on the first r questions. Q1 (3 parts,
    // 1 mark each) is the part under test; `flip` gives it to the WEAKEST
    // students instead, which is what a negative discrimination looks like.
    return [0, 1, 2, 3, 4].map((rank) =>
      subject(`rank ${rank}`, (i) => {
        if (i.question_number === 1) return (flip ? 4 - rank : rank) >= 2 ? i.max_marks : 0;
        return i.question_number <= rank + 1 ? i.max_marks : 0;
      })
    );
  };

  it("is high when the strong students did well on the part", () => {
    const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects: laddered(false) });
    const q1a = stats.parts.find((p) => p.ref === "1a")!;
    expect(q1a.discrimination).not.toBeNull();
    expect(q1a.discrimination!).toBeGreaterThan(0);
  });

  it("is negative when the part rewarded the weaker students, and is highlighted", () => {
    const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects: laddered(true) });
    const q1a = stats.parts.find((p) => p.ref === "1a")!;
    expect(q1a.discrimination!).toBeLessThan(0);
    expect(statsHighlights(stats).negativeDiscrimination.map((p) => p.ref)).toContain("1a");
  });

  it("is withheld below the minimum number of complete papers", () => {
    const few = laddered(false).slice(0, MIN_STUDENTS_FOR_DISCRIMINATION - 1);
    const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects: few });
    expect(stats.parts.every((p) => p.discrimination === null)).toBe(true);
  });
});

describe("highlights", () => {
  // Everyone gets Q1 right and Q8 wrong; Q8 is a single 5-mark part.
  const subjects = ["a", "b", "c", "d", "e"].map((n) =>
    subject(n, (i) => (i.question_number === 8 ? 0 : i.max_marks), n === "e" ? "9A" : "9D")
  );
  const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects });
  const highlights = statsHighlights(stats);

  it("names the part the class got nothing on", () => {
    expect(highlights.hardestParts[0].ref).toBe("8");
    expect(highlights.wholeClassStuck.map((p) => p.ref)).toEqual(["8"]);
    expect(highlights.weakestQuestion!.questionNumber).toBe(8);
  });

  it("names the weakest strand, which is the one Q8 feeds", () => {
    // Q8 is in strand A on the KA1 rubric.
    expect(highlights.weakestStrand!.code).toBe("A");
    expect(highlights.weakestStrand!.meanPercent).toBeLessThan(100);
  });

  it("leaves a part too few students have out of the lists", () => {
    const thin = buildStandardsStats({
      items: KA1_ITEMS,
      rubric: KA1_UNIT1_RUBRIC,
      subjects: [subject("only one", (i) => (i.question_number === 8 ? 0 : i.max_marks))],
    });
    expect(statsHighlights(thin).hardestParts).toHaveLength(0);
  });
});

describe("the general Standard Level view", () => {
  const nineD = ["a", "b"].map((n) => full(n, "9D"));
  const nineA = [blank("c", "9A")];

  it("breaks the paper down by class once more than one class has marks", () => {
    const stats = buildStandardsStats({
      items: KA1_ITEMS,
      rubric: KA1_UNIT1_RUBRIC,
      subjects: [...nineD, ...nineA],
    });
    expect(stats.classes.map((c) => `${c.className}:${c.n}`)).toEqual(["9D:2", "9A:1"]);
    expect(stats.classes[0].meanPercent).toBe(100);
    expect(stats.classes[1].meanPercent).toBe(0);
  });

  it("says nothing about classes when only one of them sat the paper", () => {
    const stats = buildStandardsStats({ items: KA1_ITEMS, rubric: KA1_UNIT1_RUBRIC, subjects: nineD });
    expect(stats.classes).toEqual([]);
  });
});

describe("a paper with no rubric at all", () => {
  const stats = buildStandardsStats({
    items: KA1_ITEMS,
    rubric: null,
    subjects: [full("a"), blank("b")],
  });

  it("still gives question and part statistics, with no strands", () => {
    expect(stats.strands).toEqual([]);
    expect(stats.questions).toHaveLength(9);
    expect(stats.parts.every((p) => p.strandCode === null)).toBe(true);
    expect(stats.paper.meanPercent).toBe(50);
  });

  it("counts nobody into a level, because there are no bands to count into", () => {
    expect(stats.paper.levelCounts).toEqual({ exceeding: 0, meeting: 0, approaching: 0, beginning: 0 });
  });
});

describe("a part outside every strand", () => {
  // A bonus 10th question the rubric never mentions.
  const items: RubricItem[] = [
    ...KA1_ITEMS,
    { id: "item-10", question_number: 10, part_label: "", max_marks: 2 },
  ];
  const stats = buildStandardsStats({
    items,
    rubric: KA1_UNIT1_RUBRIC as StandardsRubric,
    subjects: [subject("a", (i) => i.max_marks)],
  });

  it("counts towards the paper total but no strand", () => {
    expect(stats.paper.max).toBe(KA1_UNIT1_TOTAL_MARKS + 2);
    expect(stats.strands.reduce((sum, s) => sum + s.max, 0)).toBe(KA1_UNIT1_TOTAL_MARKS);
    expect(stats.parts.find((p) => p.ref === "10")!.strandCode).toBeNull();
  });
});

describe("the CSV", () => {
  const stats = buildStandardsStats({
    items: KA1_ITEMS,
    rubric: KA1_UNIT1_RUBRIC,
    subjects: [full("a", "9D"), blank("b", "9A")],
  });
  const csv = buildStandardsStatsCsv(stats, { testName: 'Key Assessment 1, "Unit 1"', scopeLabel: "All Standard Level" });

  it("carries a section per table, with CRLF line ends", () => {
    expect(csv.endsWith("\r\n")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines).toContain("Questions");
    expect(lines).toContain("Parts");
    expect(lines).toContain("Strands");
    expect(lines).toContain("Classes");
  });

  it("quotes a name containing a comma and a quote", () => {
    expect(csv.split("\r\n")[0]).toBe('"Key Assessment 1, ""Unit 1""",All Standard Level');
  });

  it("has one row per part and one per question", () => {
    const lines = csv.split("\r\n");
    const partsAt = lines.indexOf("Parts");
    const strandsAt = lines.indexOf("Strands");
    // Header line plus 26 parts, then the blank separator before "Strands".
    expect(strandsAt - partsAt - 2).toBe(27);
    expect(lines[partsAt + 2]).toMatch(/^Q1,a,A,1,/);
  });

  it("writes a withheld discrimination as an empty cell, not a zero", () => {
    // Two students is below the minimum, so every part's figure is null.
    const line = csv.split("\r\n").find((l) => l.startsWith("Q1,a,A,1,"))!;
    expect(line.endsWith(",")).toBe(true);
  });
});
