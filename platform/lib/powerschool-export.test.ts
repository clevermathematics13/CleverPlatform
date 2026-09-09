import { describe, it, expect } from "vitest";
import {
  powerSchoolFilename,
  rowsMissingStudentNumber,
  scoreCell,
  POWERSCHOOL_ABSENT_CODE,
  type PowerSchoolScoreRow,
} from "./powerschool-export";

function row(over: Partial<PowerSchoolScoreRow> = {}): PowerSchoolScoreRow {
  return {
    studentNumber: "120451",
    studentName: "Caipo, Santiago",
    level: 4,
    absent: false,
    ...over,
  };
}

describe("scoreCell", () => {
  it("writes the level as a plain numeral, which is what PowerSchool itself writes", () => {
    expect(scoreCell(row({ level: 7 }))).toBe("7");
  });

  it("writes ABS for an absent student, not a level", () => {
    expect(scoreCell(row({ absent: true, level: 3 }))).toBe(POWERSCHOOL_ABSENT_CODE);
  });

  // A blank cell is left untouched on import. A 0 would be a claim that the
  // student sat the paper and earned nothing.
  it("leaves the cell empty for an ungraded student", () => {
    expect(scoreCell(row({ level: null }))).toBe("");
  });
});

describe("rowsMissingStudentNumber", () => {
  it("finds null, empty and whitespace-only numbers", () => {
    const rows = [
      row({ studentName: "Has one" }),
      row({ studentName: "Null", studentNumber: null }),
      row({ studentName: "Empty", studentNumber: "" }),
      row({ studentName: "Spaces", studentNumber: "   " }),
    ];
    expect(rowsMissingStudentNumber(rows).map((r) => r.studentName)).toEqual([
      "Null",
      "Empty",
      "Spaces",
    ]);
  });
});

describe("powerSchoolFilename", () => {
  it("ends in _pst.csv, the way PowerSchool names its own template", () => {
    expect(powerSchoolFilename("9A", "Formative Assessment 1")).toBe(
      "9A_Formative-Assessment-1_pst.csv"
    );
  });

  it("strips accents and punctuation rather than emitting them in a header", () => {
    expect(powerSchoolFilename("9A", "Évaluation: n°1 (final)")).toBe(
      "9A_Evaluation-n-1-final_pst.csv"
    );
  });

  it("survives a name that slugs to nothing", () => {
    expect(powerSchoolFilename("", "***")).toBe("pst.csv");
  });
});
