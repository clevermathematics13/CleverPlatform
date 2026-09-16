import { describe, it, expect } from "vitest";
import {
  daysUntil,
  formatAssessmentDate,
  formatAssessmentDateShort,
  groupAssessmentsByMonth,
  monthKeyOf,
  monthLabelOf,
  parseTestDate,
  relativeLabel,
  todayInTimeZone,
  type CalendarAssessment,
} from "./assessment-calendar";

function assessment(overrides: Partial<CalendarAssessment> = {}): CalendarAssessment {
  return {
    id: "test-1",
    name: "Key Assessment 1",
    courseName: "Grade 9 Extended",
    testDate: "2026-09-14",
    totalMarks: 50,
    ...overrides,
  };
}

describe("parseTestDate", () => {
  it("reads a date-only string", () => {
    expect(parseTestDate("2026-09-14")).toEqual({ year: 2026, month: 9, day: 14 });
  });

  it("rejects a day that does not exist rather than rolling it over", () => {
    // Date.UTC(2026, 1, 30) silently becomes 2 March. A calendar must not
    // invent a date it was never given.
    expect(parseTestDate("2026-02-30")).toBeNull();
    expect(parseTestDate("2026-13-01")).toBeNull();
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(parseTestDate("14/09/2026")).toBeNull();
    expect(parseTestDate("2026-09-14T00:00:00Z")).toBeNull();
    expect(parseTestDate("")).toBeNull();
  });
});

describe("formatAssessmentDate", () => {
  // The whole reason this module does not use `new Date(testDate)`: that
  // parse is UTC midnight, which is the previous day west of Greenwich, so
  // every Monday assessment printed as Sunday.
  it.each([
    ["UTC"],
    ["America/Chicago"],
    ["America/Los_Angeles"],
    ["Pacific/Kiritimati"],
  ])("gives the same weekday whatever timezone the runtime is in (%s)", (tz) => {
    const original = process.env.TZ;
    process.env.TZ = tz;
    try {
      expect(formatAssessmentDate("2026-09-14")).toBe("Monday 14 September 2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("matches the weekdays printed on the Classroom posts", () => {
    expect(formatAssessmentDate("2026-09-14")).toBe("Monday 14 September 2026");
    expect(formatAssessmentDate("2026-09-15")).toBe("Tuesday 15 September 2026");
    expect(formatAssessmentDate("2026-10-12")).toBe("Monday 12 October 2026");
    expect(formatAssessmentDate("2026-11-10")).toBe("Tuesday 10 November 2026");
    expect(formatAssessmentDate("2026-12-03")).toBe("Thursday 3 December 2026");
  });

  it("falls back to the raw value rather than printing nonsense", () => {
    expect(formatAssessmentDate("not a date")).toBe("not a date");
  });

  it("abbreviates for a dense list", () => {
    expect(formatAssessmentDateShort("2026-09-14")).toBe("Mon 14 Sep");
  });
});

describe("daysUntil and relativeLabel", () => {
  it("counts whole days across a DST boundary", () => {
    // US DST ends 1 Nov 2026; a naive hour-based subtraction drifts here.
    expect(daysUntil("2026-11-10", "2026-10-12")).toBe(29);
  });

  it("is negative once the date is past", () => {
    expect(daysUntil("2026-09-14", "2026-09-16")).toBe(-2);
  });

  it("names the near days instead of counting them", () => {
    expect(relativeLabel("2026-09-16", "2026-09-16")).toBe("today");
    expect(relativeLabel("2026-09-17", "2026-09-16")).toBe("tomorrow");
    expect(relativeLabel("2026-09-15", "2026-09-16")).toBe("yesterday");
  });

  it("switches from days to weeks once counting days stops helping", () => {
    expect(relativeLabel("2026-09-22", "2026-09-16")).toBe("in 6 days");
    expect(relativeLabel("2026-10-12", "2026-09-16")).toBe("in 4 weeks");
    expect(relativeLabel("2026-09-10", "2026-09-16")).toBe("6 days ago");
  });
});

describe("groupAssessmentsByMonth", () => {
  const today = "2026-09-16";

  it("groups by month, earliest first", () => {
    const months = groupAssessmentsByMonth(
      [
        assessment({ id: "c", testDate: "2026-12-03" }),
        assessment({ id: "a", testDate: "2026-09-14" }),
        assessment({ id: "b", testDate: "2026-10-12" }),
      ],
      today,
    );

    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10", "2026-12"]);
    expect(months[0].label).toBe("September 2026");
  });

  it("orders within a month by date, then by course", () => {
    const months = groupAssessmentsByMonth(
      [
        assessment({ id: "d", testDate: "2026-09-15", courseName: "9D" }),
        assessment({ id: "c", testDate: "2026-09-14", courseName: "9C" }),
        assessment({ id: "a", testDate: "2026-09-14", courseName: "9A" }),
      ],
      today,
    );

    expect(months[0].assessments.map((a) => a.id)).toEqual(["a", "c", "d"]);
  });

  it("marks what has already been sat", () => {
    const months = groupAssessmentsByMonth(
      [
        assessment({ id: "past", testDate: "2026-09-14" }),
        assessment({ id: "future", testDate: "2026-10-12" }),
      ],
      today,
    );

    const all = months.flatMap((m) => m.assessments);
    expect(all.find((a) => a.id === "past")?.isPast).toBe(true);
    expect(all.find((a) => a.id === "future")?.isPast).toBe(false);
  });

  it("keeps an unreadable date under its own heading, last, rather than dropping it", () => {
    const months = groupAssessmentsByMonth(
      [assessment({ id: "bad", testDate: "whenever" }), assessment({ id: "ok" })],
      today,
    );

    expect(months.map((m) => m.key)).toEqual(["2026-09", "unknown"]);
    expect(months[1].label).toBe("Undated");
    expect(months[1].assessments[0].id).toBe("bad");
  });

  it("returns nothing for nothing", () => {
    expect(groupAssessmentsByMonth([], today)).toEqual([]);
  });
});

describe("todayInTimeZone", () => {
  it("reads the school's day, not the server's", () => {
    // 03:00 UTC on the 15th is still the 14th in Chicago. A server in UTC
    // would otherwise call an assessment "today" a few hours early.
    const instant = new Date("2026-09-15T03:00:00Z");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-09-15");
    expect(todayInTimeZone("America/Chicago", instant)).toBe("2026-09-14");
  });
});
