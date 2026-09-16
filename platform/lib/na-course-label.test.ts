import { describe, expect, it } from "vitest";
import {
  GRADE_9_EXTENDED_COURSE_LABEL,
  GRADE_9_STANDARD_COURSE_LABEL,
  IBDP_AA_HL_COURSE_LABEL,
  canonicalCourseLabel,
  packetCourseLabel,
} from "./na-course-label";

describe("canonicalCourseLabel, against the spellings found in production", () => {
  // Read from nuanced_analyses on 2026-09-16: four labels for two courses,
  // which the manage tab's filter listed as four courses.
  it("collapses the two Grade 9 Extended spellings to one", () => {
    expect(canonicalCourseLabel("Grade 9 Extended Mathematics")).toBe(GRADE_9_EXTENDED_COURSE_LABEL);
    expect(canonicalCourseLabel("Grade 9 Mathematics (Extended)")).toBe(GRADE_9_EXTENDED_COURSE_LABEL);
  });

  it("collapses the two IBDP AA HL spellings to one", () => {
    expect(canonicalCourseLabel("IBDP Mathematics AA HL")).toBe(IBDP_AA_HL_COURSE_LABEL);
    expect(canonicalCourseLabel("IBDP Mathematics: Analysis & Approaches HL")).toBe(
      IBDP_AA_HL_COURSE_LABEL,
    );
  });

  it("is a fixed point on its own output", () => {
    for (const label of [
      GRADE_9_EXTENDED_COURSE_LABEL,
      GRADE_9_STANDARD_COURSE_LABEL,
      IBDP_AA_HL_COURSE_LABEL,
    ]) {
      expect(canonicalCourseLabel(label)).toBe(label);
    }
  });
});

describe("canonicalCourseLabel, spellings the generator could plausibly produce next", () => {
  it("reads the picker's own labels", () => {
    // lib/na-course-options.ts labels the DP course "AAHL" and the tracks
    // "Grade 9 Extended" / "Grade 9 Standard".
    expect(canonicalCourseLabel("AAHL")).toBe(IBDP_AA_HL_COURSE_LABEL);
    expect(canonicalCourseLabel("Grade 9 Extended")).toBe(GRADE_9_EXTENDED_COURSE_LABEL);
    expect(canonicalCourseLabel("Grade 9 Standard")).toBe(GRADE_9_STANDARD_COURSE_LABEL);
  });

  it("ignores case and stray whitespace", () => {
    expect(canonicalCourseLabel("  grade 9   extended  mathematics ")).toBe(
      GRADE_9_EXTENDED_COURSE_LABEL,
    );
    expect(canonicalCourseLabel("ibdp mathematics aa hl")).toBe(IBDP_AA_HL_COURSE_LABEL);
  });

  it("keeps the DP level and family it was given", () => {
    expect(canonicalCourseLabel("IBDP Mathematics AA SL")).toBe(
      "IBDP Mathematics: Analysis & Approaches SL",
    );
    expect(canonicalCourseLabel("IB Mathematics: Applications and Interpretation HL")).toBe(
      "IBDP Mathematics: Applications & Interpretation HL",
    );
    expect(canonicalCourseLabel("AISL")).toBe("IBDP Mathematics: Applications & Interpretation SL");
  });

  it("does not let 'Mathematics: Analysis' in a Grade 9 label turn it into a DP course", () => {
    expect(canonicalCourseLabel("Grade 9 Extended Mathematics: Analysis")).toBe(
      GRADE_9_EXTENDED_COURSE_LABEL,
    );
  });
});

describe("canonicalCourseLabel, labels it must leave alone", () => {
  it("passes an unrecognised course through unchanged", () => {
    expect(canonicalCourseLabel("Grade 10 Mathematics")).toBe("Grade 10 Mathematics");
    expect(canonicalCourseLabel("Grade 9 Mathematics")).toBe("Grade 9 Mathematics");
  });

  it("returns null for no label at all", () => {
    expect(canonicalCourseLabel(undefined)).toBeNull();
    expect(canonicalCourseLabel(null)).toBeNull();
    expect(canonicalCourseLabel("   ")).toBeNull();
  });
});

describe("packetCourseLabel", () => {
  it("stores the canonical spelling when the draft names a course", () => {
    expect(packetCourseLabel("Grade 9 Extended Mathematics", "Grade 9")).toBe(
      GRADE_9_EXTENDED_COURSE_LABEL,
    );
  });

  it("falls back to '<grade> Mathematics' when it does not", () => {
    expect(packetCourseLabel(undefined, "Grade 10")).toBe("Grade 10 Mathematics");
    expect(packetCourseLabel("", "Grade 12")).toBe("Grade 12 Mathematics");
  });
});
