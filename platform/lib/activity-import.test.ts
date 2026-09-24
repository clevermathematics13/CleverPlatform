import { describe, expect, it } from "vitest";
import {
  ActivityDraftSchema,
  MAX_MARKS_PER_PART,
  buildActivityImportSystemPrompt,
  hasBlockingFindings,
  normaliseTargetCode,
  toActivityDraft,
  validateActivityDraft,
  type ActivityDraft,
  type ExtractedActivity,
} from "./activity-import";
import { DEFAULT_OUTCOME_BANDS } from "./activity-rubric";

/** A minimal transcription in the shape the model returns. */
function extracted(overrides: Partial<ExtractedActivity> = {}): ExtractedActivity {
  return {
    name: "Exploration 1.1 - Equations that Describe Patterns",
    lesson: "1.1",
    kind: "exploration",
    items: [
      {
        questionNumber: 1,
        partLabel: "",
        maxMarks: 2,
        stemText: null,
        questionText: "Fill in the table.",
        markschemeText: "Chairs 8, 16, 24. Tablecloths 4, 5, 6.",
      },
      {
        questionNumber: 2,
        partLabel: "A",
        maxMarks: 1,
        stemText: "A party rental charges $c$ dollars for $t$ tables, at 8 dollars a table.",
        questionText: "Write an equation.",
        markschemeText: "$c = 8t$, or any correct rearrangement.",
      },
    ],
    targets: [
      { code: "LT #1", name: "Look for relationships between variables", note: "More than, fewer.", parts: ["1"] },
      { code: "lt2", name: "Use operations to describe a relationship", note: null, parts: ["2a", "2(a)"] },
    ],
    targetsFromLesson: true,
    keySource: "Math Medic Lesson 1.1 answer key",
    readerNotes: ["  ", "Q2 handwriting was faint."],
    ...overrides,
  };
}

describe("normaliseTargetCode", () => {
  it("strips the spacing and hash Math Medic prints", () => {
    expect(normaliseTargetCode("LT #1")).toBe("LT1");
    expect(normaliseTargetCode("  lt 2 ")).toBe("LT2");
    expect(normaliseTargetCode("LT#3.")).toBe("LT3");
  });

  it("keeps the code inside the 8 characters the rubric allows", () => {
    expect(normaliseTargetCode("LEARNINGTARGET1").length).toBe(8);
  });
});

describe("toActivityDraft", () => {
  it("produces a draft that parses", () => {
    const draft = toActivityDraft(extracted());
    expect(ActivityDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("normalises part labels and target codes", () => {
    const draft = toActivityDraft(extracted());
    expect(draft.items[1].partLabel).toBe("a");
    expect(draft.rubric.targets.map((t) => t.code)).toEqual(["LT1", "LT2"]);
  });

  it("de-duplicates a part listed twice under one target, which the schema rejects", () => {
    // The model wrote "2a" and "2(a)" under LT2; they are the same part.
    const draft = toActivityDraft(extracted());
    expect(draft.rubric.targets[1].parts).toEqual(["2a"]);
    expect(ActivityDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("fills in the platform's outcome bands, which no worksheet states", () => {
    expect(toActivityDraft(extracted()).rubric.bands).toEqual(DEFAULT_OUTCOME_BANDS);
  });

  it("carries the lesson, the kind and the key's title onto the rubric", () => {
    const rubric = toActivityDraft(extracted()).rubric;
    expect(rubric.lesson).toBe("1.1");
    expect(rubric.kind).toBe("exploration");
    expect(rubric.source).toBe("Math Medic Lesson 1.1 answer key");
  });

  it("drops blank reader notes rather than storing them", () => {
    expect(toActivityDraft(extracted()).readerNotes).toEqual(["Q2 handwriting was faint."]);
  });

  it("takes the date from the caller, since a worksheet never prints one", () => {
    expect(toActivityDraft(extracted(), { activityDate: "2026-09-18" }).activityDate).toBe("2026-09-18");
    expect(toActivityDraft(extracted(), { activityDate: "18/09/2026" }).activityDate).toBeNull();
    expect(toActivityDraft(extracted()).activityDate).toBeNull();
  });

  it("names an untitled activity rather than saving an empty name", () => {
    expect(toActivityDraft(extracted({ name: "   " })).name).toBe("Untitled activity");
  });

  it("drops an empty note instead of storing an empty string", () => {
    expect(toActivityDraft(extracted()).rubric.targets[1].note).toBeUndefined();
  });

  it("keeps a part's stem apart from its own wording, and blanks an empty stem to null", () => {
    const draft = toActivityDraft(extracted());
    expect(draft.items[1].stemText).toMatch(/^A party rental charges/);
    expect(draft.items[1].questionText).toBe("Write an equation.");
    expect(draft.items[0].stemText).toBeNull();
    const blank = extracted();
    blank.items[1].stemText = "   ";
    expect(toActivityDraft(blank).items[1].stemText).toBeNull();
  });

  it("accepts a draft saved before the stem existed (no stemText on its items)", () => {
    const draft = toActivityDraft(extracted());
    const legacy = { ...draft, items: draft.items.map(({ stemText: _stem, ...rest }) => rest) };
    const parsed = ActivityDraftSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items.every((it) => it.stemText === null)).toBe(true);
  });
});

describe("buildActivityImportSystemPrompt", () => {
  it("tells the reader to put the shared context in stemText, not in every part", () => {
    const p = buildActivityImportSystemPrompt();
    expect(p).toContain("in stemText, word for word and identical on every one of its lettered parts");
    expect(p).toContain("never only in the stem");
    expect(p).not.toContain("Repeat the shared context");
  });
});

describe("validateActivityDraft", () => {
  const draft = (patch: (d: ActivityDraft) => ActivityDraft = (d) => d): ActivityDraft =>
    patch(toActivityDraft(extracted()));

  it("passes a clean draft", () => {
    expect(validateActivityDraft(draft())).toEqual([]);
  });

  it("blocks a part listed twice", () => {
    const d = draft((x) => ({ ...x, items: [...x.items, { ...x.items[0] }] }));
    const findings = validateActivityDraft(d);
    expect(hasBlockingFindings(findings)).toBe(true);
    expect(findings.some((f) => f.message.includes("appears twice"))).toBe(true);
  });

  it("blocks a part with no answer read off the key", () => {
    const d = draft((x) => ({ ...x, items: x.items.map((it, i) => (i === 0 ? { ...it, markschemeText: "" } : it)) }));
    const findings = validateActivityDraft(d);
    expect(hasBlockingFindings(findings)).toBe(true);
    expect(findings.some((f) => f.message.includes("no answer from the key"))).toBe(true);
  });

  it("blocks a part worth nothing", () => {
    const d = draft((x) => ({ ...x, items: x.items.map((it, i) => (i === 0 ? { ...it, maxMarks: 0 } : it)) }));
    expect(hasBlockingFindings(validateActivityDraft(d))).toBe(true);
  });

  it("warns, but does not block, a part worth more than two marks", () => {
    const d = draft((x) => ({
      ...x,
      items: x.items.map((it, i) => (i === 0 ? { ...it, maxMarks: MAX_MARKS_PER_PART + 1 } : it)),
    }));
    const findings = validateActivityDraft(d);
    expect(hasBlockingFindings(findings)).toBe(false);
    expect(findings.some((f) => f.message.includes("1 idea or 2"))).toBe(true);
  });

  it("blocks a target naming a part the activity does not have", () => {
    const d = draft((x) => ({
      ...x,
      rubric: { ...x.rubric, targets: [{ code: "LT1", name: "Relationships", parts: ["9z"] }, x.rubric.targets[1]] },
    }));
    expect(hasBlockingFindings(validateActivityDraft(d))).toBe(true);
  });

  it("warns when the targets were proposed rather than read off the lesson", () => {
    const d = toActivityDraft(extracted({ targetsFromLesson: false }));
    const findings = validateActivityDraft(d);
    expect(hasBlockingFindings(findings)).toBe(false);
    expect(findings.some((f) => f.message.includes("proposed from the mathematics"))).toBe(true);
  });

  it("warns about a part that is evidence of nothing", () => {
    const d = draft((x) => ({ ...x, rubric: { ...x.rubric, targets: [x.rubric.targets[0]] } }));
    const findings = validateActivityDraft(d);
    expect(hasBlockingFindings(findings)).toBe(false);
    expect(findings.some((f) => f.message.includes("no learning target"))).toBe(true);
  });

  it("does NOT check the marks against a printed total, because there is none", () => {
    // The Standard Level importer catches a misread part by the strand totals
    // failing to add up. Nothing here can: a Math Medic worksheet prints no
    // marks at all, so halving every part's marks is a silently valid draft.
    const d = draft((x) => ({ ...x, items: x.items.map((it) => ({ ...it, maxMarks: 1 })) }));
    expect(validateActivityDraft(d)).toEqual([]);
  });
});
