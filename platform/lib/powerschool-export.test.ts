import { describe, it, expect } from "vitest";
import {
  buildPowerSchoolCsv,
  powerSchoolFilename,
  rowsMissingStudentNumber,
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

describe("buildPowerSchoolCsv", () => {
  it("leads with the header row PowerSchool's column mapping expects", () => {
    expect(buildPowerSchoolCsv([]).split("\r\n")[0]).toBe("Student Num,Student Name,Score");
  });

  it("uses CRLF line endings and terminates the final row", () => {
    const csv = buildPowerSchoolCsv([row()]);
    expect(csv).toBe('Student Num,Student Name,Score\r\n120451,"Caipo, Santiago",4\r\n');
  });

  // Every name on this roster is "Surname, Given", so an unquoted name column
  // would shift the Score into a fourth column for every single student.
  it("quotes a name containing a comma", () => {
    expect(buildPowerSchoolCsv([row()])).toContain('"Caipo, Santiago"');
  });

  it("doubles an embedded quote rather than truncating the field", () => {
    const csv = buildPowerSchoolCsv([row({ studentName: 'Ruifeng "Ray" Wu' })]);
    expect(csv).toContain('"Ruifeng ""Ray"" Wu"');
  });

  it("leaves a name without special characters unquoted", () => {
    expect(buildPowerSchoolCsv([row({ studentName: "Emma Mayrides" })])).toContain(
      "120451,Emma Mayrides,4"
    );
  });

  it("writes ABS for an absent student, not a level", () => {
    const csv = buildPowerSchoolCsv([row({ absent: true, level: 3 })]);
    expect(csv).toContain(`,${POWERSCHOOL_ABSENT_CODE}\r\n`);
    expect(csv).not.toContain(",3\r\n");
  });

  // A blank cell is left untouched on import. A 0 would be a claim that the
  // student sat the paper and earned nothing.
  it("leaves the score empty for an ungraded student", () => {
    const csv = buildPowerSchoolCsv([row({ level: null })]);
    expect(csv).toBe('Student Num,Student Name,Score\r\n120451,"Caipo, Santiago",\r\n');
  });

  it("keeps a row for a student with no number, so the gap is visible", () => {
    const csv = buildPowerSchoolCsv([row({ studentNumber: null })]);
    expect(csv).toContain('\r\n,"Caipo, Santiago",4\r\n');
  });

  it("trims surrounding whitespace off a pasted student number", () => {
    expect(buildPowerSchoolCsv([row({ studentNumber: "  120451 " })])).toContain("\r\n120451,");
  });

  it("emits one row per student, in the order given", () => {
    const csv = buildPowerSchoolCsv([
      row({ studentName: "Alpha", studentNumber: "1", level: 7 }),
      row({ studentName: "Beta", studentNumber: "2", level: 1 }),
    ]);
    expect(csv.split("\r\n").filter(Boolean)).toEqual([
      "Student Num,Student Name,Score",
      "1,Alpha,7",
      "2,Beta,1",
    ]);
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
  it("slugs the course and test name", () => {
    expect(powerSchoolFilename("9A", "Formative Assessment 1")).toBe(
      "9A-Formative-Assessment-1-levels.csv"
    );
  });

  it("strips accents and punctuation rather than emitting them in a header", () => {
    expect(powerSchoolFilename("9A", "Évaluation: n°1 (final)")).toBe(
      "9A-Evaluation-n-1-final-levels.csv"
    );
  });

  it("survives a name that slugs to nothing", () => {
    expect(powerSchoolFilename("", "***")).toBe("levels.csv");
  });

  it("takes a suffix, so the two export shapes do not share a filename", () => {
    expect(powerSchoolFilename("9A", "Formative Assessment 1", "pst")).toBe(
      "9A-Formative-Assessment-1-pst.csv"
    );
  });
});
