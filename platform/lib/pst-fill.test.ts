import { describe, it, expect } from "vitest";
import { fillPstScores, PstFormatError } from "./pst-fill";

/** A real PST, trimmed to four students. Taken verbatim from the 9A export of
 *  "Unit 1 Formative Assessment", including the caps-surname name style and the
 *  trailing blank line PowerSchool writes. */
const PST = [
  "Teacher Name:,Pablo Clevenger,",
  "Class:,Extended Mathematics 09,",
  "Assignment Name:,Unit 1 Formative Assessment,",
  "Due Date:,2026-08-25,",
  "Points Possible:,7.0,",
  "Extra Points:,0.0,",
  "Score Type:,GRADESCALE,",
  "Student Num,Student Name,Score",
  "30017,Santiago CAIPO,",
  "30246,Freya DELISLE,",
  "30247,Kaito FUJII,",
  "30252,Roberto GAMIO,",
  "",
].join("\n");

const scores = (m: Record<string, string>) => new Map(Object.entries(m));

describe("fillPstScores", () => {
  it("writes scores into the Score column and leaves everything else alone", () => {
    const r = fillPstScores(PST, scores({ "30017": "4", "30246": "5" }));
    expect(r.csv.split("\n")).toEqual([
      "Teacher Name:,Pablo Clevenger,",
      "Class:,Extended Mathematics 09,",
      "Assignment Name:,Unit 1 Formative Assessment,",
      "Due Date:,2026-08-25,",
      "Points Possible:,7.0,",
      "Extra Points:,0.0,",
      "Score Type:,GRADESCALE,",
      "Student Num,Student Name,Score",
      "30017,Santiago CAIPO,4",
      "30246,Freya DELISLE,5",
      "30247,Kaito FUJII,",
      "30252,Roberto GAMIO,",
      "",
    ]);
    expect(r.filled).toBe(2);
  });

  // The whole point of echoing the template back: PowerSchool's "Roberto GAMIO"
  // never has to be reconciled with this platform's "Roberto Aurelio Gamio".
  it("matches on student number, not name", () => {
    const r = fillPstScores(PST, scores({ "30252": "3" }));
    expect(r.csv).toContain("30252,Roberto GAMIO,3");
    expect(r.filled).toBe(1);
  });

  it("reports rows it had no score for, and leaves them untouched", () => {
    const r = fillPstScores(PST, scores({ "30017": "4" }));
    expect(r.unfilled.map((u) => u.studentNumber)).toEqual(["30246", "30247", "30252"]);
    expect(r.unfilled[0].studentName).toBe("Freya DELISLE");
    expect(r.csv).toContain("30246,Freya DELISLE,");
  });

  it("reports scores for students the template does not list", () => {
    const r = fillPstScores(PST, scores({ "30017": "4", "99999": "7" }));
    expect(r.notInTemplate).toEqual(["99999"]);
    expect(r.csv).not.toContain("99999");
  });

  it("writes ABS through unchanged", () => {
    const r = fillPstScores(PST, scores({ "30247": "ABS" }));
    expect(r.csv).toContain("30247,Kaito FUJII,ABS");
  });

  it("preserves CRLF when the template uses it", () => {
    const r = fillPstScores(PST.replace(/\n/g, "\r\n"), scores({ "30017": "4" }));
    expect(r.csv).toContain("\r\n");
    expect(r.csv.split("\r\n")[8]).toBe("30017,Santiago CAIPO,4");
  });

  it("keeps the trailing blank line", () => {
    const r = fillPstScores(PST, scores({}));
    expect(r.csv.endsWith("\n")).toBe(true);
  });

  it("returns the template unchanged when there is nothing to fill", () => {
    expect(fillPstScores(PST, scores({})).csv).toBe(PST);
  });

  it("ignores whitespace around a student number", () => {
    const padded = PST.replace("30017,Santiago CAIPO,", " 30017 ,Santiago CAIPO,");
    expect(fillPstScores(padded, scores({ "30017": "4" })).filled).toBe(1);
  });

  it("quotes a name containing a comma when it rewrites the row", () => {
    const withComma = PST.replace("30017,Santiago CAIPO,", '30017,"CAIPO, Santiago",');
    const r = fillPstScores(withComma, scores({ "30017": "4" }));
    expect(r.csv).toContain('30017,"CAIPO, Santiago",4');
  });

  it("accepts the Student Number spelling as well as Student Num", () => {
    const variant = PST.replace("Student Num,", "Student Number,");
    expect(fillPstScores(variant, scores({ "30017": "4" })).filled).toBe(1);
  });

  it("fills a Score column that is not the last one", () => {
    const reordered = [
      "Student Num,Score,Student Name",
      "30017,,Santiago CAIPO",
      "",
    ].join("\n");
    const r = fillPstScores(reordered, scores({ "30017": "4" }));
    expect(r.csv).toContain("30017,4,Santiago CAIPO");
  });

  it("widens a row that stops before the Score column", () => {
    const short = ["Student Num,Student Name,Score", "30017,Santiago CAIPO", ""].join("\n");
    expect(fillPstScores(short, scores({ "30017": "4" })).csv).toContain("30017,Santiago CAIPO,4");
  });

  it("rejects a file with no recognisable header row", () => {
    expect(() => fillPstScores("some,other,file\n1,2,3", scores({}))).toThrow(PstFormatError);
  });

  it("rejects an empty file", () => {
    expect(() => fillPstScores("   ", scores({}))).toThrow(PstFormatError);
  });
});
