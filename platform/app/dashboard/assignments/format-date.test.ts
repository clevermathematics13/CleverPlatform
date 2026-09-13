import { describe, it, expect } from "vitest";
import { formatSavedDate } from "./format-date";

describe("formatSavedDate", () => {
  it("renders a real timestamp", () => {
    expect(formatSavedDate("2026-09-04T20:06:06.394Z")).toContain("2026");
  });

  it("renders a bare date", () => {
    expect(formatSavedDate("2026-09-04")).toContain("2026");
  });

  it("never renders the string 'Invalid Date'", () => {
    // The bug this file exists for. `new Date("nonsense")` does not throw -- it
    // yields an Invalid Date whose toLocaleDateString returns "Invalid Date" --
    // so the try/catch these helpers were written with never fired, and that
    // string is what a teacher saw in the saved-packet list.
    for (const bad of ["not a date", "", "   ", "2026-13-45", "undefined", "null"]) {
      expect(formatSavedDate(bad)).not.toBe("Invalid Date");
    }
  });

  it("hands back the raw value when it is not a date", () => {
    expect(formatSavedDate("not a date")).toBe("not a date");
    expect(formatSavedDate("")).toBe("");
  });
});
