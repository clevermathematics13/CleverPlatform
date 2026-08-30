import { describe, expect, it } from "vitest";
import {
  countDecimalPlaces,
  countSignificantFigures,
  matchesRequiredPrecision,
  parseNumericValue,
  roundToDecimalPlaces,
  roundToSignificantFigures,
} from "./numerical-accuracy";

describe("parseNumericValue", () => {
  it("parses plain decimals and integers", () => {
    expect(parseNumericValue("8.52")).toBe(8.52);
    expect(parseNumericValue("-0.454")).toBe(-0.454);
    expect(parseNumericValue("8")).toBe(8);
  });

  it("parses simple a/b fractions", () => {
    expect(parseNumericValue("3/4")).toBe(0.75);
    expect(parseNumericValue("-1/2")).toBe(-0.5);
  });

  it("returns null for symbolic forms it can't evaluate", () => {
    expect(parseNumericValue("pi/4")).toBeNull();
    expect(parseNumericValue("sqrt(5)")).toBeNull();
    expect(parseNumericValue("")).toBeNull();
  });
});

describe("countSignificantFigures", () => {
  it("counts trailing zeros after a decimal point as significant", () => {
    expect(countSignificantFigures("6.60")).toBe(3);
    expect(countSignificantFigures("0.00660")).toBe(3);
  });

  it("does not count leading zeros", () => {
    expect(countSignificantFigures("0.0066048")).toBe(5);
  });

  it("counts a plain two-figure decimal correctly", () => {
    expect(countSignificantFigures("6.6")).toBe(2);
  });

  it("treats trailing zeros in a bare integer as ambiguous, not significant", () => {
    expect(countSignificantFigures("120")).toBe(2);
    expect(countSignificantFigures("100")).toBe(1);
  });

  it("counts zeros between non-zero digits as significant", () => {
    expect(countSignificantFigures("1.056")).toBe(4);
  });
});

describe("countDecimalPlaces", () => {
  it("counts digits after the decimal point, trailing zeros included", () => {
    expect(countDecimalPlaces("6.60")).toBe(2);
    expect(countDecimalPlaces("8")).toBe(0);
    expect(countDecimalPlaces("1.056")).toBe(3);
  });
});

describe("roundToSignificantFigures", () => {
  it("matches the policy's own worked examples", () => {
    expect(roundToSignificantFigures("1.23456", 3)).toBe("1.23");
    expect(roundToSignificantFigures("0.0066048", 3)).toBe("0.00660");
    expect(roundToSignificantFigures("16.513", 3)).toBe("16.5");
    expect(roundToSignificantFigures("6.596", 3)).toBe("6.60");
  });

  it("matches the Pedro Costa case: 0.805084 to 3 s.f. is 0.805, not 0.81", () => {
    expect(roundToSignificantFigures("0.805084", 3)).toBe("0.805");
  });

  it("handles carry that overflows into a new leading digit", () => {
    expect(roundToSignificantFigures("9.996", 3)).toBe("10.0");
  });

  it("handles negative values", () => {
    expect(roundToSignificantFigures("-0.454321", 3)).toBe("-0.454");
  });

  it("pads a short value out to the required figure count", () => {
    expect(roundToSignificantFigures("6.6", 3)).toBe("6.60");
  });
});

describe("roundToDecimalPlaces", () => {
  it("rounds and propagates carry into the integer part", () => {
    expect(roundToDecimalPlaces("1.995", 2)).toBe("2.00");
  });

  it("rounds to zero decimal places", () => {
    expect(roundToDecimalPlaces("4.6", 0)).toBe("5");
  });
});

describe("matchesRequiredPrecision", () => {
  // Case 1: default rule, correctly rounded value earns the mark.
  it("case 1: 1.23456... correctly rounded to 1.23 (3 s.f.) is accepted", () => {
    const result = matchesRequiredPrecision({
      reportedValue: "1.23",
      referenceValue: "1.23456",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(result.ok).toBe(true);
  });

  // Case 2: incorrect rounding.
  it("case 2: 1.24 (incorrectly rounded) is rejected", () => {
    const result = matchesRequiredPrecision({
      reportedValue: "1.24",
      referenceValue: "1.23456",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(result.ok).toBe(false);
  });

  // Case 3: too few significant figures.
  it("case 3: 1.2 (too few figures) is rejected", () => {
    const result = matchesRequiredPrecision({
      reportedValue: "1.2",
      referenceValue: "1.23456",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(result.ok).toBe(false);
  });

  // Case 4: excess non-exact precision is a presentation error under the strict default,
  // but accepted under this project's existing, more lenient excess-precision policy
  // (see MatchOptions.allowExcessPrecision doc comment) unless it fails to round correctly.
  it("case 4: excess precision (1.23456 given verbatim, 3 s.f. required) is a presentation error under the strict default", () => {
    const strict = matchesRequiredPrecision(
      { reportedValue: "1.23456", referenceValue: "1.23456", precisionType: "sf", precisionDigits: 3 },
      { allowExcessPrecision: false }
    );
    expect(strict.ok).toBe(false);

    const lenient = matchesRequiredPrecision({
      reportedValue: "1.23456",
      referenceValue: "1.23456",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(lenient.ok).toBe(true);
  });

  // Case 7: explicit accuracy instruction.
  it("case 7: explicit 4 s.f. -- 1.056 accepted, 1.06 rejected", () => {
    const accepted = matchesRequiredPrecision({
      reportedValue: "1.056",
      referenceValue: "1.056140",
      precisionType: "sf",
      precisionDigits: 4,
    });
    expect(accepted.ok).toBe(true);

    const rejected = matchesRequiredPrecision({
      reportedValue: "1.06",
      referenceValue: "1.056140",
      precisionType: "sf",
      precisionDigits: 4,
    });
    expect(rejected.ok).toBe(false);
  });

  // Case 8: trailing zero recognized as meaningful precision.
  it("case 8: 6.60 is recognized as three significant figures, not two", () => {
    expect(countSignificantFigures("6.60")).toBe(3);
    const result = matchesRequiredPrecision({
      reportedValue: "6.60",
      referenceValue: "6.596",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(result.ok).toBe(true);
  });

  it("does not penalize the exact real-world case: a = 0.805 required, student wrote 0.81 (2 s.f.)", () => {
    const result = matchesRequiredPrecision({
      reportedValue: "0.81",
      referenceValue: "0.805084",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/significant figure/i);
  });

  it("accepts more decimal places than required when they round to the correct answer (existing lenient policy)", () => {
    // The 8.515 vs 8.52 case: 0.805 * 7 + 2.88 = 8.515, which correctly rounds to 8.52 at 3 s.f.
    const result = matchesRequiredPrecision({
      reportedValue: "8.515",
      referenceValue: "8.51693",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(result.ok).toBe(true);
  });

  it("does not penalize an ambiguous bare-integer trailing zero that is numerically correct", () => {
    const result = matchesRequiredPrecision({
      reportedValue: "120",
      referenceValue: "120",
      precisionType: "sf",
      precisionDigits: 3,
    });
    expect(result.ok).toBe(true);
  });

  it("exact precision requires a matching value, not a rounded approximation", () => {
    const wrong = matchesRequiredPrecision({
      reportedValue: "0.6666667",
      referenceValue: "0.66666666666667",
      precisionType: "exact",
    });
    // 0.6666667 is not exactly equal to 2/3 -- a decimal approximation never
    // satisfies an "exact answer" requirement even if it looks close.
    expect(wrong.ok).toBe(false);

    const right = matchesRequiredPrecision({
      reportedValue: "8",
      referenceValue: "8",
      precisionType: "exact",
    });
    expect(right.ok).toBe(true);
  });

  it("defers (ok: true) rather than fails when a value can't be parsed deterministically", () => {
    const result = matchesRequiredPrecision({
      reportedValue: "pi/4",
      referenceValue: "0.7853981...",
      precisionType: "exact",
    });
    expect(result.ok).toBe(true);
  });
});
