import { describe, expect, it } from "vitest";
import { buildNaCourseOptions, type CourseRow } from "./na-course-options";

const id = (n: string) => `id-${n}`;
const rows = (...names: string[]): CourseRow[] => names.map((name) => ({ id: id(name), name }));

// The teacher's ACTUAL un-archived course list, read from production on
// 2026-09-16. If the picker is right for this, it is right for the only case
// that currently ships.
const LIVE_ACTIVE_COURSES = rows(
  "27AH",
  "9A",
  "9C",
  "9D",
  "9G",
  "Grade 9 Extended",
  "Grade 9 Standard",
);

const SEPT_2026 = new Date("2026-09-16T12:00:00Z");

describe("buildNaCourseOptions, against the live course list", () => {
  it("offers exactly AAHL and the two Grade 9 tracks", () => {
    expect(buildNaCourseOptions(LIVE_ACTIVE_COURSES, SEPT_2026).map((o) => o.label)).toEqual([
      "AAHL",
      "Grade 9 Extended",
      "Grade 9 Standard",
    ]);
  });

  it("labels the DP course by its course, not its cohort code", () => {
    const [dp] = buildNaCourseOptions(LIVE_ACTIVE_COURSES, SEPT_2026);
    expect(dp.label).toBe("AAHL");
    // ...but still SAVES against the cohort row, which is where continuity lives.
    expect(dp.id).toBe(id("27AH"));
  });

  it("puts 27AH in Grade 12, because the class of 2027 are seniors in 2026-27", () => {
    expect(buildNaCourseOptions(LIVE_ACTIVE_COURSES, SEPT_2026)[0].gradeLevel).toBe("Grade 12");
  });

  // Bug 1 in the module header. A roster course reaching this list meant a DP
  // packet's continuity could be written onto a single Grade 9 class.
  it("never offers a Grade 9 ROSTER course", () => {
    const ids = buildNaCourseOptions(LIVE_ACTIVE_COURSES, SEPT_2026).map((o) => o.id);
    for (const roster of ["9A", "9C", "9D", "9G"]) {
      expect(ids).not.toContain(id(roster));
    }
  });
});

describe("buildNaCourseOptions, DP courses the teacher may yet teach", () => {
  // Bug 2 in the module header: these could never appear at all.
  it("offers an AASL cohort under its own name", () => {
    const opts = buildNaCourseOptions(rows("30AS"), SEPT_2026);
    expect(opts).toEqual([{ id: id("30AS"), label: "AASL", gradeLevel: "Grade 11" }]);
  });

  it("offers an AIHL cohort under its own name", () => {
    expect(buildNaCourseOptions(rows("32IH"), SEPT_2026)[0].label).toBe("AIHL");
  });

  it("does not collapse two different DP courses into one label", () => {
    const opts = buildNaCourseOptions(rows("27AH", "30AS", "32IH"), SEPT_2026);
    expect(opts.map((o) => o.label)).toEqual(["AAHL", "AASL", "AIHL"]);
  });
});

describe("buildNaCourseOptions, two cohorts of one course", () => {
  // AAHL is two years long, so this is the normal steady state once a second
  // cohort starts: a Grade 12 class finishing and a Grade 11 class starting.
  const twoCohorts = rows("27AH", "28AH");

  it("distinguishes them by the cohort code the teacher already uses", () => {
    expect(buildNaCourseOptions(twoCohorts, SEPT_2026).map((o) => o.label)).toEqual([
      "AAHL (27AH)",
      "AAHL (28AH)",
    ]);
  });

  it("gives each the grade its own cohort is in", () => {
    const opts = buildNaCourseOptions(twoCohorts, SEPT_2026);
    expect(opts.map((o) => o.gradeLevel)).toEqual(["Grade 12", "Grade 11"]);
  });

  it("lists the graduating cohort first", () => {
    expect(buildNaCourseOptions(rows("28AH", "27AH"), SEPT_2026)[0].id).toBe(id("27AH"));
  });

  it("does not disambiguate when the two active DP courses differ", () => {
    // 27AH and 30AS are both DP, but "AAHL" and "AASL" already tell them apart.
    expect(buildNaCourseOptions(rows("27AH", "30AS"), SEPT_2026).map((o) => o.label)).toEqual([
      "AAHL",
      "AASL",
    ]);
  });
});

describe("buildNaCourseOptions, edges", () => {
  it("returns nothing for a teacher with no eligible courses", () => {
    expect(buildNaCourseOptions(rows("9A", "9C"), SEPT_2026)).toEqual([]);
    expect(buildNaCourseOptions([], SEPT_2026)).toEqual([]);
  });

  it("offers a track that exists even when the other does not", () => {
    expect(buildNaCourseOptions(rows("Grade 9 Standard"), SEPT_2026).map((o) => o.label)).toEqual([
      "Grade 9 Standard",
    ]);
  });

  it("keeps the two tracks in their fixed order regardless of row order", () => {
    const shuffled = rows("Grade 9 Standard", "Grade 9 Extended");
    expect(buildNaCourseOptions(shuffled, SEPT_2026).map((o) => o.label)).toEqual([
      "Grade 9 Extended",
      "Grade 9 Standard",
    ]);
  });

  it("always puts DP courses before the Grade 9 tracks", () => {
    const opts = buildNaCourseOptions(rows("Grade 9 Extended", "27AH"), SEPT_2026);
    expect(opts.map((o) => o.label)).toEqual(["AAHL", "Grade 9 Extended"]);
  });

  it("rolls the DP grade forward in August with no code change", () => {
    const july = new Date("2026-07-15T12:00:00Z");
    const august = new Date("2026-08-15T12:00:00Z");
    expect(buildNaCourseOptions(rows("27AH"), july)[0].gradeLevel).toBe("Grade 11");
    expect(buildNaCourseOptions(rows("27AH"), august)[0].gradeLevel).toBe("Grade 12");
  });
});
