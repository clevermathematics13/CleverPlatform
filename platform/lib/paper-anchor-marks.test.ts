import { describe, expect, it } from "vitest";
import { anchorMarkHtml, anchorMarkKey, parseAnchorMarks } from "./paper-anchor-marks";

describe("anchorMarkKey", () => {
  it("writes a subpart as its question and letter", () => {
    expect(anchorMarkKey(4, "b")).toBe("4b");
  });

  it("writes a question with no subparts with the no-part marker", () => {
    // test_items stores "" for these, and "" between the sentinels would make
    // the mark unparseable, so it has to become a character of its own.
    expect(anchorMarkKey(7, "")).toBe("7_");
  });

  it("normalises a label the draft may have stored loosely", () => {
    expect(anchorMarkKey(2, " A ")).toBe("2a");
  });
});

describe("parseAnchorMarks", () => {
  it("finds both corners of a box and says where each began", () => {
    const marks = parseAnchorMarks(`${anchorMarkHtml(4, "b")}`);
    expect(marks.map((m) => m.corner)).toEqual(["A", "Z"]);
    expect(marks[0]).toMatchObject({ questionNumber: 4, partLabel: "b" });
    expect(marks[1].index).toBeGreaterThan(marks[0].index);
  });

  it("reads the no-part marker back as the empty label test_items uses", () => {
    const [mark] = parseAnchorMarks("@@A7_@@");
    expect(mark).toMatchObject({ questionNumber: 7, partLabel: "" });
  });

  it("reads a mark that the PDF text layer split across items", () => {
    // The reason parseAnchorMarks takes a whole page's text rather than one
    // item: a text run may be broken anywhere, so the marks are matched after
    // the items are joined.
    const joined = ["@@A", "12", "c@@"].join("");
    expect(parseAnchorMarks(joined)).toEqual([
      { corner: "A", questionNumber: 12, partLabel: "c", index: 0 },
    ]);
  });

  it("finds every mark on a page, in the order they appear", () => {
    const page = `prose ${anchorMarkHtml(1, "a")} more prose ${anchorMarkHtml(1, "b")}`;
    const marks = parseAnchorMarks(page);
    expect(marks.map((m) => `${m.corner}${m.questionNumber}${m.partLabel}`)).toEqual([
      "A1a",
      "Z1a",
      "A1b",
      "Z1b",
    ]);
  });

  it("ignores text that merely looks like a mark", () => {
    // "[4]" is a mark allocation and "@" is ordinary; neither may be mistaken
    // for a region, or a paper would gain anchors nothing asked for.
    expect(parseAnchorMarks("worth [4] marks, email a@b, @@ and @@X1a@@")).toEqual([]);
  });

  it("finds nothing in a paper that was never marked up", () => {
    expect(parseAnchorMarks("Explain what 19c means in this context. Use units.")).toEqual([]);
  });
});

describe("anchorMarkHtml", () => {
  it("emits two corner spans that carry no visible text of their own", () => {
    const html = anchorMarkHtml(3, "a");
    expect(html).toContain("anchor-mark-a");
    expect(html).toContain("anchor-mark-z");
    // The mark must be invisible by CLASS, never by being empty -- an empty
    // span has no position in the text layer and so cannot be read back.
    expect(html).toContain("@@A3a@@");
    expect(html).toContain("@@Z3a@@");
  });
});
