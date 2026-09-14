import { describe, it, expect } from "vitest";
import {
  buildExamConditionsHtml,
  formatTimeAllowed,
  calculatorPolicyLabel,
  marksLabel,
  CALCULATOR_POLICY_OPTIONS,
} from "./exam-conditions";

describe("formatTimeAllowed", () => {
  it("says minutes under an hour", () => {
    expect(formatTimeAllowed(50)).toBe("50 minutes");
    expect(formatTimeAllowed(1)).toBe("1 minute");
  });

  it("says hours the way a timetable does", () => {
    // "75 minutes" makes a student do arithmetic before they have started.
    expect(formatTimeAllowed(60)).toBe("1 hour");
    expect(formatTimeAllowed(75)).toBe("1 hour 15 minutes");
    expect(formatTimeAllowed(120)).toBe("2 hours");
  });

  it("is empty for a nonsense duration rather than printing one", () => {
    expect(formatTimeAllowed(0)).toBe("");
    expect(formatTimeAllowed(-30)).toBe("");
    expect(formatTimeAllowed(Number.NaN)).toBe("");
  });
});

describe("marksLabel", () => {
  it("is singular for one and plural for everything else", () => {
    // Found by exporting a one-question draft through the real UI: the cover
    // read "Total: 1 marks", one line above a section banner saying the same.
    expect(marksLabel(1)).toBe("1 mark");
    expect(marksLabel(0)).toBe("0 marks");
    expect(marksLabel(2)).toBe("2 marks");
    expect(marksLabel(50)).toBe("50 marks");
  });
});

describe("buildExamConditionsHtml", () => {
  it("renders nothing at all when no condition is set", () => {
    // The whole-fleet guarantee: every NA packet, every generic sandbox
    // document and every existing formative sets none of these, and their
    // covers must come out byte-identical to before this block existed.
    expect(buildExamConditionsHtml({}, 50)).toBe("");
    expect(buildExamConditionsHtml({ academicHonestyLine: "   " }, 50)).toBe("");
  });

  it("prints the calculator policy in the agreed wording", () => {
    const html = buildExamConditionsHtml({ calculatorPolicy: "graphing" }, 50);
    expect(html).toContain("Calculator:");
    expect(html).toContain("Graphing calculator permitted");
  });

  it("prints time allowed and the total the caller counted", () => {
    const html = buildExamConditionsHtml({ timeAllowedMinutes: 50, showTotalMarks: true }, 47);
    expect(html).toContain("Time allowed:");
    expect(html).toContain("50 minutes");
    expect(html).toContain("47 marks");
  });

  it("says '1 mark', not '1 marks'", () => {
    const html = buildExamConditionsHtml({ showTotalMarks: true }, 1);
    expect(html).toContain("1 mark<");
    expect(html).not.toContain("1 marks");
  });

  it("prints a zero total rather than hiding it", () => {
    // A paper that totals zero is a mistake worth seeing on the cover.
    expect(buildExamConditionsHtml({ showTotalMarks: true }, 0)).toContain("0 marks");
  });

  it("escapes the honesty line", () => {
    const html = buildExamConditionsHtml({ academicHonestyLine: "<script>x</script>" }, 10);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops a time that does not format, without dropping the rest", () => {
    const html = buildExamConditionsHtml(
      { timeAllowedMinutes: 0, calculatorPolicy: "not-permitted" },
      12,
    );
    expect(html).not.toContain("Time allowed:");
    expect(html).toContain("No calculator permitted");
  });
});

describe("CALCULATOR_POLICY_OPTIONS", () => {
  it("offers every policy, each with the label that prints", () => {
    expect(CALCULATOR_POLICY_OPTIONS.map((o) => o.value)).toEqual([
      "not-permitted",
      "basic",
      "graphing",
      "graphing-required",
    ]);
    for (const option of CALCULATOR_POLICY_OPTIONS) {
      // A dropdown that says one thing and a cover that prints another is how
      // a student ends up told the wrong rule.
      expect(option.label).toBe(calculatorPolicyLabel(option.value));
    }
  });
});
