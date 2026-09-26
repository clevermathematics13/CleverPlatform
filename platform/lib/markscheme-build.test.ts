import { describe, expect, it } from "vitest";
import {
  alignSubparts,
  checkTranscription,
  decideAcceptance,
  isIdenticalSiblingCopy,
  isValidBankLabel,
  latexMathErrors,
  mathSpans,
  normalizeTranscription,
  planPartChanges,
  proposalParts,
  questionNumberFromCode,
  readStoredTranscription,
  realBankTotal,
  schemeFromEdits,
  splitSubparts,
  toBankLabel,
  wholeQuestionLatex,
  type ExistingPart,
  type TranscribedScheme,
} from "./markscheme-build";

// Every scheme here is invented. Real IB mark scheme text never goes into
// this repository (it is public).

function scheme(parts: TranscribedScheme["parts"], extra: Partial<TranscribedScheme> = {}): TranscribedScheme {
  return { questionNumber: 4, totalMarks: null, parts, unreadable: [], sourceProblems: [], misprints: [], diagrams: [], ...extra };
}

const partA = { label: "(a)", marks: 2, latex: "attempt at chain rule \\hfill M1\n$y' = 6x$ \\hfill A1\n\\hfill [2 marks]" };
const partB = { label: "(b)", marks: 3, latex: "sets $y' = 0$ \\hfill M1\n$x = 0$ \\hfill A1\n$y = 5$ \\hfill A1\n\\hfill [3 marks]" };

function part(overrides: Partial<ExistingPart> = {}): ExistingPart {
  return {
    id: "p1",
    part_label: "",
    marks: 1,
    sort_order: 0,
    markscheme_latex: null,
    content_latex: null,
    command_term: null,
    command_terms: [],
    latex_verified: false,
    subtopic_codes: ["2.5"],
    primary_subtopic_code: "2.5",
    ...overrides,
  };
}

function checked(t: TranscribedScheme, bankTotal: number | null = null) {
  const normalized = normalizeTranscription(t);
  const check = checkTranscription(normalized, { expectedQuestionNumber: 4, bankTotal });
  return { normalized, check };
}

describe("labels and codes", () => {
  it("turns printed labels into bank labels", () => {
    expect(toBankLabel("(b)(ii)")).toBe("bii");
    expect(toBankLabel("b(ii)")).toBe("bii");
    expect(toBankLabel("(a)")).toBe("a");
    expect(toBankLabel("Part (c)")).toBe("c");
    expect(toBankLabel("")).toBe("");
  });

  it("accepts only what the marking screen can label", () => {
    expect(isValidBankLabel("")).toBe(true);
    expect(isValidBankLabel("a")).toBe(true);
    expect(isValidBankLabel("biii")).toBe(true);
    expect(isValidBankLabel("ab")).toBe(false);
    expect(isValidBankLabel("1")).toBe(false);
  });

  it("reads the question number from every code shape in the bank", () => {
    expect(questionNumberFromCode("22N.1.SL.TZ0.S_1")).toBe(1);
    expect(questionNumberFromCode("08M.2.AHL.TZ2.H_09")).toBe(9);
    expect(questionNumberFromCode("SPM.1.AHL.TZ0.H_11")).toBe(11);
    expect(questionNumberFromCode("SP.2.01")).toBe(1);
  });
});

describe("normalizeTranscription", () => {
  it("moves a Total line out of a part and orders parts by label", () => {
    const n = normalizeTranscription(
      scheme([
        { ...partB, latex: `${partB.latex}\n\nTotal [5 marks]` },
        partA,
      ])
    );
    expect(n.parts.map((p) => p.label)).toEqual(["a", "b"]);
    expect(n.totalMarks).toBe(5);
    expect(n.parts[1].latex).not.toMatch(/Total/);
  });

  it("appends a part's marks statement when the text omits it", () => {
    const n = normalizeTranscription(scheme([{ label: "(a)", marks: 1, latex: "$k = 2$ \\hfill A1" }]));
    expect(n.parts[0].latex.endsWith("\\hfill [1 mark]")).toBe(true);
  });
});

describe("maths rendering", () => {
  it("finds maths spans and skips escaped dollars", () => {
    const { spans, unbalanced } = mathSpans("costs \\$5 and $x^2$ then $$\\frac{1}{2}$$");
    expect(unbalanced).toBe(false);
    expect(spans.map((s) => [s.tex, s.display])).toEqual([
      ["x^2", false],
      ["\\frac{1}{2}", true],
    ]);
  });

  it("reports what KaTeX cannot parse", () => {
    expect(latexMathErrors("$x^2 + \\boldsymbol{a}$")).toEqual([]);
    expect(latexMathErrors("$\\frac{1}{$")).toHaveLength(1);
    expect(latexMathErrors("$x + 1")).toEqual(["unbalanced maths delimiters"]);
  });
});

describe("checkTranscription", () => {
  it("passes a clean scheme and keeps its printed marks", () => {
    const { check } = checked(scheme([partA, partB], { totalMarks: 5 }));
    expect(check.issues).toEqual([]);
    expect(check.resolvedMarks).toEqual([2, 3]);
  });

  it("flags codes that do not add up to the printed marks", () => {
    const { check } = checked(scheme([{ ...partA, marks: 3, latex: partA.latex.replace("[2 marks]", "[3 marks]") }]));
    expect(check.issues.join(" ")).toMatch(/codes add up to 2, but it prints \[3 marks\]/);
  });

  it("flags parts that disagree with the question total", () => {
    const { check } = checked(scheme([partA, partB], { totalMarks: 6 }));
    expect(check.issues.join(" ")).toMatch(/add up to 5, but the question total is \[6 marks\]/);
  });

  it("flags the wrong question, unreadable spots and source problems", () => {
    const { check } = checked(
      scheme([partA], { questionNumber: 5, unreadable: ["exponent in line 2"], sourceProblems: ["continues past image"] })
    );
    expect(check.issues).toHaveLength(3);
  });

  it("flags top-level roman numerals", () => {
    const { check } = checked(
      scheme([
        { label: "(i)", marks: 1, latex: "$a$ \\hfill A1\n\\hfill [1 mark]" },
        { label: "(ii)", marks: 1, latex: "$b$ \\hfill A1\n\\hfill [1 mark]" },
      ])
    );
    expect(check.issues.join(" ")).toMatch(/top-level roman/);
  });

  it("derives marks from the codes when only a total is printed", () => {
    const { check } = checked(
      scheme(
        [
          { label: "(a)", marks: null, latex: "$p$ \\hfill M1A1" },
          { label: "(b)", marks: null, latex: "$q$ \\hfill A1" },
        ],
        { totalMarks: 3 }
      )
    );
    expect(check.issues).toEqual([]);
    expect(check.resolvedMarks).toEqual([2, 1]);
  });

  it("checks unprinted marks against a real bank total, and flags when there is none", () => {
    const t = scheme([{ label: "", marks: null, latex: "$r = 2$ \\hfill M1A1" }]);
    expect(checked(t, 2).check.issues).toEqual([]);
    expect(checked(t, 3).check.issues.join(" ")).toMatch(/bank's total is 3/);
    expect(checked(t, null).check.issues.join(" ")).toMatch(/no real total/);
  });

  it("flags a part whose text states other marks than it records", () => {
    const { check } = checked(scheme([{ ...partA, latex: partA.latex.replace("[2 marks]", "[4 marks]") }]));
    expect(check.issues.join(" ")).toMatch(/states \[4 marks\]/);
  });

  it("records misprints and diagrams without holding the scheme back", () => {
    const { check } = checked(scheme([partA], { misprints: ["a doubled equals sign"], diagrams: ["a sketch of a parabola"] }));
    expect(check.issues).toEqual([]);
    expect(check.warnings.join(" ")).toMatch(/Misprint in the scheme: a doubled equals sign/);
    expect(check.warnings.join(" ")).toMatch(/Diagram described in words: a sketch of a parabola/);
  });

  it("warns about codes left without \\hfill", () => {
    const { check } = checked(scheme([{ label: "", marks: 1, latex: "$s = 1$ A1\n$s = 1$ \\hfill A1\n\\hfill [1 mark]" }]));
    expect(check.issues).toEqual([]);
    expect(check.warnings.join(" ")).toMatch(/without \\hfill/);
  });
});

describe("planPartChanges", () => {
  const twoParts = normalizeTranscription(scheme([partA, partB], { totalMarks: 5 }));
  const marks = [2, 3];

  it("creates every part of a question that has none", () => {
    const plan = planPartChanges({ existing: [], scheme: twoParts, marks, inUse: null });
    expect(plan.flags).toEqual([]);
    expect(plan.actions.map((a) => [a.kind, "label" in a ? a.label : "", "sortOrder" in a ? a.sortOrder : 0])).toEqual([
      ["insert", "a", 10],
      ["insert", "b", 20],
    ]);
  });

  it("splits a placeholder unlabelled part, keeping its id and subtopics", () => {
    const plan = planPartChanges({ existing: [part()], scheme: twoParts, marks, inUse: null });
    expect(plan.flags).toEqual([]);
    expect(plan.resetImagePartIds).toBe(true);
    const [first, second] = plan.actions;
    expect(first).toMatchObject({ kind: "relabel", partId: "p1", expectedLabel: "", label: "a", marks: 2 });
    expect(second).toMatchObject({ kind: "insert", label: "b", subtopicCodes: ["2.5"], inheritedFromPartId: "p1" });
  });

  it("will not split a part that carries the question text or a command term", () => {
    expect(planPartChanges({ existing: [part({ content_latex: "Find $x$." })], scheme: twoParts, marks, inUse: null }))
      .toMatchObject({ actions: [], flags: [expect.stringMatching(/question's text/)] });
    expect(planPartChanges({ existing: [part({ command_terms: ["Find"] })], scheme: twoParts, marks, inUse: null }))
      .toMatchObject({ actions: [], flags: [expect.stringMatching(/command term/)] });
  });

  it("fills matching parts and corrects their marks", () => {
    const existing = [part({ id: "a", part_label: "a", marks: 1 }), part({ id: "b", part_label: "b", marks: 3 })];
    const plan = planPartChanges({ existing, scheme: twoParts, marks, inUse: null });
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: "fill", partId: "a", marks: 2 }),
      expect.objectContaining({ kind: "fill", partId: "b", marks: null }),
    ]);
  });

  it("never deletes: a bank part the scheme lacks flags the question", () => {
    const existing = ["a", "b", "c"].map((l) => part({ id: l, part_label: l }));
    const plan = planPartChanges({ existing, scheme: twoParts, marks, inUse: null });
    expect(plan.actions).toEqual([]);
    expect(plan.flags.join(" ")).toMatch(/\(c\)/);
  });

  it("leaves a verified part or an existing scheme alone", () => {
    const existing = [
      part({ id: "a", part_label: "a", marks: 2, latex_verified: true }),
      part({ id: "b", part_label: "b", marks: 3, markscheme_latex: "kept \\hfill A1" }),
    ];
    expect(planPartChanges({ existing, scheme: twoParts, marks, inUse: null })).toMatchObject({ actions: [], flags: [] });
  });

  it("flags a verified part whose marks disagree with the scheme instead of changing them", () => {
    const existing = [part({ id: "a", part_label: "a", marks: 1, latex_verified: true }), part({ id: "b", part_label: "b", marks: 3 })];
    const plan = planPartChanges({ existing, scheme: twoParts, marks, inUse: null });
    expect(plan.actions).toEqual([]);
    expect(plan.flags).toEqual(["The bank gives (a) 1 mark, the scheme 2."]);
  });

  it("rebuilds the parts of a whole-question copy, pinning the old text", () => {
    const existing = ["a", "b"].map((l) => part({ id: l, part_label: l, marks: l === "a" ? 2 : 3, markscheme_latex: "same" }));
    expect(isIdenticalSiblingCopy(existing)).toBe(true);
    const plan = planPartChanges({ existing, scheme: twoParts, marks, inUse: null });
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: "fill", partId: "a", expectedLatex: "same" }),
      expect.objectContaining({ kind: "fill", partId: "b", expectedLatex: "same" }),
    ]);
  });

  it("fills an unlabelled part from an unlabelled scheme", () => {
    const whole = normalizeTranscription(scheme([{ label: "", marks: 4, latex: "$m$ \\hfill M1A1A1A1\n\\hfill [4 marks]" }]));
    const plan = planPartChanges({ existing: [part()], scheme: whole, marks: [4], inUse: null });
    expect(plan.actions).toEqual([expect.objectContaining({ kind: "fill", partId: "p1", marks: 4 })]);
  });

  describe("in use", () => {
    it("creates one whole-question part for a whole-question item", () => {
      const plan = planPartChanges({ existing: [], scheme: twoParts, marks, inUse: { labels: [""], maxMarks: { "": 5 } } });
      expect(plan.flags).toEqual([]);
      expect(plan.actions).toEqual([expect.objectContaining({ kind: "insert", label: "", marks: 5, latex: wholeQuestionLatex(twoParts) })]);
      expect(wholeQuestionLatex(twoParts)).toMatch(/^\(a\)\n/);
    });

    it("flags a whole-question item whose tested marks differ", () => {
      const plan = planPartChanges({ existing: [], scheme: twoParts, marks, inUse: { labels: [""], maxMarks: { "": 6 } } });
      expect(plan.actions).toEqual([]);
      expect(plan.flags.join(" ")).toMatch(/worth 6/);
    });

    it("fills a whole-question part without changing its marks", () => {
      const plan = planPartChanges({ existing: [part({ marks: 5 })], scheme: twoParts, marks, inUse: { labels: [""], maxMarks: {} } });
      expect(plan.actions).toEqual([expect.objectContaining({ kind: "fill", partId: "p1", marks: null })]);
    });

    it("creates only the labels the tests use", () => {
      const three = normalizeTranscription(
        scheme([partA, partB, { label: "(c)", marks: 1, latex: "$t$ \\hfill A1\n\\hfill [1 mark]" }])
      );
      const plan = planPartChanges({ existing: [], scheme: three, marks: [2, 3, 1], inUse: { labels: ["a", "b"], maxMarks: { a: 2, b: 3 } } });
      expect(plan.actions.map((a) => ("label" in a ? a.label : ""))).toEqual(["a", "b"]);
    });

    it("never adds labels beside an unlabelled part", () => {
      const plan = planPartChanges({ existing: [part({ marks: 7 })], scheme: twoParts, marks, inUse: { labels: ["b"], maxMarks: { b: 3 } } });
      expect(plan.actions).toEqual([]);
      expect(plan.flags.join(" ")).toMatch(/count marks twice/);
    });
  });
});

describe("sub-parts that share their parent's marks", () => {
  // One printed [5 marks] for (a); (i) and (ii) inside it, as older IB schemes print them.
  const shared = {
    label: "(a)",
    marks: 5,
    latex: [
      "(i) attempt at product rule",
      "\\hfill (M1)",
      "$y' = 2x + 1$",
      "\\hfill A1",
      "",
      "(ii)",
      "sets $y' = 0$",
      "\\hfill M1",
      "$x = -\\frac{1}{2}$",
      "\\hfill A1",
      "Note: accept $-0.5$. Award A1 only when the M1 is awarded.",
      "$y = 3$",
      "\\hfill A1AG",
      "",
      "\\hfill [5 marks]",
    ].join("\n"),
  };
  const normalizedShared = () => normalizeTranscription(scheme([shared, partB], { totalMarks: 8 }));

  it("cuts a part at its (i), (ii) lines and values each piece by its codes", () => {
    const pieces = splitSubparts(normalizedShared().parts[0])!;
    expect(pieces.map((p) => [p.label, p.printedLabel, p.marks])).toEqual([
      ["ai", "(a)(i)", 2],
      ["aii", "(a)(ii)", 3],
    ]);
    expect(pieces[0].latex).toMatch(/^attempt at product rule/);
    expect(pieces[0].latex.endsWith("\\hfill [2 marks]")).toBe(true);
    expect(pieces[1].latex).toMatch(/Note: accept/);
    expect(pieces[1].latex).not.toMatch(/\[5 marks\]/);
  });

  it("will not cut when it cannot do so cleanly", () => {
    const base = normalizedShared().parts[0];
    expect(splitSubparts({ ...base, latex: `a lead-in line\n${base.latex}` })).toBeNull();
    expect(splitSubparts({ ...base, latex: base.latex.replace("(ii)", "(iii)") })).toBeNull();
    expect(splitSubparts({ ...base, marks: 6 })).toBeNull();
    expect(splitSubparts({ ...base, label: "", printedLabel: "" })).toBeNull();
    expect(splitSubparts(normalizeTranscription(scheme([partA])).parts[0])).toBeNull();
  });

  it("aligns only to the sub-parts the bank already uses", () => {
    const s = normalizedShared();
    const aligned = alignSubparts(s, [5, 3], new Set(["ai", "aii", "b"]));
    expect(aligned.scheme.parts.map((p) => p.label)).toEqual(["ai", "aii", "b"]);
    expect(aligned.marks).toEqual([2, 3, 3]);
    expect([...aligned.derived]).toEqual(["ai", "aii"]);
    expect(alignSubparts(s, [5, 3], new Set(["a", "b"])).scheme.parts.map((p) => p.label)).toEqual(["a", "b"]);
    expect(alignSubparts(s, [5, 3], new Set(["ai", "aii", "aiii"])).scheme.parts.map((p) => p.label)).toEqual(["a", "b"]);
  });

  it("fills the bank's sub-parts from a scheme that prints only their parent's marks", () => {
    const existing = [
      part({ id: "ai", part_label: "ai", marks: 2 }),
      part({ id: "aii", part_label: "aii", marks: 3 }),
      part({ id: "b", part_label: "b", marks: 3 }),
    ];
    const plan = planPartChanges({ existing, scheme: normalizedShared(), marks: [5, 3], inUse: null });
    expect(plan.flags).toEqual([]);
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: "fill", partId: "ai", marks: null }),
      expect.objectContaining({ kind: "fill", partId: "aii", marks: null }),
      expect.objectContaining({ kind: "fill", partId: "b", marks: null }),
    ]);
  });

  it("flags sub-part marks worked out from the codes that disagree with the bank's", () => {
    const existing = [part({ id: "ai", part_label: "ai", marks: 1 }), part({ id: "aii", part_label: "aii", marks: 4 })];
    const plan = planPartChanges({ existing, scheme: normalizedShared(), marks: [5, 3], inUse: null });
    expect(plan.actions).toEqual([]);
    expect(plan.flags).toContain("The bank gives (ai) 1 mark, the scheme 2.");
  });

  it("creates the sub-parts a test uses", () => {
    const plan = planPartChanges({
      existing: [],
      scheme: normalizedShared(),
      marks: [5, 3],
      inUse: { labels: ["ai", "aii"], maxMarks: { ai: 2, aii: 3 } },
    });
    expect(plan.flags).toEqual([]);
    expect(plan.actions.map((a) => ("label" in a ? [a.label, a.marks] : []))).toEqual([
      ["ai", 2],
      ["aii", 3],
    ]);
  });
});

describe("a teacher's Accept in LaTeX Review", () => {
  const original = scheme([partA, partB], { totalMarks: 5, misprints: ["a doubled sign"], unreadable: ["line 2"] });

  it("reads a stored transcription, including one from before misprints and diagrams", () => {
    const { misprints: _m, diagrams: _d, ...older } = scheme([partA]);
    void _m;
    void _d;
    expect(readStoredTranscription(older)).toMatchObject({ misprints: [], diagrams: [], parts: [partA] });
    expect(readStoredTranscription(scheme([partA], { misprints: ["x"] }))?.misprints).toEqual(["x"]);
    expect(readStoredTranscription(null)).toBeNull();
    expect(readStoredTranscription({ parts: "no" })).toBeNull();
  });

  it("proposes the parts in paper order with the marks the checks settled on", () => {
    const t = scheme([
      { label: "(b)", marks: null, latex: "$q$ \\hfill A1" },
      { label: "(a)", marks: 2, latex: "$p$ \\hfill M1A1\n\\hfill [2 marks]" },
    ]);
    expect(proposalParts(t, [2, 1])).toEqual([
      { label: "(a)", marks: 2, latex: "$p$ \\hfill M1A1\n\\hfill [2 marks]" },
      { label: "(b)", marks: 1, latex: "$q$ \\hfill A1" },
    ]);
  });

  it("takes the teacher's marks and restates them, keeping the misprints but not the doubts", () => {
    const { scheme: s2, marks, problems } = schemeFromEdits(original, [
      { label: "(a)", marks: 2, latex: partA.latex },
      { label: "(b)", marks: 4, latex: `${partB.latex}` },
    ]);
    expect(problems).toEqual([]);
    expect(marks).toEqual([2, 4]);
    expect(s2.parts[1].latex.endsWith("\\hfill [4 marks]")).toBe(true);
    expect(s2.parts[1].latex).not.toMatch(/\[3 marks\]/);
    expect(s2.misprints).toEqual(["a doubled sign"]);
    expect(s2.unreadable).toEqual([]);
  });

  it("refuses what the bank cannot hold", () => {
    const { problems } = schemeFromEdits(original, [
      { label: "(a)", marks: 1.5, latex: "$\\frac{1}{$ \\hfill A1" },
      { label: "(a)", marks: 1, latex: "  " },
      { label: "", marks: 1, latex: "$x$ \\hfill A1" },
    ]);
    const text = problems.join(" | ");
    expect(text).toMatch(/appears twice/);
    expect(text).toMatch(/unlabelled part sits beside labelled ones/);
    expect(text).toMatch(/whole number/);
    expect(text).toMatch(/no scheme text/);
    expect(text).toMatch(/does not render/);
    expect(schemeFromEdits(original, []).problems).toEqual(["There are no parts to save."]);
  });

  it("lets a teacher accept a soft flag, never a blocking one", () => {
    const twoParts = normalizeTranscription(scheme([partA, partB], { totalMarks: 5 }));
    const soft = planPartChanges({ existing: [part({ content_latex: "Find $x$." })], scheme: twoParts, marks: [2, 3], inUse: null });
    expect(soft.actions).toEqual([]);
    expect(soft.blocking).toEqual([]);
    const accepted = planPartChanges({
      existing: [part({ content_latex: "Find $x$." })],
      scheme: twoParts,
      marks: [2, 3],
      inUse: null,
      acceptFlags: true,
    });
    expect(accepted.actions.map((a) => a.kind)).toEqual(["relabel", "insert"]);
    expect(accepted.resetImagePartIds).toBe(true);

    const locked = planPartChanges({
      existing: [part({ markscheme_latex: "kept \\hfill A1" })],
      scheme: twoParts,
      marks: [2, 3],
      inUse: null,
      acceptFlags: true,
    });
    expect(locked.actions).toEqual([]);
    expect(locked.blocking).toEqual(["The unlabelled part already has a scheme; it will not be split."]);

    const inUse = planPartChanges({
      existing: [part({ marks: 7 })],
      scheme: twoParts,
      marks: [2, 3],
      inUse: { labels: ["b"], maxMarks: {} },
      acceptFlags: true,
    });
    expect(inUse.actions).toEqual([]);
    expect(inUse.blocking).toEqual(inUse.flags);
  });

  it("decides an Accept: applies with the accepted flags on record, or says why not", () => {
    const edits = [
      { label: "(a)", marks: 2, latex: partA.latex },
      { label: "(b)", marks: 3, latex: partB.latex },
    ];
    const ok = decideAcceptance({ transcription: original, edits, existing: [part({ command_terms: ["Find"] })], inUse: null });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.plan.flags).toEqual([]);
      expect(ok.plan.acceptedFlags.join(" ")).toMatch(/command term/);
      expect(ok.plan.actions.map((a) => a.kind)).toEqual(["relabel", "insert"]);
    }

    expect(decideAcceptance({ transcription: original, edits: [{ label: "(a)", marks: -1, latex: "$x$" }], existing: [], inUse: null }))
      .toMatchObject({ ok: false, reason: "invalid" });
    expect(
      decideAcceptance({ transcription: original, edits, existing: [], inUse: { labels: ["a", "b"], maxMarks: {} }, inUseConflicts: ["Its tests disagree on (a): 2 vs 3 marks."] })
    ).toEqual({ ok: false, reason: "blocked", problems: ["Its tests disagree on (a): 2 vs 3 marks."] });
    expect(decideAcceptance({ transcription: original, edits, existing: [part({ marks: 5 })], inUse: { labels: ["b"], maxMarks: {} } }))
      .toMatchObject({ ok: false, reason: "blocked" });
    const done = ["a", "b"].map((l) => part({ id: l, part_label: l, marks: l === "a" ? 2 : 3, latex_verified: true }));
    expect(decideAcceptance({ transcription: original, edits, existing: done, inUse: null })).toMatchObject({ ok: false, reason: "nothing" });
  });
});

describe("realBankTotal", () => {
  it("treats the catalogue's one-mark placeholder as unknown", () => {
    expect(realBankTotal([])).toBeNull();
    expect(realBankTotal([part({ marks: 1 })])).toBeNull();
    expect(realBankTotal([part({ marks: 6 })])).toBe(6);
    expect(realBankTotal([part({ part_label: "a", marks: 1 }), part({ part_label: "b", marks: 1 })])).toBe(2);
  });
});
