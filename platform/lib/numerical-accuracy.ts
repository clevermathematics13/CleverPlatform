/**
 * Deterministic numerical-accuracy checking for AI grading.
 *
 * The grading model is instructed (see grading_policies/
 * ibdp_math_aa_hl_paper_2_numerical_accuracy.md) to report, for each final
 * numeric accuracy mark, the value it read, the correct reference value, and
 * the precision required. This module re-derives the correct rounding in
 * plain code and compares it against what the model reported -- so an
 * accuracy call does not depend solely on the model correctly applying its
 * own instructions. Production evidence (the same test, graded five times)
 * showed the model repeatedly rationalizing a real precision mismatch as
 * "acceptable rounding" even after being told not to; a prompt instruction
 * alone was not sufficient enforcement.
 *
 * Pure functions only -- no I/O, no model calls. See ai-grading.ts for how
 * this plugs into validateGradeResponse.
 *
 * Deliberately string-based rather than parsing straight to a JS `number`
 * for rounding: a plain float multiply-and-round approach can misround
 * exact boundary cases (e.g. 1.005) because of binary floating-point
 * representation error, which is exactly the kind of artifact the policy
 * says to avoid.
 */

export type PrecisionType = "exact" | "sf" | "dp";

export interface NumericCheck {
  /** The exact final numeric value the student wrote, as plain text (e.g. "8.52", not "8.52 mins"). */
  reportedValue: string;
  /** The correct value at full precision, as plain text. */
  referenceValue: string;
  /** "exact" (no decimal approximation allowed), "sf" (significant figures), or "dp" (decimal places). */
  precisionType: PrecisionType;
  /** Required significant figures or decimal places. Omitted/ignored for "exact". */
  precisionDigits?: number;
}

export interface NumericCheckResult {
  ok: boolean;
  reason: string;
}

export interface MatchOptions {
  /**
   * Whether reporting MORE digits than required, which still rounds to the
   * correct value at the required precision, is accepted (true) or treated
   * as its own accuracy error under the strict Paper 2 default (false).
   * Defaults to true: this project's existing grading policy (see Rule 6 in
   * GRADING_SYSTEM_PROMPT) already treats correctly-rounding excess
   * precision as acceptable -- exactly the "existing project configuration
   * deliberately uses a more lenient excess-precision policy" exception the
   * numerical-accuracy policy document itself carves out in section 5.
   */
  allowExcessPrecision?: boolean;
}

/** Parses a plain decimal string or simple "a/b" fraction into a number. Returns null for anything else (symbolic forms like "pi/4" or "sqrt(5)" are not evaluated here). */
export function parseNumericValue(text: string): number | null {
  const s = text.trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
  const fraction = s.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator !== 0) return Number(fraction[1]) / denominator;
  }
  return null;
}

/**
 * Significant figures in a plain decimal string, per standard convention:
 * leading zeros are never significant; zeros between non-zero digits are
 * always significant; trailing zeros after a decimal point are significant;
 * trailing zeros in a bare integer (no decimal point) are ambiguous and are
 * NOT counted, matching this policy's instruction not to penalize an answer
 * like "120" solely for that ambiguity.
 */
export function countSignificantFigures(raw: string): number {
  const s = raw.trim().replace(/^[+-]/, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return 0;
  const hasDecimalPoint = s.includes(".");
  const [intPart, fracPart = ""] = s.split(".");
  const digits = intPart + fracPart;
  const firstSig = digits.search(/[1-9]/);
  if (firstSig === -1) return digits.length > 0 ? 1 : 0;
  let sig = digits.slice(firstSig);
  if (!hasDecimalPoint) sig = sig.replace(/0+$/, "") || "0";
  return sig.length;
}

/** Decimal places in a plain decimal string. Trailing zeros count -- they're significant here, unlike in countSignificantFigures' bare-integer case. */
export function countDecimalPlaces(raw: string): number {
  const s = raw.trim().replace(/^[+-]/, "");
  const dotIdx = s.indexOf(".");
  return dotIdx === -1 ? 0 : s.length - dotIdx - 1;
}

/** Increments a digit string by 1, propagating carry. "659" -> "660", "999" -> "1000" (grows by one digit on full carry-out). */
function incrementDigitString(digits: string): string {
  const arr = digits.split("");
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === "9") {
      arr[i] = "0";
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      return arr.join("");
    }
  }
  return "1" + arr.join("");
}

/** Rounds a plain decimal string to `sf` significant figures, returning a canonical string (preserving meaningful trailing zeros, e.g. "6.60" not "6.6"). */
export function roundToSignificantFigures(rawValue: string, sf: number): string {
  const trimmed = rawValue.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [intPartRaw, fracPartRaw = ""] = unsigned.split(".");
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  let digits = intPart + fracPartRaw;
  let pointPos = intPart.length;

  const firstSig = digits.search(/[1-9]/);
  if (firstSig === -1) return negative ? "-0" : "0";

  while (digits.length < firstSig + sf + 1) digits += "0";

  let kept = digits.slice(0, firstSig + sf);
  const roundingDigit = digits[firstSig + sf];
  if (Number(roundingDigit) >= 5) {
    const incremented = incrementDigitString(kept);
    if (incremented.length > kept.length) {
      // Carry overflowed past the leading digit (e.g. "999" -> "1000"):
      // same number of significant figures, decimal point shifts right one.
      kept = incremented.slice(0, kept.length);
      pointPos += 1;
    } else {
      kept = incremented;
    }
  }

  let intOut: string;
  let fracOut: string;
  if (pointPos >= kept.length) {
    intOut = kept.padEnd(pointPos, "0");
    fracOut = "";
  } else {
    intOut = kept.slice(0, pointPos) || "0";
    fracOut = kept.slice(pointPos);
  }
  const result = fracOut.length > 0 ? `${intOut}.${fracOut}` : intOut;
  return negative ? `-${result}` : result;
}

/** Rounds a plain decimal string to `dp` decimal places, returning a canonical string. */
export function roundToDecimalPlaces(rawValue: string, dp: number): string {
  const trimmed = rawValue.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [intPartRaw, fracPartRaw = ""] = unsigned.split(".");
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  let frac = fracPartRaw;
  while (frac.length < dp + 1) frac += "0";

  const keptFrac = frac.slice(0, dp);
  const roundingDigit = frac[dp];
  let intOut = intPart;
  let fracOut = keptFrac;

  if (Number(roundingDigit) >= 5) {
    if (dp === 0) {
      intOut = incrementDigitString(intPart);
    } else {
      const incremented = incrementDigitString(keptFrac);
      if (incremented.length > keptFrac.length) {
        fracOut = incremented.slice(1);
        intOut = incrementDigitString(intPart);
      } else {
        fracOut = incremented;
      }
    }
  }

  const result = dp > 0 ? `${intOut}.${fracOut}` : intOut;
  return negative ? `-${result}` : result;
}

/**
 * Deterministically checks whether `check.reportedValue` earns its accuracy
 * mark against `check.referenceValue` at the required precision. Returns
 * `ok: true` (never blocks) when either value can't be parsed as a plain
 * number -- symbolic exact forms (fractions written with words, radicals,
 * "pi/4", etc.) are outside what this function can verify, so those defer
 * to the model's own judgement rather than being incorrectly failed.
 */
export function matchesRequiredPrecision(
  check: NumericCheck,
  options: MatchOptions = {}
): NumericCheckResult {
  const { allowExcessPrecision = true } = options;
  const reportedNum = parseNumericValue(check.reportedValue);
  const referenceNum = parseNumericValue(check.referenceValue);

  if (reportedNum === null || referenceNum === null) {
    return {
      ok: true,
      reason:
        "could not parse a plain numeric value to verify deterministically -- deferring to the model's own judgement",
    };
  }

  if (check.precisionType === "exact") {
    const tolerance = Math.max(1e-9, Math.abs(referenceNum) * 1e-9);
    const matches = Math.abs(reportedNum - referenceNum) <= tolerance;
    return matches
      ? { ok: true, reason: "matches the required exact value" }
      : {
          ok: false,
          reason: `"${check.reportedValue}" does not match the required exact value ${check.referenceValue}`,
        };
  }

  const digits = check.precisionDigits ?? 3;
  const isSf = check.precisionType === "sf";
  const roundFn = isSf ? roundToSignificantFigures : roundToDecimalPlaces;
  const requiredRounded = roundFn(check.referenceValue, digits);
  const unit = isSf ? "significant figure(s)" : "decimal place(s)";

  // A bare integer numerically equal to the correct rounded value is never
  // wrong just because its trailing zeros look ambiguous (policy section 6).
  if (!check.reportedValue.includes(".") && Number(check.reportedValue) === Number(requiredRounded)) {
    return { ok: true, reason: "matches the required rounded value (trailing zeros in a whole number are not penalized)" };
  }

  const reportedRounded = roundFn(check.reportedValue, digits);
  if (reportedRounded !== requiredRounded) {
    return {
      ok: false,
      reason: `"${check.reportedValue}" rounds to ${reportedRounded} at ${digits} ${unit}, not the required ${requiredRounded}`,
    };
  }

  const reportedPrecisionCount = isSf
    ? countSignificantFigures(check.reportedValue)
    : countDecimalPlaces(check.reportedValue);

  if (reportedPrecisionCount < digits) {
    return {
      ok: false,
      reason: `"${check.reportedValue}" has only ${reportedPrecisionCount} ${unit}; ${digits} are required`,
    };
  }
  if (!allowExcessPrecision && reportedPrecisionCount > digits) {
    return {
      ok: false,
      reason: `"${check.reportedValue}" has ${reportedPrecisionCount} ${unit}; exactly ${digits} were required and excess precision is not accepted under the strict default`,
    };
  }

  return { ok: true, reason: `matches the required value at ${digits} ${unit}` };
}
