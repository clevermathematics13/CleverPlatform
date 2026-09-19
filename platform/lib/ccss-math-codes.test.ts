import { describe, expect, it } from "vitest";
import { CCSS_MATH_DOMAINS, parseStandardEntry, validateStandardCode } from "./ccss-math-codes";
import { KA1_UNIT1_RUBRIC } from "./fixtures/g9-standard-ka1-unit1";

describe("validateStandardCode", () => {
  it("accepts every code the KA1 Unit 1 fixture actually cites", () => {
    for (const strand of KA1_UNIT1_RUBRIC.strands) {
      for (const entry of strand.standards) {
        const { code } = parseStandardEntry(entry);
        expect(validateStandardCode(code)).toEqual({ ok: true });
      }
    }
  });

  it("accepts MP1 through MP8", () => {
    for (let i = 1; i <= 8; i++) {
      expect(validateStandardCode(`MP${i}`)).toEqual({ ok: true });
    }
  });

  it("rejects MP0 and MP9, which do not exist", () => {
    expect(validateStandardCode("MP0").ok).toBe(false);
    expect(validateStandardCode("MP9").ok).toBe(false);
  });

  it("rejects a Grade 9 prefix -- CCSS has no domains of its own for grade 9", () => {
    const result = validateStandardCode("9.EE.A.1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/doesn't look like a CCSS Math code/);
  });

  it("rejects an invented domain", () => {
    const result = validateStandardCode("Z-FAKE.A.1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a Grade 6-8 or High School CCSS Math domain/);
  });

  it("rejects a real domain typo'd to one that does not exist", () => {
    // 6.RP is real; 6.ZZ is not.
    expect(validateStandardCode("6.ZZ.A.1").ok).toBe(false);
  });

  it("rejects a code missing the cluster letter or standard number", () => {
    expect(validateStandardCode("F-LE").ok).toBe(false);
    expect(validateStandardCode("F-LE.A").ok).toBe(false);
    expect(validateStandardCode("F-LE.2").ok).toBe(false);
  });

  it("accepts a lettered sub-part", () => {
    expect(validateStandardCode("A-SSE.A.1b")).toEqual({ ok: true });
    expect(validateStandardCode("F-BF.A.1a")).toEqual({ ok: true });
  });

  it("every domain in the catalog round-trips through its own name lookup", () => {
    for (const [code, name] of Object.entries(CCSS_MATH_DOMAINS)) {
      expect(name.length).toBeGreaterThan(0);
      expect(validateStandardCode(`${code}.A.1`)).toEqual({ ok: true });
    }
  });
});

describe("parseStandardEntry", () => {
  it("splits the leading code from the strand author's paraphrase", () => {
    expect(parseStandardEntry("F-LE.A.2 Build a linear rule from a description.")).toEqual({
      code: "F-LE.A.2",
      description: "Build a linear rule from a description.",
    });
  });

  it("handles a code with no description", () => {
    expect(parseStandardEntry("MP3")).toEqual({ code: "MP3", description: "" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseStandardEntry("  6.EE.A.2c  evaluate it  ")).toEqual({
      code: "6.EE.A.2c",
      description: "evaluate it",
    });
  });
});
