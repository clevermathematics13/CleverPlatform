import { describe, it, expect } from "vitest";
import {
  BLOCKS,
  BLOCK_ROTATION_S1_2026_27,
  ROTATION_FIRST_DAY,
  ROTATION_LAST_DAY,
  blockForCourse,
  blocksMeetingOn,
  courseMeetsOn,
  dayWithinWindow,
  isWithinRotation,
  meetingDaysWithin,
  meetingOn,
  meetsOn,
  splitWindowByCourse,
} from "./block-rotation";

describe("the transcribed rotation", () => {
  // Each source sheet reports "Dated Semester 1 classes, 39". A dropped row
  // would silently turn a meeting day into a non-meeting day, which is
  // exactly the kind of wrong this table must not be.
  it.each(BLOCKS)("has 39 Semester 1 meetings for block %s", (block) => {
    expect(BLOCK_ROTATION_S1_2026_27[block]).toHaveLength(39);
  });

  it.each(BLOCKS)("is in date order with no repeated day (block %s)", (block) => {
    const dates = BLOCK_ROTATION_S1_2026_27[block].map((x) => x.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it.each(BLOCKS)("stays inside the range it claims to cover (block %s)", (block) => {
    for (const meeting of BLOCK_ROTATION_S1_2026_27[block]) {
      expect(meeting.date >= ROTATION_FIRST_DAY).toBe(true);
      expect(meeting.date <= ROTATION_LAST_DAY).toBe(true);
      expect(meeting.startsAt).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});

describe("the days we know independently", () => {
  // Key Assessment 1: 9A and 9C sat it Monday 14 Sept, 9D and 9G on Tuesday
  // the 15th. Confirmed by the teacher and by the Classroom posts, so this is
  // the check that the whole table is the right way round.
  it("puts 9A and 9C on 14 September and not the 15th", () => {
    expect(courseMeetsOn("9A", "2026-09-14")).toBe(true);
    expect(courseMeetsOn("9C", "2026-09-14")).toBe(true);
    expect(courseMeetsOn("9A", "2026-09-15")).toBe(false);
    expect(courseMeetsOn("9C", "2026-09-15")).toBe(false);
  });

  it("puts 9D and 9G on 15 September and not the 14th", () => {
    expect(courseMeetsOn("9D", "2026-09-15")).toBe(true);
    expect(courseMeetsOn("9G", "2026-09-15")).toBe(true);
    expect(courseMeetsOn("9D", "2026-09-14")).toBe(false);
    expect(courseMeetsOn("9G", "2026-09-14")).toBe(false);
  });
});

describe("blocksMeetingOn", () => {
  it("answers the November window: the 9th is G alone", () => {
    expect(blocksMeetingOn("2026-11-09")).toEqual(["G"]);
  });

  it("answers the November window: the 10th is everyone else", () => {
    expect(blocksMeetingOn("2026-11-10")).toEqual(["A", "C", "D"]);
  });

  it("returns nothing for a day nobody meets", () => {
    expect(blocksMeetingOn("2026-10-05")).toEqual([]); // mid-October break
  });
});

describe("dayWithinWindow", () => {
  const NOVEMBER = ["2026-11-09", "2026-11-10"];
  const SEPTEMBER = ["2026-09-14", "2026-09-15"];
  const OCTOBER = ["2026-10-12", "2026-10-13"];
  const DECEMBER = ["2026-12-03", "2026-12-04"];

  it("splits each key assessment window with no judgement left over", () => {
    expect(splitWindowByCourse(SEPTEMBER, ["9A", "9C", "9D", "9G"])).toEqual({
      "9A": "2026-09-14",
      "9C": "2026-09-14",
      "9D": "2026-09-15",
      "9G": "2026-09-15",
    });
    expect(splitWindowByCourse(OCTOBER, ["9A", "9C", "9D", "9G"])).toEqual({
      "9A": "2026-10-12",
      "9C": "2026-10-12",
      "9D": "2026-10-12",
      "9G": "2026-10-13",
    });
    expect(splitWindowByCourse(NOVEMBER, ["9A", "9C", "9D", "9G"])).toEqual({
      "9A": "2026-11-10",
      "9C": "2026-11-10",
      "9D": "2026-11-10",
      "9G": "2026-11-09",
    });
    expect(splitWindowByCourse(DECEMBER, ["9A", "9C", "9D", "9G"])).toEqual({
      "9A": "2026-12-03",
      "9C": "2026-12-03",
      "9D": "2026-12-03",
      "9G": "2026-12-04",
    });
  });

  it("November is the window where G comes first, not second", () => {
    expect(dayWithinWindow("G", NOVEMBER)).toBe("2026-11-09");
    expect(dayWithinWindow("A", NOVEMBER)).toBe("2026-11-10");
  });

  it("says null rather than guessing when the block meets on neither day", () => {
    expect(dayWithinWindow("A", ["2026-11-09", "2026-11-11"])).toBeNull();
  });

  it("takes the earliest when a block meets on more than one day of a window", () => {
    // Block A meets both 16 and 20 October.
    expect(dayWithinWindow("A", ["2026-10-20", "2026-10-16"])).toBe("2026-10-16");
    expect(meetingDaysWithin("A", ["2026-10-20", "2026-10-16"])).toEqual([
      "2026-10-16",
      "2026-10-20",
    ]);
  });

  it("ignores a course with no block in this table", () => {
    expect(splitWindowByCourse(NOVEMBER, ["27AH"])).toEqual({ "27AH": null });
  });
});

describe("courseMeetsOn", () => {
  it("distinguishes 'does not meet' from 'cannot say'", () => {
    // False is a claim about the rotation; null is an absence of data. A
    // caller that treats them alike will report a correct date as wrong.
    expect(courseMeetsOn("9A", "2026-11-09")).toBe(false);
    expect(courseMeetsOn("9A", "2027-03-01")).toBeNull(); // Semester 2: predicted, so not here
    expect(courseMeetsOn("26AH", "2026-11-09")).toBeNull(); // no block for this course
  });

  it("knows the range it covers", () => {
    expect(isWithinRotation("2026-08-05")).toBe(true);
    expect(isWithinRotation("2026-12-18")).toBe(true);
    expect(isWithinRotation("2026-08-04")).toBe(false);
    expect(isWithinRotation("2026-12-19")).toBe(false);
  });
});

describe("lookups", () => {
  it("maps a course to its block", () => {
    expect(blockForCourse("9G")).toBe("G");
    expect(blockForCourse("Grade 9 Extended")).toBeNull(); // a track, not a class
  });

  it("returns the time of day a class meets", () => {
    expect(meetingOn("G", "2026-11-09")).toEqual({ date: "2026-11-09", startsAt: "11:00" });
    expect(meetingOn("A", "2026-11-09")).toBeNull();
    expect(meetsOn("A", "2026-11-10")).toBe(true);
  });
});
