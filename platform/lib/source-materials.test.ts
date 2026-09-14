import { describe, it, expect } from "vitest";
import {
  namespacedId,
  parseNamespacedId,
  draftToText,
  harvestText,
  buildSourceMaterialPrompt,
  SOURCE_TEXT_PER_ITEM,
  SOURCE_TEXT_TOTAL,
} from "./source-materials";
import type { AssignmentDraft } from "./assignments";

describe("namespaced ids", () => {
  it("round-trips", () => {
    const id = namespacedId("na-packet", "abc-123");
    expect(id).toBe("na-packet:abc-123");
    expect(parseNamespacedId(id)).toEqual({ kind: "na-packet", id: "abc-123" });
  });

  it("keeps a uuid containing a colon in one piece", () => {
    // Only the FIRST colon separates; anything after it belongs to the id.
    expect(parseNamespacedId("upload:a:b")).toEqual({ kind: "upload", id: "a:b" });
  });

  it("rejects anything that is not a known origin", () => {
    // The two origins have independent id spaces, so an unprefixed or
    // unrecognised value must not be guessed at -- it would read the wrong table.
    expect(parseNamespacedId("abc-123")).toBeNull();
    expect(parseNamespacedId("notakind:abc")).toBeNull();
    expect(parseNamespacedId(":abc")).toBeNull();
    expect(parseNamespacedId("")).toBeNull();
  });
});

describe("draftToText", () => {
  const draft: AssignmentDraft = {
    title: "Formative Assessment 1",
    subtitle: "Grade 9 Mathematics",
    instructions: ["Answer every part."],
    sections: [
      {
        heading: "LEVEL 1",
        questions: [
          {
            prompt: "Write down the coefficient of x in 3x + 7.",
            marks: 1,
            answer: "3",
            markScheme: "A1 for the correct value.",
            subparts: [{ prompt: "State the constant term.", marks: 1, answer: "7" }],
          },
        ],
      },
    ],
    markingPrinciples: ["Accept equivalent correct forms."],
  };

  it("carries the mark scheme, which is the clearest statement of what was expected", () => {
    const text = draftToText(draft);
    expect(text).toContain("A1 for the correct value.");
    expect(text).toContain("Accept equivalent correct forms.");
  });

  it("includes subparts and their answers", () => {
    const text = draftToText(draft);
    expect(text).toContain("State the constant term.");
    expect(text).toContain("7");
  });

  it("survives a draft with the optional arrays missing", () => {
    const bare = { title: "T", subtitle: "S", sections: [] } as unknown as AssignmentDraft;
    expect(() => draftToText(bare)).not.toThrow();
    expect(draftToText(bare)).toContain("T");
  });
});

describe("harvestText", () => {
  it("pulls prose out of an arbitrary nested blob", () => {
    const parts = { a: { body: "Explain what the expression means in context." }, b: [{ q: "Show that x = 6." }] };
    expect(harvestText(parts)).toEqual([
      "Explain what the expression means in context.",
      "Show that x = 6.",
    ]);
  });

  it("skips ids and single-word tokens, which are structure not content", () => {
    expect(harvestText({ id: "a1b2c3", kind: "investigation", n: 4, ok: true })).toEqual([]);
  });

  it("stops before a cyclic or absurdly deep structure exhausts the stack", () => {
    let deep: Record<string, unknown> = { body: "too deep to matter here" };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(() => harvestText(deep)).not.toThrow();
    expect(harvestText(deep)).toEqual([]);
  });
});

describe("buildSourceMaterialPrompt", () => {
  it("is empty when nothing is selected, so callers can append it blindly", () => {
    expect(buildSourceMaterialPrompt([]).prompt).toBe("");
  });

  it("tells the model to assess what is there, not the topic in general", () => {
    const out = buildSourceMaterialPrompt([
      { title: "KA1 Study Guide", kind: "upload", text: "Commutative property..." },
    ]);
    expect(out.prompt).toContain("SOURCE MATERIAL");
    expect(out.prompt).toContain("KA1 Study Guide");
    expect(out.prompt).toContain("Uploaded");
    // The rule that stops it reprinting the practice set.
    expect(out.prompt).toMatch(/do not copy a question verbatim/i);
  });

  it("shortens an item over the per-item ceiling and says which", () => {
    const out = buildSourceMaterialPrompt([
      { title: "Huge", kind: "upload", text: "x".repeat(SOURCE_TEXT_PER_ITEM + 5_000) },
    ]);
    expect(out.truncated).toEqual(["Huge"]);
    expect(out.charsUsed).toBe(SOURCE_TEXT_PER_ITEM);
  });

  it("drops later items once the total runs out, and names them", () => {
    // Silently sending half a study guide is worse than a stated limit: the
    // gaps come back looking like the model's judgement.
    const big = (t: string) => ({ title: t, kind: "upload" as const, text: "y".repeat(SOURCE_TEXT_PER_ITEM) });
    const out = buildSourceMaterialPrompt([big("a"), big("b"), big("c"), big("d"), big("e")]);
    expect(out.charsUsed).toBeLessThanOrEqual(SOURCE_TEXT_TOTAL);
    expect(out.dropped.length).toBeGreaterThan(0);
  });

  it("drops an entry with no text and does not pretend it was used", () => {
    const out = buildSourceMaterialPrompt([
      { title: "Scan with no text layer", kind: "upload", text: "   " },
      { title: "Real", kind: "template", text: "Distributive property." },
    ]);
    expect(out.dropped).toEqual(["Scan with no text layer"]);
    expect(out.prompt).toContain("Real");
    expect(out.prompt).not.toContain("Scan with no text layer");
  });

  it("keeps the selection's order, which is the teacher's reading order", () => {
    const out = buildSourceMaterialPrompt([
      { title: "First", kind: "upload", text: "one" },
      { title: "Second", kind: "na-packet", text: "two" },
    ]);
    expect(out.prompt.indexOf("First")).toBeLessThan(out.prompt.indexOf("Second"));
  });
});
