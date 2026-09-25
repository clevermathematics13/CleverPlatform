import { describe, it, expect } from "vitest";
import { evaluate, formatTick, niceTicks, parseExpression, stepValues, traceCurve } from "./diagram-math";

function f(src: string): (x: number) => number {
  const parsed = parseExpression(src);
  if (!parsed.ok) throw new Error(parsed.error);
  return (x) => evaluate(parsed.expr, x);
}

describe("parseExpression", () => {
  it("follows the usual order of operations", () => {
    expect(f("2 + 3*x")(2)).toBe(8);
    expect(f("-x^2")(3)).toBe(-9);
    expect(f("2^3^2")(0)).toBe(512);
    expect(f("2^-1")(0)).toBe(0.5);
    expect(f("(x+1)/(x-2)")(3)).toBe(4);
  });

  it("reads juxtaposition as multiplication, as on paper", () => {
    expect(f("2x")(5)).toBe(10);
    expect(f("3(x + 1)")(1)).toBe(6);
    expect(f("(x + 1)(x - 2)")(3)).toBe(4);
    expect(f("2xsin(x)")(Math.PI / 2)).toBeCloseTo(Math.PI);
    expect(f("pi x")(2)).toBeCloseTo(2 * Math.PI);
  });

  it("knows the functions and constants a graph needs", () => {
    expect(f("sqrt(x)")(9)).toBe(3);
    expect(f("abs(x)")(-4)).toBe(4);
    expect(f("|x - 5|")(2)).toBe(3);
    expect(f("ln(e)")(0)).toBeCloseTo(1);
    expect(f("log(100)")(0)).toBeCloseTo(2);
    expect(f("e^x")(0)).toBe(1);
    expect(f("y = x^2 - 4")(3)).toBe(5);
    expect(f("f(x) = 2x")(3)).toBe(6);
  });

  it("applies an exponent after a bracketed function argument to the function", () => {
    expect(f("sin(x)^2 + cos(x)^2")(0.7)).toBeCloseTo(1);
    expect(f("sin x^2")(2)).toBeCloseTo(Math.sin(4));
  });

  it("refuses anything that is not arithmetic in x, instead of running it", () => {
    for (const bad of ["alert(1)", "x; fetch('/')", "window.location", "constructor", "y + 2", "2 +", "(x + 1", "x $ 2", ""]) {
      expect(parseExpression(bad).ok).toBe(false);
    }
  });
});

describe("niceTicks / formatTick", () => {
  it("steps in 1, 2 or 5 times a power of ten and includes zero", () => {
    expect(niceTicks(-5, 5, 10)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-0.3, 0.3, 6)).toContain(0);
    expect(niceTicks(5, 5)).toEqual([]);
  });

  it("prints a tick without float drift", () => {
    expect(formatTick(0.1 + 0.2)).toBe("0.3");
    expect(formatTick(-0)).toBe("0");
    expect(formatTick(1250)).toBe("1250");
  });
});

describe("traceCurve", () => {
  it("breaks the curve at an asymptote instead of joining across it", () => {
    const parsed = parseExpression("1/(x - 1)");
    if (!parsed.ok) throw new Error(parsed.error);
    const paths = traceCurve(parsed.expr, { xMin: -3, xMax: 3, yMin: -5, yMax: 5 });
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const path of paths) {
      const crosses = path.some((p) => p.x < 1) && path.some((p) => p.x > 1);
      expect(crosses).toBe(false);
    }
  });

  it("leaves out where the curve is undefined", () => {
    const parsed = parseExpression("sqrt(x)");
    if (!parsed.ok) throw new Error(parsed.error);
    const paths = traceCurve(parsed.expr, { xMin: -4, xMax: 4, yMin: -1, yMax: 3 });
    expect(paths).toHaveLength(1);
    expect(paths[0][0].x).toBeGreaterThanOrEqual(0);
  });
});

describe("stepValues", () => {
  it("lands exactly on zero and on each step", () => {
    expect(stepValues(-1, 1, 0.1)).toContain(0);
    expect(stepValues(-1, 1, 0.1)).toHaveLength(21);
    expect(stepValues(0, 10, 2.5)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(stepValues(3, 1, 1)).toEqual([]);
  });
});
