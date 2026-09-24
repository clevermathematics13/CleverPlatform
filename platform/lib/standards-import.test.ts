import { describe, expect, it } from "vitest";
import {
  ExtractedAssessmentSchema,
  StandardsAssessmentDraftSchema,
  buildStandardsImportSystemPrompt,
  hasBlockingFindings,
  toStandardsDraft,
  validateStandardsDraft,
  type ExtractedAssessment,
  type StandardsAssessmentDraft,
} from "./standards-import";
import { KA1_UNIT1_ITEMS, KA1_UNIT1_RUBRIC } from "./fixtures/g9-standard-ka1-unit1";

/** What a faithful read of the two KA1 PDFs would come back as. */
function ka1Extraction(): ExtractedAssessment {
  return {
    name: "Key Assessment #1 Unit 1",
    testDate: "2026-09-14",
    timeAllowedMinutes: 60,
    calculatorPermitted: true,
    statedTotalMarks: 42,
    items: KA1_UNIT1_ITEMS.map((it) => ({
      questionNumber: it.questionNumber,
      partLabel: it.partLabel,
      maxMarks: it.maxMarks,
      stemText: it.stemText,
      questionText: it.questionText,
      markschemeText: it.markschemeText,
    })),
    bands: { exceeding: 0.85, meeting: 0.65, approaching: 0.4 },
    strands: KA1_UNIT1_RUBRIC.strands.map((s) => ({
      code: s.code,
      name: s.name,
      standards: s.standards,
      parts: s.parts,
      statedMarks: { A: 11, B: 13, C: 9, D: 9 }[s.code] ?? null,
      descriptors: {
        exceeding: s.descriptors?.exceeding ?? null,
        meeting: s.descriptors?.meeting ?? null,
        approaching: s.descriptors?.approaching ?? null,
        beginning: s.descriptors?.beginning ?? null,
      },
    })),
    overallDescriptors: { exceeding: null, meeting: null, approaching: null, beginning: null },
    rubricSource: "Teacher Marking Rubric, 9 Mathematics, Key Assessment #1, Unit 1",
    readerNotes: [],
  };
}

describe("toStandardsDraft", () => {
  it("produces a valid draft whose rubric fits its parts, from a faithful read", () => {
    const extracted = ExtractedAssessmentSchema.parse(ka1Extraction());
    const draft = toStandardsDraft(extracted);
    expect(StandardsAssessmentDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.items).toHaveLength(26);
    expect(draft.rubric.strands.map((s) => s.code)).toEqual(["A", "B", "C", "D"]);
    expect(draft.rubric.overallDescriptors).toBeUndefined();
    expect(draft.statedStrandMarks).toEqual({ A: 11, B: 13, C: 9, D: 9 });
    expect(validateStandardsDraft(draft)).toEqual([]);
  });

  it("normalises part labels and refs, defaults the bands, and drops empty descriptors", () => {
    const extracted = ka1Extraction();
    extracted.bands = null;
    extracted.items[3].partLabel = "(A)";
    extracted.strands[1].parts = extracted.strands[1].parts.map((p) => (p === "2a" ? "2(A)" : p));
    extracted.strands[2].descriptors = { exceeding: "  ", meeting: null, approaching: null, beginning: null };
    const draft = toStandardsDraft(extracted);
    expect(draft.items[3].partLabel).toBe("a");
    expect(draft.rubric.bands).toEqual({ exceeding: 0.85, meeting: 0.65, approaching: 0.4 });
    expect(draft.rubric.strands[1].parts).toContain("2a");
    expect(draft.rubric.strands[2].descriptors).toBeUndefined();
    expect(validateStandardsDraft(draft)).toEqual([]);
  });

  it("keeps a part's stem apart from its own wording, and blanks an empty stem to null", () => {
    const extracted = ka1Extraction();
    extracted.items[0].stemText = "   ";
    const draft = toStandardsDraft(extracted);
    const q3b = draft.items.find((it) => it.questionNumber === 3 && it.partLabel === "b")!;
    expect(q3b.stemText).toMatch(/^Consider the alternating sequence/);
    expect(q3b.questionText).toMatch(/^The 11th term of the sequence is 27/);
    expect(draft.items[0].stemText).toBeNull();
    const q5 = draft.items.find((it) => it.questionNumber === 5)!;
    expect(q5.stemText).toBeNull();
  });

  it("accepts a draft saved before the stem existed (no stemText on its items)", () => {
    const draft = toStandardsDraft(ExtractedAssessmentSchema.parse(ka1Extraction()));
    const legacy = { ...draft, items: draft.items.map(({ stemText: _stem, ...rest }) => rest) };
    const parsed = StandardsAssessmentDraftSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items.every((it) => it.stemText === null)).toBe(true);
  });

  it("rejects a date that is not YYYY-MM-DD rather than saving it", () => {
    const extracted = ka1Extraction();
    extracted.testDate = "September 14-15, 2026";
    expect(toStandardsDraft(extracted).testDate).toBeNull();
  });
});

describe("validateStandardsDraft", () => {
  const base = (): StandardsAssessmentDraft => toStandardsDraft(ka1Extraction());

  it("catches a misread part ref through the strand total", () => {
    // "2a" read as "2d" in strand B: the rubric still parses (2d is a real
    // part, and B's parts are still distinct within B) but the schema now
    // has 2d in two strands, and B's total drops from 13 to 14 ... the
    // schema refuses it first.
    const draft = base();
    draft.rubric.strands[1].parts = draft.rubric.strands[1].parts.map((p) => (p === "2a" ? "2d" : p));
    expect(StandardsAssessmentDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("warns when a strand's parts do not add up to the printed strand total", () => {
    const draft = base();
    // Move 9b (1 mark) from B to C: both still parse, both totals now disagree.
    draft.rubric.strands[1].parts = draft.rubric.strands[1].parts.filter((p) => p !== "9b");
    draft.rubric.strands[2].parts.push("9b");
    const findings = validateStandardsDraft(draft);
    expect(findings.map((f) => f.message)).toEqual([
      "Strand B adds up to 12 marks from its parts but the rubric says 13; check which parts belong to it",
      "Strand C adds up to 10 marks from its parts but the rubric says 9; check which parts belong to it",
    ]);
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it("warns when the parts do not add up to the cover's total", () => {
    const draft = base();
    draft.items[0].maxMarks = 2;
    const findings = validateStandardsDraft(draft);
    expect(findings.some((f) => f.message.includes("add up to 43 marks but the paper says 42"))).toBe(true);
    expect(findings.some((f) => f.message.includes("Strand A adds up to 12"))).toBe(true);
  });

  it("blocks a duplicate part, a zero-mark part and a part with no mark scheme", () => {
    const draft = base();
    draft.items.push({ ...draft.items[0] });
    draft.items[1].maxMarks = 0;
    draft.items[2].markschemeText = "";
    const findings = validateStandardsDraft(draft);
    expect(hasBlockingFindings(findings)).toBe(true);
    expect(findings.filter((f) => f.severity === "block").map((f) => f.message)).toEqual([
      "Q1(b) is worth 0 marks; every part needs at least 1",
      "Q1(c) has no mark scheme text, so it cannot be graded",
      "Q1(a) appears twice in the parts list",
    ]);
  });

  it("blocks a rubric that names a part the paper does not have", () => {
    const draft = base();
    draft.rubric.strands[0].parts.push("10a");
    const findings = validateStandardsDraft(draft);
    expect(findings).toContainEqual({
      severity: "block",
      message: "Strand A lists Q10(a), which is not a part of this test",
    });
  });
});

describe("buildStandardsImportSystemPrompt", () => {
  it("tells the reader to transcribe, to put the stem in stemText, and to give every part exactly one strand", () => {
    const p = buildStandardsImportSystemPrompt();
    expect(p).toContain("Transcribe; do not improve");
    expect(p).toContain("in stemText, word for word and identical on every one of its lettered parts");
    expect(p).toContain("belongs in that part's questionText, never only in the stem");
    expect(p).toContain("Every part belongs to exactly one strand");
    expect(p).toContain("Return only the JSON object.");
  });
});
