import { describe, it, expect } from "vitest";
import {
  abbreviateAssessmentName,
  assessmentShortName,
  selfAssessmentExportFilename,
} from "./assessment-short-name";

describe("abbreviateAssessmentName", () => {
  it("clips the first token and keeps a trailing number", () => {
    expect(abbreviateAssessmentName("Formative Assessment 1")).toBe("Form1");
  });

  it("keeps a single-token name as its clipped self", () => {
    expect(abbreviateAssessmentName("Formative")).toBe("Form");
  });

  it("drops a trailing number that is not there", () => {
    expect(abbreviateAssessmentName("Unit Test")).toBe("Unit");
  });

  it("reads a number off the end of a token", () => {
    expect(abbreviateAssessmentName("27AH [K06] P1")).toBe("27AH1");
  });

  it("strips accents rather than emitting them in a filename", () => {
    expect(abbreviateAssessmentName("Évaluation 2")).toBe("Eval2");
  });

  it("survives a name with nothing usable in it", () => {
    expect(abbreviateAssessmentName("***")).toBe("");
  });
});

describe("assessmentShortName", () => {
  it("prefers the short name the teacher set", () => {
    expect(assessmentShortName({ name: "Formative Assessment 1", short_name: "Form1" })).toBe(
      "Form1"
    );
  });

  // Whatever they typed still has to survive a filename, so it is slugged --
  // but their wording is kept.
  it("slugs a short name containing spaces or punctuation", () => {
    expect(assessmentShortName({ name: "x", short_name: "Unit 1 / Form" })).toBe("Unit-1-Form");
  });

  it("falls back to the abbreviation when short_name is blank", () => {
    expect(assessmentShortName({ name: "Formative Assessment 1", short_name: "   " })).toBe(
      "Form1"
    );
    expect(assessmentShortName({ name: "Formative Assessment 1", short_name: null })).toBe("Form1");
    expect(assessmentShortName({ name: "Formative Assessment 1" })).toBe("Form1");
  });
});

describe("selfAssessmentExportFilename", () => {
  // The example the whole feature was specified against.
  it("names the file [class]_[assessment]_[completed].csv", () => {
    expect(
      selfAssessmentExportFilename("9C", { name: "Formative Assessment 1", short_name: "Form1" }, 6)
    ).toBe("9C_Form1_6.csv");
  });

  it("counts zero as a number, not as nothing", () => {
    expect(selfAssessmentExportFilename("9C", { name: "Formative 1" }, 0)).toBe("9C_Form1_0.csv");
  });

  it("slugs a class name with a space in it", () => {
    expect(
      selfAssessmentExportFilename("Grade 9 Extended", { name: "x", short_name: "Form1" }, 3)
    ).toBe("Grade-9-Extended_Form1_3.csv");
  });

  it("drops a part that slugs to nothing rather than doubling the separator", () => {
    expect(selfAssessmentExportFilename("", { name: "***" }, 4)).toBe("4.csv");
  });
});
