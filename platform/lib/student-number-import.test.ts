import { describe, it, expect } from "vitest";
import { parseStudentNumberPaste, type RosterEntry } from "./student-number-import";

// Names taken from the 9A roster, which is where the awkward cases live.
const ROSTER: RosterEntry[] = [
  { key: "a", name: "Santiago Caipo" },
  { key: "b", name: "Tomás Haaker" },
  { key: "c", name: "Rafaella Amalia Rosell" },
  { key: "d", name: "Ruifeng Wu" },
];

describe("parseStudentNumberPaste", () => {
  it("takes number-then-name, tab separated", () => {
    const r = parseStudentNumberPaste("120451\tSantiago Caipo", ROSTER);
    expect(r.matched).toEqual([{ key: "a", name: "Santiago Caipo", studentNumber: "120451" }]);
  });

  it("takes name-then-number, comma separated", () => {
    const r = parseStudentNumberPaste("Ruifeng Wu,120454", ROSTER);
    expect(r.matched).toEqual([{ key: "d", name: "Ruifeng Wu", studentNumber: "120454" }]);
  });

  // PowerSchool exports surname-first; this platform stores given-name-first.
  it("matches regardless of name order", () => {
    const r = parseStudentNumberPaste("120451,Caipo,Santiago", ROSTER);
    expect(r.matched.map((m) => m.key)).toEqual(["a"]);
  });

  it("matches across an accent difference", () => {
    const r = parseStudentNumberPaste("120452\tTomas Haaker", ROSTER);
    expect(r.matched.map((m) => m.key)).toEqual(["b"]);
  });

  it("matches a three-part name", () => {
    const r = parseStudentNumberPaste("Rosell, Rafaella Amalia\t120453", ROSTER);
    expect(r.matched.map((m) => m.key)).toEqual(["c"]);
  });

  it("reports a line naming nobody on the roster", () => {
    const r = parseStudentNumberPaste("999999\tNobody Here", ROSTER);
    expect(r.matched).toEqual([]);
    expect(r.unmatchedLines).toEqual(["999999\tNobody Here"]);
  });

  it("reports a line with no number in it", () => {
    const r = parseStudentNumberPaste("Santiago Caipo", ROSTER);
    expect(r.matched).toEqual([]);
    expect(r.unmatchedLines).toEqual(["Santiago Caipo"]);
  });

  // Writing the wrong number is worse than writing none: the resulting import
  // attaches one student's level to another, silently.
  it("refuses to guess between two students who normalise the same", () => {
    const twins: RosterEntry[] = [
      { key: "x", name: "Alex Kim" },
      { key: "y", name: "Kim Alex" },
    ];
    const r = parseStudentNumberPaste("120460\tAlex Kim", twins);
    expect(r.matched).toEqual([]);
    expect(r.unmatchedLines).toEqual(["120460\tAlex Kim"]);
  });

  it("reports a second line claiming an already-matched student", () => {
    const r = parseStudentNumberPaste("120451\tSantiago Caipo\n999999\tSantiago Caipo", ROSTER);
    expect(r.matched.map((m) => m.studentNumber)).toEqual(["120451"]);
    expect(r.unmatchedLines).toEqual(["999999\tSantiago Caipo"]);
  });

  it("lists the students the paste said nothing about", () => {
    const r = parseStudentNumberPaste("120451\tSantiago Caipo", ROSTER);
    expect(r.unmatchedStudents).toEqual(["Tomás Haaker", "Rafaella Amalia Rosell", "Ruifeng Wu"]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const r = parseStudentNumberPaste("\n  120451\tSantiago Caipo  \n\n", ROSTER);
    expect(r.matched.map((m) => m.studentNumber)).toEqual(["120451"]);
    expect(r.unmatchedLines).toEqual([]);
  });

  it("keeps leading zeros, which are part of the number", () => {
    const r = parseStudentNumberPaste("0012345\tRuifeng Wu", ROSTER);
    expect(r.matched[0].studentNumber).toBe("0012345");
  });

  it("handles an empty paste without claiming anything", () => {
    const r = parseStudentNumberPaste("", ROSTER);
    expect(r.matched).toEqual([]);
    expect(r.unmatchedLines).toEqual([]);
    expect(r.unmatchedStudents).toHaveLength(ROSTER.length);
  });
});
