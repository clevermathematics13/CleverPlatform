import { describe, expect, it } from "vitest";
import {
  ActivityRubricSchema,
  DEFAULT_OUTCOME_BANDS,
  activityOutcomeLabel,
  buildActivityReport,
  buildActivityReportCsv,
  checkActivityRubricAgainstItems,
  outcomeForPart,
  outcomeForTarget,
  outcomeThresholds,
  parseActivityRubric,
  tallyTargets,
  targetsForItem,
  type ActivityRubric,
  type RubricItem,
  type StudentActivityRow,
} from "./activity-rubric";
import {
  EXPLORATION_1_1_ITEMS,
  EXPLORATION_1_1_RUBRIC,
  EXPLORATION_1_1_TOTAL_MARKS,
} from "./fixtures/mathmedic-exploration-1-1";

/** The fixture's parts as test_items rows, with ids the report can be keyed on. */
const ITEMS: RubricItem[] = EXPLORATION_1_1_ITEMS.map((it) => ({
  id: `item-${it.questionNumber}${it.partLabel}`,
  question_number: it.questionNumber,
  part_label: it.partLabel || null,
  max_marks: it.maxMarks,
}));

const itemId = (ref: string) => `item-${ref}`;

/** Full marks on every part, as a starting point for the report tests. */
const fullMarks = (): Map<string, number> => new Map(ITEMS.map((i) => [i.id, i.max_marks]));

describe("the Exploration 1.1 fixture", () => {
  it("adds up to the marks the seed claims", () => {
    expect(ITEMS.reduce((s, i) => s + i.max_marks, 0)).toBe(EXPLORATION_1_1_TOTAL_MARKS);
  });

  it("parses as a rubric", () => {
    expect(ActivityRubricSchema.safeParse(EXPLORATION_1_1_RUBRIC).success).toBe(true);
  });

  it("carries the page-2 questions as Q9 and Q10 so they cannot collide with page 1", () => {
    expect(ITEMS.filter((i) => i.question_number === 9).map((i) => i.part_label)).toEqual(["a", "b"]);
    expect(ITEMS.filter((i) => i.question_number === 10).map((i) => i.part_label)).toEqual(["a", "b"]);
  });

  it("fits the test it was written for", () => {
    expect(checkActivityRubricAgainstItems(EXPLORATION_1_1_RUBRIC, ITEMS)).toEqual([]);
  });
});

describe("outcomeForPart", () => {
  it("reads a two-mark part as all, some or none of the idea", () => {
    expect(outcomeForPart(2, 2)).toBe("got_it");
    expect(outcomeForPart(1, 2)).toBe("almost");
    expect(outcomeForPart(0, 2)).toBe("not_yet");
  });

  it("gives a one-mark part no Almost, because there is no half of one idea", () => {
    expect(outcomeForPart(1, 1)).toBe("got_it");
    expect(outcomeForPart(0, 1)).toBe("not_yet");
  });

  it("does not place a part worth nothing", () => {
    expect(outcomeForPart(0, 0)).toBe("not_yet");
  });
});

describe("outcomeThresholds", () => {
  // The ceiling rule, pinned to the fixture's three targets. LT1 is 7 marks,
  // LT2 is 6 and LT3 is 8 -- see the parts lists on EXPLORATION_1_1_RUBRIC.
  it("ceils rather than rounds, so 80% of 7 is 6 and not 5", () => {
    expect(outcomeThresholds(7, DEFAULT_OUTCOME_BANDS)).toEqual({ gotIt: 6, almost: 4 });
  });

  it("keeps an exact half from ceiling to the next mark", () => {
    // 0.5 x 6 = 3 and 0.5 x 8 = 4 exactly; without the epsilon in
    // minMarksForBand, floating point pushes these to 4 and 5.
    expect(outcomeThresholds(6, DEFAULT_OUTCOME_BANDS)).toEqual({ gotIt: 5, almost: 3 });
    expect(outcomeThresholds(8, DEFAULT_OUTCOME_BANDS)).toEqual({ gotIt: 7, almost: 4 });
  });

  it("cannot place anyone in a target worth nothing", () => {
    expect(outcomeForTarget(0, 0, DEFAULT_OUTCOME_BANDS)).toBeNull();
  });
});

describe("outcomeForTarget", () => {
  it("places a student at each band of a 7-mark target", () => {
    const at = (marks: number) => outcomeForTarget(marks, 7, DEFAULT_OUTCOME_BANDS);
    expect(at(7)).toBe("got_it");
    expect(at(6)).toBe("got_it");
    expect(at(5)).toBe("almost");
    expect(at(4)).toBe("almost");
    expect(at(3)).toBe("not_yet");
    expect(at(0)).toBe("not_yet");
  });

  it("forgives one slip across a target, which a single part would not", () => {
    // 6 of 7 is Got it on the target even though the part it was lost on is
    // Almost. That asymmetry is the point of banding a target at all.
    expect(outcomeForTarget(6, 7, DEFAULT_OUTCOME_BANDS)).toBe("got_it");
    expect(outcomeForPart(1, 2)).toBe("almost");
  });
});

describe("ActivityRubricSchema", () => {
  const base = EXPLORATION_1_1_RUBRIC;

  it("rejects a duplicated target code", () => {
    const bad = { ...base, targets: [base.targets[0], { ...base.targets[1], code: base.targets[0].code }] };
    const result = ActivityRubricSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("is used twice");
  });

  it("rejects the same part listed twice inside one target", () => {
    const bad = { ...base, targets: [{ ...base.targets[0], parts: ["1", "2", "2"] }] };
    const result = ActivityRubricSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("listed twice");
  });

  it("ALLOWS one part to feed two targets, unlike a Standard Level strand", () => {
    // Q10(b) is in both LT1 and LT2 on the real fixture. A strand rubric would
    // reject that; an activity must not, because one Exploration question
    // routinely shows more than one learning target.
    const shared = base.targets.filter((t) => t.parts.includes("10b"));
    expect(shared.length).toBe(2);
    expect(ActivityRubricSchema.safeParse(base).success).toBe(true);
  });

  it("rejects bands that do not descend", () => {
    const bad = { ...base, bands: { gotIt: 0.4, almost: 0.8 } };
    expect(ActivityRubricSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a part reference that is not one", () => {
    const bad = { ...base, targets: [{ ...base.targets[0], parts: ["question one"] }] };
    expect(ActivityRubricSchema.safeParse(bad).success).toBe(false);
  });
});

describe("parseActivityRubric", () => {
  it("takes null to null, because most tests have no rubric", () => {
    expect(parseActivityRubric(null)).toEqual({ ok: true, rubric: null });
    expect(parseActivityRubric(undefined)).toEqual({ ok: true, rubric: null });
  });

  it("returns the messages rather than throwing", () => {
    const result = parseActivityRubric({ version: 1, kind: "exploration", bands: DEFAULT_OUTCOME_BANDS, targets: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("round-trips the fixture through JSON, which is how jsonb stores it", () => {
    const result = parseActivityRubric(JSON.parse(JSON.stringify(EXPLORATION_1_1_RUBRIC)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rubric?.targets.length).toBe(3);
  });
});

describe("checkActivityRubricAgainstItems", () => {
  it("blocks on a target naming a part the activity does not have", () => {
    const rubric: ActivityRubric = {
      ...EXPLORATION_1_1_RUBRIC,
      targets: [{ code: "LT1", name: "Relationships", parts: ["1", "47c"] }],
    };
    const findings = checkActivityRubricAgainstItems(rubric, ITEMS);
    expect(findings.some((f) => f.severity === "block" && f.message.includes("Q47(c)"))).toBe(true);
  });

  it("warns, but does not block, on a part in no target", () => {
    const rubric: ActivityRubric = {
      ...EXPLORATION_1_1_RUBRIC,
      targets: [{ code: "LT1", name: "Relationships", parts: ["1"] }],
    };
    const findings = checkActivityRubricAgainstItems(rubric, ITEMS);
    expect(findings.every((f) => f.severity === "warn")).toBe(true);
    expect(findings.some((f) => f.message.includes("Q2"))).toBe(true);
  });
});

describe("targetsForItem", () => {
  it("returns both targets for the part that feeds two", () => {
    const codes = targetsForItem(EXPLORATION_1_1_RUBRIC, { question_number: 10, part_label: "b" }).map((t) => t.code);
    expect(codes).toEqual(["LT1", "LT2"]);
  });

  it("returns one target for an ordinary part", () => {
    const codes = targetsForItem(EXPLORATION_1_1_RUBRIC, { question_number: 3, part_label: null }).map((t) => t.code);
    expect(codes).toEqual(["LT3"]);
  });
});

describe("buildActivityReport", () => {
  it("places nobody when nothing is marked", () => {
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, new Map());
    expect(report.targets.every((t) => t.outcome === null)).toBe(true);
    expect(report.complete).toBe(false);
    expect(report.markedParts).toBe(0);
    expect(report.totalParts).toBe(ITEMS.length);
  });

  it("gives Got it on every target for a full-marks paper", () => {
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, fullMarks());
    expect(report.targets.map((t) => t.outcome)).toEqual(["got_it", "got_it", "got_it"]);
    expect(report.targets.map((t) => t.max)).toEqual([7, 6, 8]);
    expect(report.complete).toBe(true);
  });

  it("gives Not yet on every target for a blank-but-marked paper", () => {
    const zeros = new Map(ITEMS.map((i) => [i.id, 0]));
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, zeros);
    expect(report.targets.map((t) => t.outcome)).toEqual(["not_yet", "not_yet", "not_yet"]);
    expect(report.complete).toBe(true);
  });

  it("separates the targets: equations lost, substitution kept", () => {
    // The student who can use the rules but cannot write them: full marks on
    // LT3's parts, nothing on LT2's. This is exactly the split the report
    // exists to surface before the lesson.
    const marks = fullMarks();
    for (const ref of ["6", "7", "8", "9b"]) marks.set(itemId(ref), 0);
    marks.set(itemId("10b"), 0);
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, marks);
    const byCode = Object.fromEntries(report.targets.map((t) => [t.code, t]));
    expect(byCode.LT2.marks).toBe(0);
    expect(byCode.LT2.outcome).toBe("not_yet");
    expect(byCode.LT3.outcome).toBe("got_it");
    // LT1 keeps Q1, Q2 and Q9(a) but loses the shared Q10(b): 6 of 7 is still Got it.
    expect(byCode.LT1.marks).toBe(6);
    expect(byCode.LT1.outcome).toBe("got_it");
  });

  it("counts a shared part towards both targets it feeds", () => {
    const marks = new Map<string, number>([[itemId("10b"), 1]]);
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, marks);
    const byCode = Object.fromEntries(report.targets.map((t) => [t.code, t]));
    expect(byCode.LT1.marks).toBe(1);
    expect(byCode.LT2.marks).toBe(1);
    expect(byCode.LT3.marks).toBe(0);
  });

  it("reports a running outcome on a half-marked paper, and says it is not settled", () => {
    const marks = new Map<string, number>([
      [itemId("3"), 2],
      [itemId("4"), 2],
    ]);
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, marks);
    const lt3 = report.targets.find((t) => t.code === "LT3")!;
    expect(lt3.marks).toBe(4);
    expect(lt3.markedParts).toBe(2);
    expect(lt3.totalParts).toBe(4);
    expect(lt3.outcome).toBe("almost");
    expect(report.complete).toBe(false);
  });

  it("treats a null mark as unmarked rather than as zero", () => {
    const marks: Record<string, number | null> = { [itemId("3")]: null, [itemId("4")]: 2 };
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, marks);
    const lt3 = report.targets.find((t) => t.code === "LT3")!;
    expect(lt3.markedParts).toBe(1);
    expect(lt3.marks).toBe(2);
  });

  it("carries each part's own outcome so the teacher can see what let a target down", () => {
    const marks = fullMarks();
    marks.set(itemId("4"), 1);
    const report = buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, marks);
    const lt3 = report.targets.find((t) => t.code === "LT3")!;
    const q4 = lt3.parts.find((p) => p.label === "Q4")!;
    expect(q4.outcome).toBe("almost");
    expect(lt3.parts.filter((p) => p.outcome === "got_it").length).toBe(3);
  });
});

describe("tallyTargets", () => {
  const report = (marks: Map<string, number>) => buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, marks);

  it("counts the class at each outcome, and leaves absentees out of the count", () => {
    const rows: StudentActivityRow[] = [
      { name: "Got everything", className: "9D", report: report(fullMarks()), absent: false },
      { name: "Got nothing", className: "9D", report: report(new Map(ITEMS.map((i) => [i.id, 0]))), absent: false },
      { name: "Away", className: "9D", report: null, absent: true },
      { name: "Not marked", className: "9D", report: report(new Map()), absent: false },
    ];
    const tallies = tallyTargets(EXPLORATION_1_1_RUBRIC, rows);
    expect(tallies.map((t) => t.code)).toEqual(["LT1", "LT2", "LT3"]);
    for (const tally of tallies) {
      expect(tally.got_it).toBe(1);
      expect(tally.not_yet).toBe(1);
      expect(tally.unmarked).toBe(1);
      expect(tally.almost).toBe(0);
    }
  });
});

describe("buildActivityReportCsv", () => {
  const rows: StudentActivityRow[] = [
    {
      name: "Ada, Lovelace",
      className: "9D",
      report: buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, fullMarks()),
      absent: false,
    },
    { name: "Away, Student", className: "9D", report: null, absent: true },
    {
      name: "Unmarked, Student",
      className: "9D",
      report: buildActivityReport(EXPLORATION_1_1_RUBRIC, ITEMS, new Map()),
      absent: false,
    },
  ];

  const csv = buildActivityReportCsv(EXPLORATION_1_1_RUBRIC, rows);
  const lines = csv.split("\r\n");

  it("heads a column per learning target", () => {
    expect(lines[0]).toBe(
      "Student,Class,LT1 Look for relationships between variables,LT2 Use operations to describe a relationship between variables,LT3 Evaluate an expression by substituting a value for a variable",
    );
  });

  it("writes outcomes in full, for a human deciding what to reteach", () => {
    expect(lines[1]).toBe('"Ada, Lovelace",9D,Got it,Got it,Got it');
    expect(activityOutcomeLabel("not_yet")).toBe("Not yet");
  });

  it("marks an absentee in every column and leaves an unmarked student blank", () => {
    expect(lines[2]).toBe('"Away, Student",9D,ABS,ABS,ABS');
    expect(lines[3]).toBe('"Unmarked, Student",9D,,,');
  });

  it("ends every line with CRLF, including the last", () => {
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
