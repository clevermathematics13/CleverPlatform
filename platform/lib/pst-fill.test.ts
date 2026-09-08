import { describe, it, expect } from "vitest";
import {
  fillPstScores,
  clearPstScores,
  readPstMetadata,
  retargetPst,
  PstFormatError,
} from "./pst-fill";

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

describe("readPstMetadata", () => {
  it("reads the block PowerSchool writes above the header", () => {
    expect(readPstMetadata(PST)).toEqual({
      teacherName: "Pablo Clevenger",
      className: "Extended Mathematics 09",
      assignmentName: "Unit 1 Formative Assessment",
      dueDate: "2026-08-25",
      pointsPossible: "7.0",
      scoreType: "GRADESCALE",
      studentCount: 4,
    });
  });

  // The trailing blank line PowerSchool writes is structure, not a student.
  it("does not count the trailing blank line as a student", () => {
    expect(readPstMetadata(PST).studentCount).toBe(4);
    expect(readPstMetadata(PST.replace(/\n$/, "")).studentCount).toBe(4);
  });

  it("reports a label the template does not carry as null", () => {
    const noDueDate = PST.replace("Due Date:,2026-08-25,\n", "");
    expect(readPstMetadata(noDueDate).dueDate).toBeNull();
  });

  it("reads an empty value as null rather than an empty string", () => {
    expect(readPstMetadata(PST.replace("2026-08-25", "")).dueDate).toBeNull();
  });

  it("rejects a file with no recognisable header row", () => {
    expect(() => readPstMetadata("some,other,file\n1,2,3")).toThrow(PstFormatError);
  });
});

describe("clearPstScores", () => {
  // The normal case: the template arrives blank and must come back untouched,
  // because it is stored and re-served for months afterwards.
  it("leaves an already-blank template byte-identical", () => {
    expect(clearPstScores(PST)).toBe(PST);
  });

  it("empties a Score cell that arrived with a score in it", () => {
    const filled = fillPstScores(PST, scores({ "30017": "4", "30246": "5" })).csv;
    expect(clearPstScores(filled)).toBe(PST);
  });

  it("keeps the metadata and the roster", () => {
    const filled = fillPstScores(PST, scores({ "30017": "4" })).csv;
    const cleared = clearPstScores(filled);
    expect(cleared).toContain("Assignment Name:,Unit 1 Formative Assessment,");
    expect(cleared).toContain("30017,Santiago CAIPO,");
    expect(cleared).not.toContain("30017,Santiago CAIPO,4");
  });

  it("preserves CRLF", () => {
    const crlf = PST.replace(/\n/g, "\r\n");
    expect(clearPstScores(crlf)).toBe(crlf);
  });
});

describe("retargetPst", () => {
  it("rewrites the assignment name and due date, leaving the rest alone", () => {
    const r = retargetPst(PST, {
      assignmentName: "Unit 2 Formative Assessment",
      dueDate: "2026-10-02",
    });
    expect(r.split("\n").slice(0, 8)).toEqual([
      "Teacher Name:,Pablo Clevenger,",
      "Class:,Extended Mathematics 09,",
      "Assignment Name:,Unit 2 Formative Assessment,",
      "Due Date:,2026-10-02,",
      "Points Possible:,7.0,",
      "Extra Points:,0.0,",
      "Score Type:,GRADESCALE,",
      "Student Num,Student Name,Score",
    ]);
  });

  // Points Possible is 7.0 because the Score column holds a 1-7 achievement
  // level, not a raw mark out of the paper's total. Rewriting it from the
  // test's total_marks would misdescribe every score in the file.
  it("does not touch points possible or score type", () => {
    const r = retargetPst(PST, { assignmentName: "Anything" });
    expect(r).toContain("Points Possible:,7.0,");
    expect(r).toContain("Score Type:,GRADESCALE,");
  });

  it("leaves the roster untouched", () => {
    const r = retargetPst(PST, { assignmentName: "Unit 2" });
    expect(r).toContain("30252,Roberto GAMIO,");
    expect(r.split("\n").length).toBe(PST.split("\n").length);
  });

  it("leaves a field alone when there is nothing to write", () => {
    const r = retargetPst(PST, { assignmentName: "Unit 2", dueDate: null });
    expect(r).toContain("Due Date:,2026-08-25,");
  });

  it("returns the template unchanged when given nothing at all", () => {
    expect(retargetPst(PST, {})).toBe(PST);
  });

  // A metadata line below the header would be a student row, and rewriting one
  // would corrupt the roster.
  it("only rewrites lines above the header row", () => {
    const odd = PST.replace(
      "30247,Kaito FUJII,",
      "Assignment Name:,not a metadata line,"
    );
    const r = retargetPst(odd, { assignmentName: "Unit 2" });
    expect(r).toContain("Assignment Name:,not a metadata line,");
  });

  it("quotes a rewritten value that contains a comma", () => {
    const r = retargetPst(PST, { assignmentName: "Unit 2, revisited" });
    expect(r).toContain('Assignment Name:,"Unit 2, revisited",');
  });

  it("preserves CRLF", () => {
    const r = retargetPst(PST.replace(/\n/g, "\r\n"), { assignmentName: "Unit 2" });
    expect(r).toContain("\r\n");
    expect(r.split("\r\n")[2]).toBe("Assignment Name:,Unit 2,");
  });
});
