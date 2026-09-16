import { describe, expect, it } from "vitest";
import { dpGradeLevelFor, parseDpCourseCode } from "./dp-course-code";

// The teacher's own words for what these codes mean:
//   "27AH is a code for a specific group of students [...] AAHL is the 2 year
//    IBDP course that all of my Grade 11 and Grade 12 students will go through.
//    The AAHL class that graduates in 2027 is labeled 27AH. The AASL class
//    that graduates in 2030 will be called 30AS. The AIHL class of 2032 will
//    be called 32IH."
describe("parseDpCourseCode", () => {
  it("reads the cohort's graduation year and its course", () => {
    expect(parseDpCourseCode("27AH")).toEqual({
      graduationYear: 2027,
      subjectCode: "AH",
      courseName: "AAHL",
    });
  });

  // The regression this module exists for. The picker used to match
  // /^\d{2}AH$/ inline, so these two courses could never appear in it at all.
  it("reads the Standard Level and Applications codes the teacher named", () => {
    expect(parseDpCourseCode("30AS")?.courseName).toBe("AASL");
    expect(parseDpCourseCode("30AS")?.graduationYear).toBe(2030);
    expect(parseDpCourseCode("32IH")?.courseName).toBe("AIHL");
    expect(parseDpCourseCode("32IH")?.graduationYear).toBe(2032);
  });

  it("reads AI SL, the fourth course, even though it is not yet taught", () => {
    expect(parseDpCourseCode("31IS")?.courseName).toBe("AISL");
  });

  it("is case- and whitespace-forgiving, because course names are typed by hand", () => {
    expect(parseDpCourseCode(" 27ah ")).toEqual({
      graduationYear: 2027,
      subjectCode: "AH",
      courseName: "AAHL",
    });
  });

  // Everything below must stay OUT of the DP picker. A Grade 9 packet saved
  // against a DP course would write its continuity into the wrong course.
  it("rejects Grade 9 roster courses", () => {
    for (const name of ["9A", "9C", "9D", "9G"]) {
      expect(parseDpCourseCode(name)).toBeNull();
    }
  });

  it("rejects the Grade 9 virtual track courses", () => {
    expect(parseDpCourseCode("Grade 9 Extended")).toBeNull();
    expect(parseDpCourseCode("Grade 9 Standard")).toBeNull();
  });

  it("rejects a two-letter code that is not one of the four DP courses", () => {
    // Shape is right, subject is not. Silently calling this "AAHL" is exactly
    // the class of bug the inline regex produced.
    expect(parseDpCourseCode("27XY")).toBeNull();
    expect(parseDpCourseCode("27BH")).toBeNull();
  });

  it("rejects near-misses on the cohort half", () => {
    expect(parseDpCourseCode("2027AH")).toBeNull();
    expect(parseDpCourseCode("7AH")).toBeNull();
    expect(parseDpCourseCode("27AHL")).toBeNull();
    expect(parseDpCourseCode("27 AH")).toBeNull();
    expect(parseDpCourseCode("")).toBeNull();
  });
});

describe("dpGradeLevelFor", () => {
  // AAHL spans two years, so the code alone never fixes a grade -- where the
  // cohort sits in the course does. These dates are the ones that actually
  // matter: the August rollover, either side of it.
  const JULY_2026 = new Date("2026-07-15T12:00:00Z");
  const AUGUST_2026 = new Date("2026-08-15T12:00:00Z");
  const MAY_2027 = new Date("2027-05-15T12:00:00Z");

  it("puts the graduating cohort in Grade 12 for its whole final year", () => {
    // 2026-27 is the class of 2027's second year, from August through May.
    expect(dpGradeLevelFor(2027, AUGUST_2026)).toBe("Grade 12");
    expect(dpGradeLevelFor(2027, MAY_2027)).toBe("Grade 12");
  });

  it("puts the same cohort in Grade 11 the year before", () => {
    // July 2026 is still the 2025-26 school year, when 27AH were juniors.
    expect(dpGradeLevelFor(2027, JULY_2026)).toBe("Grade 11");
  });

  it("rolls cohorts forward in August without anyone editing a constant", () => {
    // The whole point of deriving this. On 2026-08-15, 27AH became seniors
    // and 28AH became juniors, with no code change in between.
    expect(dpGradeLevelFor(2027, JULY_2026)).toBe("Grade 11");
    expect(dpGradeLevelFor(2027, AUGUST_2026)).toBe("Grade 12");
    expect(dpGradeLevelFor(2028, AUGUST_2026)).toBe("Grade 11");
  });

  it("reports a cohort that has already graduated as Grade 12", () => {
    // An archived course should not be in the picker at all, but if one is,
    // Grade 12 is the truthful last thing it was.
    expect(dpGradeLevelFor(2025, MAY_2027)).toBe("Grade 12");
  });

  it("reports a far-future cohort as Grade 11, the year they enter the course", () => {
    expect(dpGradeLevelFor(2032, AUGUST_2026)).toBe("Grade 11");
  });
});
