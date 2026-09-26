/**
 * The arithmetic behind the diagrams in a worked explanation
 * (components/reflection/ExplanationDiagram.tsx): reading a curve's formula,
 * choosing axis ticks, and tracing a curve across a graph.
 *
 * A curve arrives as text written by the explanation generator, so it is
 * PARSED here, never evaluated as code. components/IbGraph.tsx turns its
 * formulas into a `new Function`, which is fine for a formula a teacher typed
 * and not for text a student's browser receives: anything this parser does
 * not recognise is an error, and nothing it builds can do more than
 * arithmetic on x.
 *
 * Pure and dependency-free: the server uses it to check an explanation
 * before storing it, the browser to draw it.
 */

export type Expr =
  | { t: "num"; v: number }
  | { t: "x" }
  | { t: "neg"; a: Expr }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { t: "fn"; name: FnName; a: Expr };

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  // IB "log" with no base is base 10.
  log: Math.log10,
  exp: Math.exp,
} as const;

type FnName = keyof typeof FUNCTIONS;

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { k: "("; }
  | { k: ")"; }
  | { k: "|"; };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`cannot read the number at "${src.slice(i, i + 8)}"`);
      tokens.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+/.exec(src.slice(i))!;
      tokens.push({ k: "id", v: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    if (c === "*" && src[i + 1] === "*") {
      tokens.push({ k: "op", v: "^" });
      i += 2;
      continue;
    }
    if ("+-*/^".includes(c)) {
      tokens.push({ k: "op", v: c as "+" | "-" | "*" | "/" | "^" });
      i += 1;
      continue;
    }
    if (c === "−") {
      // A typeset minus sign reads as a minus.
      tokens.push({ k: "op", v: "-" });
      i += 1;
      continue;
    }
    if (c === "(" || c === "[") {
      tokens.push({ k: "(" });
      i += 1;
      continue;
    }
    if (c === ")" || c === "]") {
      tokens.push({ k: ")" });
      i += 1;
      continue;
    }
    if (c === "|") {
      tokens.push({ k: "|" });
      i += 1;
      continue;
    }
    throw new Error(`unexpected "${c}"`);
  }
  return tokens;
}

/**
 * Splits a run of letters into the names this parser knows, longest first,
 * so "2xsin" or "pix" read the way a mathematician means them. A run that
 * cannot be split entirely into known names is an error, never a guess.
 */
function splitIdentifier(run: string): string[] | null {
  if (run === "") return [];
  const names = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS), "x"].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (run.startsWith(name)) {
      const rest = splitIdentifier(run.slice(name.length));
      if (rest) return [name, ...rest];
    }
  }
  return null;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const e = this.expr();
    if (this.pos < this.tokens.length) throw new Error("unexpected text after the formula");
    return e;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(): Expr {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.k === "op" && (t.v === "+" || t.v === "-")) {
        this.pos += 1;
        left = { t: "bin", op: t.v, a: left, b: this.term() };
      } else {
        return left;
      }
    }
  }

  private term(): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.k === "op" && (t.v === "*" || t.v === "/")) {
        this.pos += 1;
        left = { t: "bin", op: t.v, a: left, b: this.unary() };
      } else if (t && (t.k === "num" || t.k === "id" || t.k === "(")) {
        // Juxtaposition is multiplication: 2x, 3(x + 1), (x + 1)(x - 2).
        left = { t: "bin", op: "*", a: left, b: this.power() };
      } else {
        return left;
      }
    }
  }

  private unary(): Expr {
    const t = this.peek();
    if (t?.k === "op" && (t.v === "-" || t.v === "+")) {
      this.pos += 1;
      const a = this.unary();
      return t.v === "-" ? { t: "neg", a } : a;
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.atom();
    const t = this.peek();
    if (t?.k === "op" && t.v === "^") {
      this.pos += 1;
      // Right-associative, and an exponent may carry its own sign: 2^-x.
      return { t: "bin", op: "^", a: base, b: this.unary() };
    }
    return base;
  }

  private atom(): Expr {
    const t = this.peek();
    if (!t) throw new Error("the formula ends too soon");
    if (t.k === "num") {
      this.pos += 1;
      return { t: "num", v: t.v };
    }
    if (t.k === "(") {
      this.pos += 1;
      const e = this.expr();
      if (this.peek()?.k !== ")") throw new Error("a bracket is not closed");
      this.pos += 1;
      return e;
    }
    if (t.k === "|") {
      this.pos += 1;
      const e = this.expr();
      if (this.peek()?.k !== "|") throw new Error("an absolute-value bar is not closed");
      this.pos += 1;
      return { t: "fn", name: "abs", a: e };
    }
    if (t.k === "id") {
      const names = splitIdentifier(t.v);
      if (!names || names.length === 0) throw new Error(`unknown name "${t.v}"`);
      this.pos += 1;
      // Put the split names back as individual tokens: "2xsin(x)" reads as
      // 2 * x * sin(x).
      this.tokens.splice(this.pos, 0, ...names.slice(1).map((v) => ({ k: "id" as const, v })));
      return this.named(names[0]);
    }
    throw new Error("a value is missing");
  }

  private named(name: string): Expr {
    if (name === "x") return { t: "x" };
    if (name in CONSTANTS) return { t: "num", v: CONSTANTS[name] };
    const fn = name as FnName;
    // sin(x)^2 is (sin x)^2: the bracketed argument is taken on its own and
    // power() applies the exponent to the function. Without a bracket,
    // sin x^2 is sin(x^2), as on paper.
    if (this.peek()?.k === "(") return { t: "fn", name: fn, a: this.atom() };
    return { t: "fn", name: fn, a: this.power() };
  }
}

/** Parses a curve's formula in x, e.g. "x^2 - 4", "2sin(x) + 1", "(x+1)/(x-2)". */
export function parseExpression(src: string): { ok: true; expr: Expr } | { ok: false; error: string } {
  const source = src.trim().replace(/^y\s*=\s*/i, "").replace(/^f\s*\(\s*x\s*\)\s*=\s*/i, "");
  if (source === "") return { ok: false, error: "the formula is empty" };
  if (source.length > 200) return { ok: false, error: "the formula is too long" };
  try {
    return { ok: true, expr: new Parser(tokenize(source)).parse() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function evaluate(expr: Expr, x: number): number {
  switch (expr.t) {
    case "num":
      return expr.v;
    case "x":
      return x;
    case "neg":
      return -evaluate(expr.a, x);
    case "fn":
      return FUNCTIONS[expr.name](evaluate(expr.a, x));
    case "bin": {
      const a = evaluate(expr.a, x);
      const b = evaluate(expr.b, x);
      switch (expr.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return Math.pow(a, b);
      }
    }
  }
}

/**
 * Tick values for an axis from `min` to `max`: steps of 1, 2 or 5 times a
 * power of ten, about `target` of them, always including 0 when it is in
 * range so the axes cross at a labelled point.
 */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const raw = (max - min) / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  // Each tick is a whole number of steps, rounded to the step's own decimal
  // places: adding 0.1 again and again drifts, and "0" would come out as
  // 2.8e-17.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last && ticks.length <= 50; k++) {
    const v = Number((k * step).toFixed(decimals));
    ticks.push(v === 0 ? 0 : v);
  }
  return ticks;
}

/** A number as a short label: 2, -0.5, 1.25 -- never 0.30000000000000004. */
export function formatTick(v: number): string {
  if (Object.is(v, -0)) return "0";
  return String(Number(v.toPrecision(6)));
}

/**
 * A curve traced across [xMin, xMax] as polylines in graph coordinates,
 * broken wherever it leaves the finite numbers or jumps across the view (an
 * asymptote), so no line is ever drawn through a gap in the curve.
 */
export function traceCurve(
  expr: Expr,
  view: { xMin: number; xMax: number; yMin: number; yMax: number },
  samples = 400,
): { x: number; y: number }[][] {
  const paths: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  const height = view.yMax - view.yMin;
  const margin = height * 4;
  let previousY: number | null = null;
  for (let i = 0; i <= samples; i++) {
    const x = view.xMin + ((view.xMax - view.xMin) * i) / samples;
    const y = evaluate(expr, x);
    const usable = Number.isFinite(y) && y > view.yMin - margin && y < view.yMax + margin;
    const jump = previousY !== null && usable && Math.abs(y - previousY) > height * 2;
    if (!usable || jump) {
      if (current.length > 1) paths.push(current);
      current = [];
    }
    if (usable) current.push({ x, y });
    previousY = usable ? y : null;
  }
  if (current.length > 1) paths.push(current);
  return paths;
}

function decimalPlaces(n: number): number {
  const s = String(n);
  if (s.includes("e")) return 6;
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : Math.min(6, s.length - dot - 1);
}

/**
 * The values from `min` to `max` in steps of `step` -- a number line's tick
 * marks -- each rounded to the precision the numbers were given in, so
 * -1 + 10 * 0.1 is 0 and not 1.1e-16. At most 201 values.
 */
export function stepValues(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !(max >= min)) return [];
  const count = Math.min(200, Math.round((max - min) / step));
  const decimals = Math.max(decimalPlaces(min), decimalPlaces(step));
  return Array.from({ length: count + 1 }, (_, k) => {
    const v = Number((min + k * step).toFixed(decimals));
    return v === 0 ? 0 : v;
  });
}
