import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv, fillPowerSchoolTemplate, type PowerSchoolRosterEntry } from "./powerschool-export";

describe("parseCsv", () => {
  it("parses a simple comma-separated file with a header row", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted fields containing commas and embedded quotes", () => {
    expect(parseCsv('a,b\n"Smith, John","She said ""hi"""\n')).toEqual([
      ["a", "b"],
      ["Smith, John", 'She said "hi"'],
    ]);
  });

  it("handles a quoted field containing a newline", () => {
    expect(parseCsv('a,b\n"line1\nline2",x\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("stringifyCsv", () => {
  it("round-trips plain values", () => {
    const rows = [
      ["a", "b"],
      ["1", "2"],
    ];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });

  it("quotes a field containing a comma, quote, or newline", () => {
    const rows = [["Smith, John", 'She said "hi"', "line1\nline2"]];
    const csv = stringifyCsv(rows);
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"She said ""hi"""');
    expect(parseCsv(csv)).toEqual(rows);
  });
});

describe("fillPowerSchoolTemplate", () => {
  const roster: PowerSchoolRosterEntry[] = [
    { profileId: "p1", displayName: "Amara Okonkwo", score: 14 },
    { profileId: "p2", displayName: "Bilal Farooq", score: 9 },
    { profileId: "p3", displayName: "Camille Duchamps", score: null },
  ];

  it("fills a combined Student Name column by matching against the roster", () => {
    const template =
      "Student Number,Student Name,Score\n" +
      "10021,Amara Okonkwo,\n" +
      "10022,Bilal Farooq,\n";

    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = parseCsv(result.csvText);
    expect(rows[1]).toEqual(["10021", "Amara Okonkwo", "14"]);
    expect(rows[2]).toEqual(["10022", "Bilal Farooq", "9"]);
    expect(result.warnings).toHaveLength(0);
  });

  it("fills separate First Name / Last Name columns", () => {
    const template =
      "Student Number,Last Name,First Name,Score\n" + "10021,Okonkwo,Amara,\n";

    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = parseCsv(result.csvText);
    expect(rows[1]).toEqual(["10021", "Okonkwo", "Amara", "14"]);
  });

  it("tolerates a minor name typo the same way the app's other roster matching does", () => {
    const template = "Student Number,Student Name,Score\n10021,Amara Okonkwoo,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseCsv(result.csvText)[1][2]).toBe("14");
  });

  it("leaves a row blank and warns when no roster student matches", () => {
    const template = "Student Number,Student Name,Score\n99999,Zephyrine Kowalczyk,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseCsv(result.csvText)[1][2]).toBe("");
    expect(result.warnings.some((w) => w.includes("could not be matched"))).toBe(true);
  });

  it("leaves a row blank and warns when the matched student has no recorded score", () => {
    const template = "Student Number,Student Name,Score\n10023,Camille Duchamps,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseCsv(result.csvText)[1][2]).toBe("");
    expect(result.warnings.some((w) => w.includes("no recorded score"))).toBe(true);
  });

  it("errors when there is no Student Number column", () => {
    const template = "Name,Score\nAmara Okonkwo,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Student Number/i);
  });

  it("errors when there is no name column", () => {
    const template = "Student Number,Score\n10021,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name column/i);
  });

  it("errors on an ambiguous multi-assignment file with no header matching the test name", () => {
    const template = "Student Number,Student Name,Homework 1,Homework 2\n10021,Amara Okonkwo,,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/more than one score column/i);
  });

  it("resolves a multi-column file when one header matches the test name", () => {
    const template = "Student Number,Student Name,Homework 1,Quiz 4\n10021,Amara Okonkwo,,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = parseCsv(result.csvText);
    expect(rows[1]).toEqual(["10021", "Amara Okonkwo", "", "14"]);
  });

  it("never writes into the Student Number column, even on a match", () => {
    const template = "Student Number,Student Name,Score\n10021,Amara Okonkwo,\n";
    const result = fillPowerSchoolTemplate(template, roster, "Quiz 4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseCsv(result.csvText)[1][0]).toBe("10021");
  });
});
