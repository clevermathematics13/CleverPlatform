/**
 * latex-to-typst.ts
 * -----------------------------------------------------------------------------
 * Turns the LaTeX a Nuanced Analysis packet is authored in into the Typst math
 * the PDF compiler evaluates.
 *
 * WHY THIS EXISTS, and why the packets are authored in LaTeX at all:
 *
 * A packet's mathematics has to be right in TWO places that speak different
 * languages. The on-screen preview (and every other React surface in this
 * codebase -- the marking screens, the question bank, the student feedback)
 * renders with KaTeX, which speaks LaTeX and nothing else. The printed PDF is
 * compiled by Typst, which speaks its own math syntax and does not know what
 * a backslash is.
 *
 * The packets used to be authored in Typst syntax, because that is what the
 * PDF needed. The PDF was therefore beautiful and the preview was not: KaTeX
 * rendered "$cos((3pi)/2)$" as an italic c times o times s applied to a
 * slash-divided p times i, which is not a cosine of three pi over two, and a
 * teacher checking the packet on screen was reading something the student
 * would never see. Worse, Typst syntax is the narrower of the two languages:
 * there is no \left...\right sizing to ask for, no \operatorname, no
 * \displaystyle, and no pmatrix.
 *
 * So the direction is now LaTeX in, Typst out:
 *
 *   generator  ->  LaTeX in $...$  ->  KaTeX renders the preview, verbatim
 *                                  ->  latexToTypst() -> Typst renders the PDF
 *
 * LaTeX is the source of truth because it is the richer language, it is what
 * the rest of the platform already stores (see the LaTeX conventions in
 * platform/AGENTS.md), and it is the one the preview can render without any
 * translation at all. Typst is a rendering target, reached by this module.
 *
 * WHAT MAKES THE TRANSLATION NON-TRIVIAL, and why a regex pass will not do:
 *
 *  1. Typst math reads a multi-letter run as a VARIABLE LOOKUP. LaTeX "ab"
 *     means a times b; Typst "ab" means "the variable named ab", which does
 *     not exist, and because Typst has no try/catch an unknown variable does
 *     not degrade -- it aborts the entire document. Every letter run that
 *     came from LaTeX source must therefore be emitted letter by letter.
 *  2. Arguments are positional and brace-delimited in LaTeX and parenthesised
 *     function calls in Typst: \frac{a}{b} is frac(a, b), and a stray space
 *     between the name and the bracket ("frac (a, b)") silently stops being a
 *     call and starts being a juxtaposed product. Only a real parse gets this
 *     right; \frac{\frac{1}{2}}{3} has to nest.
 *  3. A LaTeX brace group is invisible grouping, but a Typst paren is a
 *     printed bracket everywhere except in a function argument or an
 *     attachment. "{a+b}^2" therefore cannot become "(a+b)^2" -- it becomes
 *     attach(a + b, t: 2), which prints no brackets.
 *
 * THE OUTPUT CONTRACT, which the compile test enforces against the real
 * compiler: every string this module returns is valid Typst math that
 * evaluates without error. It reaches that by only ever emitting identifiers
 * from the tables below -- each one probed against the shipped compiler --
 * and by building its own brackets, so an unbalanced or unknown input
 * degrades to visible text rather than to a document that will not print.
 * -----------------------------------------------------------------------------
 */

/**
 * The delimiter that marks a span of ALREADY-CONVERTED, trusted Typst math
 * inside an otherwise ordinary prose string.
 *
 * U+0001 is used rather than a printable sentinel because it cannot collide
 * with packet content: it survives JSON transport, it is not a character any
 * generator emits, and if it ever did escape to a page it is unprintable
 * rather than misleading.
 *
 * WHY A SECOND DELIMITER AT ALL, when $...$ already exists: rich() in
 * typst-render.service.ts refuses to evaluate a $...$ segment unless every
 * multi-letter run in it is an identifier Typst defines. That gate is what
 * stops "Pencils cost $2.50 per package and pens cost $3" from being read as
 * math and taking down the compile, and it must stay. But it is a guess, and
 * this module does not need to be guessed at -- its output is Typst it built
 * itself. Marking those spans lets rich() evaluate them directly, which is
 * also the only way constructs like mat(delim: "[", ...) can ever be emitted:
 * "delim" is not a math identifier and the gate would reject it.
 */
export const TRUSTED_MATH_DELIM = "\u0001";

/**
 * A dollar SIGN, as opposed to a math delimiter: backslash then dollar.
 *
 * Packet prose prices things -- A.1 is set at a ticket window -- and a lone
 * amount used to leave an odd number of "$" in the line, which made both
 * typesetMath() and the Typst prelude hand the whole line back untouched.
 * escapeCurrencyDollars() in math-typesetting.ts decides which "$" is which
 * and writes this escape over the ones that are currency; rich-legacy() in
 * the Typst template reads it back as a dollar sign.
 *
 * Every function that splits a string on "$" has to mask this first, or the
 * dollar inside it re-enters the pairing it was just taken out of -- and
 * here that is worse than a miscount, because the escape carries a
 * BACKSLASH, which is the whole of isLatexMath()'s test. "cost \$2.50 per
 * package and pens cost \$3" split into a span ending in a backslash, was
 * read as LaTeX on the strength of it, and printed the prose between two
 * prices as italic mathematics.
 */
export const ESCAPED_DOLLAR = `${String.fromCharCode(92)}$`;

/** Stands in for ESCAPED_DOLLAR while a "$" split is in progress. */
export const CURRENCY_MASK = String.fromCharCode(2);

/** Hides escaped dollars so a "$" split sees only real delimiters. */
export function maskCurrency(text: string): string {
  return text.split(ESCAPED_DOLLAR).join(CURRENCY_MASK);
}

/** Puts them back. */
export function unmaskCurrency(text: string): string {
  return text.split(CURRENCY_MASK).join(ESCAPED_DOLLAR);
}

/**
 * Commands that style PROSE rather than mathematics, and so never reach the
 * math converter: they sit outside $...$, wrapping ordinary text that may
 * itself contain math spans.
 */
const PROSE_TEXT_COMMANDS = ["textit", "textbf", "textrm", "textsf", "texttt", "emph", "underline"];

/**
 * Unwraps a prose-level styling command, keeping everything inside it.
 *
 * The binomial packet quotes a flawed student solution as
 * \textit{'$(4+x)^{1/2} = ...$, valid for $|x|<1$.'} -- prose markup around
 * a passage that contains its own math spans. Nothing in this pipeline knew
 * the command: it is not math, so the converter never saw it, and the Typst
 * template interpolates a prose string without re-parsing markup. So
 * "\textit{" and its closing brace printed on the page as themselves.
 *
 * The emphasis is dropped rather than translated. Carrying it through would
 * mean emitting Typst markup into a string the template deliberately does
 * NOT re-parse -- the guarantee that stops packet prose being read as
 * source -- and the text here is already quoted, so the italics were
 * decorative. Losing a font and keeping the sentence is the right trade;
 * printing the command name is not a trade at all.
 */
export function unwrapProseTextCommands(text: string): string {
  if (!text.includes(BACKSLASH_CHAR)) return text;
  let out = text;
  for (const name of PROSE_TEXT_COMMANDS) {
    const opener = `${BACKSLASH_CHAR}${name}{`;
    for (;;) {
      const at = out.indexOf(opener);
      if (at === -1) break;
      // Walk to the brace that closes this one, so a nested group inside the
      // passage does not end it early.
      let depth = 0;
      let end = -1;
      for (let i = at + opener.length - 1; i < out.length; i += 1) {
        if (out[i] === "{") depth += 1;
        else if (out[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      // Unbalanced: leave it exactly as written rather than swallowing the
      // rest of the string.
      if (end === -1) break;
      out = out.slice(0, at) + out.slice(at + opener.length, end) + out.slice(end + 1);
    }
  }
  return out;
}

/** One backslash, kept out of the string literals that need one. */
const BACKSLASH_CHAR = String.fromCharCode(92);

// -- Tokenizer -----------------------------------------------------------------

type Tok =
  /** A control word (\frac) or control symbol (\,), without the backslash. */
  | { t: "cmd"; v: string }
  /** A run of digits, optionally with a decimal point. */
  | { t: "num"; v: string }
  /** Any other single character. */
  | { t: "ch"; v: string }
  | { t: "lb" }
  | { t: "rb" }
  | { t: "sup" }
  | { t: "sub" }
  | { t: "amp" }
  /** \\ -- a row break inside an environment, a line break outside one. */
  | { t: "row" }
  /** Preserved because \text{...} needs the original spacing back. */
  | { t: "sp" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "\\") {
        out.push({ t: "row" });
        i += 2;
        continue;
      }
      const word = /^[A-Za-z]+/.exec(src.slice(i + 1));
      if (word) {
        out.push({ t: "cmd", v: word[0] });
        i += 1 + word[0].length;
        // LaTeX ends a control word at the first non-letter and swallows the
        // spaces after it -- "\alpha x" is alpha times x, not "alpha x " with
        // a literal gap. Dropping them here keeps \text{} from reading one.
        while (src[i] === " ") i += 1;
        continue;
      }
      const sym = src[i + 1];
      if (sym === undefined) {
        // A trailing lone backslash. Nothing to escape; drop it rather than
        // emit a command with an empty name.
        i += 1;
        continue;
      }
      out.push({ t: "cmd", v: sym });
      i += 2;
      continue;
    }
    if (c === "{") { out.push({ t: "lb" }); i += 1; continue; }
    if (c === "}") { out.push({ t: "rb" }); i += 1; continue; }
    if (c === "^") { out.push({ t: "sup" }); i += 1; continue; }
    if (c === "_") { out.push({ t: "sub" }); i += 1; continue; }
    if (c === "&") { out.push({ t: "amp" }); i += 1; continue; }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      out.push({ t: "sp" });
      i += 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      // Only "." joins digits into one number. A comma must stay its own
      // token: "f(1,2)" is a pair, and swallowing the comma would lose the
      // spacing Typst puts after it.
      const num = /^[0-9]+(?:\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    // Multi-character relations that Typst has a single glyph for. Emitted
    // as one token so the emitter cannot put a space through the middle of
    // them: ":=" is the definitional symbol this course is built on
    // ("$a - b := a + (-b)$" is A.2's central definition), and Typst renders
    // ":=" as the ligature but ": =" as a colon beside an equals sign.
    const pair = src.slice(i, i + 2);
    if (RELATION_PAIRS.has(pair)) {
      out.push({ t: "ch", v: pair });
      i += 2;
      continue;
    }

    out.push({ t: "ch", v: c });
    i += 1;
  }
  return out;
}

/** Two-character relations Typst sets as one glyph. */
const RELATION_PAIRS = new Set([":=", "=:", "<=", ">=", "!=", "::", "..."]);

// -- Symbol tables -------------------------------------------------------------
//
// Every Typst name below was probed against @myriaddreamin/typst-ts-node-compiler
// (the shipped compiler) by evaluating it in math mode. An entry Typst does not
// define would not degrade -- it would abort the whole document.

/** Commands that stand alone and map to one Typst atom. */
const SYMBOLS: Record<string, string> = {
  // ---- Greek, lower case ----
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta",
  epsilon: "epsilon.alt", varepsilon: "epsilon", zeta: "zeta", eta: "eta",
  theta: "theta", vartheta: "theta.alt", iota: "iota", kappa: "kappa",
  varkappa: "kappa.alt", lambda: "lambda", mu: "mu", nu: "nu", xi: "xi",
  omicron: "omicron", pi: "pi", varpi: "pi.alt", rho: "rho",
  varrho: "rho.alt", sigma: "sigma", varsigma: "sigma.alt", tau: "tau",
  upsilon: "upsilon", phi: "phi.alt", varphi: "phi", chi: "chi", psi: "psi",
  omega: "omega",
  // ---- Greek, upper case ----
  Gamma: "Gamma", Delta: "Delta", Theta: "Theta", Lambda: "Lambda", Xi: "Xi",
  Pi: "Pi", Sigma: "Sigma", Upsilon: "Upsilon", Phi: "Phi", Psi: "Psi",
  Omega: "Omega",

  // ---- Number sets written as a bare command ----
  reals: "RR", naturals: "NN", integers: "ZZ", rationals: "QQ",
  complexes: "CC",

  // ---- Binary operators ----
  times: "times", div: "div", cdot: "dot.op", ast: "*", star: "star",
  circ: "compose", bullet: "dot.circle", pm: "plus.minus", mp: "minus.plus",
  oplus: "plus.circle", ominus: "minus.circle", otimes: "times.circle",
  oslash: "div.circle", odot: "dot.circle", cup: "union", cap: "sect",
  bigcup: "union.big", bigcap: "sect.big", sqcup: "union.sq",
  sqcap: "sect.sq", setminus: "without", smallsetminus: "without",
  wedge: "and", vee: "or", land: "and", lor: "or", neg: "not", lnot: "not",
  amalg: "product.co", uplus: "union.plus",
  bigoplus: "plus.circle.big", bigotimes: "times.circle.big",

  // ---- Relations ----
  leq: "lt.eq", le: "lt.eq", geq: "gt.eq", ge: "gt.eq", neq: "eq.not",
  ne: "eq.not", equiv: "equiv", approx: "approx", approxeq: "approx.eq",
  cong: "tilde.equiv", simeq: "tilde.eq", sim: "tilde.op", propto: "prop",
  ll: "lt.double", gg: "gt.double", leqslant: "lt.eq.slant",
  geqslant: "gt.eq.slant", prec: "prec", succ: "succ", preceq: "prec.eq",
  succeq: "succ.eq", subset: "subset", supset: "supset",
  subseteq: "subset.eq", supseteq: "supset.eq", subsetneq: "subset.neq",
  supsetneq: "supset.neq", nsubseteq: "subset.eq.not", in: "in",
  notin: "in.not", ni: "in.rev", perp: "perp", parallel: "parallel",
  nparallel: "parallel.not", mid: "divides", nmid: "divides.not",
  doteq: "eq.dot", asymp: "asymp", models: "models",
  vdash: "tack.r", dashv: "tack.l",

  // ---- Arrows ----
  to: "arrow.r", rightarrow: "arrow.r", leftarrow: "arrow.l",
  gets: "arrow.l", leftrightarrow: "arrow.l.r", uparrow: "arrow.t",
  downarrow: "arrow.b", Rightarrow: "arrow.r.double",
  Leftarrow: "arrow.l.double", Leftrightarrow: "arrow.l.r.double",
  implies: "arrow.r.double", impliedby: "arrow.l.double",
  iff: "arrow.l.r.double", mapsto: "arrow.r.bar",
  longrightarrow: "arrow.r.long", longleftarrow: "arrow.l.long",
  longleftrightarrow: "arrow.l.r.long", longmapsto: "arrow.r.long.bar",
  hookrightarrow: "arrow.r.hook", hookleftarrow: "arrow.l.hook",
  nearrow: "arrow.tr", searrow: "arrow.br", swarrow: "arrow.bl",
  nwarrow: "arrow.tl",

  // ---- Miscellaneous symbols ----
  infty: "infinity", partial: "diff", nabla: "nabla", forall: "forall",
  exists: "exists", nexists: "exists.not", emptyset: "nothing",
  varnothing: "nothing", angle: "angle", measuredangle: "angle.arc",
  triangle: "triangle.stroked.t", square: "square.stroked",
  blacksquare: "square.filled", therefore: "therefore", because: "because",
  ldots: "dots.h", dots: "dots.h", cdots: "dots.c", vdots: "dots.v",
  ddots: "dots.down", prime: "prime", degree: "degree", aleph: "aleph",
  ell: "ell", hbar: "planck.reduce", wp: "wp", Re: "Re", Im: "Im",
  imath: "dotless.i", jmath: "dotless.j", top: "top", bot: "bot",
  checkmark: "checkmark", dagger: "dagger", ddagger: "dagger.double",
  flat: "flat", sharp: "sharp", natural: "natural",
  pounds: "pound", euro: "euro", copyright: "copyright",

  // ---- Big operators (Typst gives them limits automatically) ----
  sum: "sum", prod: "product", coprod: "product.co", int: "integral",
  iint: "integral.double", iiint: "integral.triple", oint: "integral.cont",
  bigvee: "or.big", bigwedge: "and.big",

  // ---- Delimiters used bare (\left/\right are handled structurally) ----
  langle: "angle.l", rangle: "angle.r", lfloor: "floor.l",
  rfloor: "floor.r", lceil: "ceil.l", rceil: "ceil.r", vert: "|",
  Vert: "bar.v.double", lbrace: "{", rbrace: "}",
  lbrack: "[", rbrack: "]",

  // ---- Spacing ----
  quad: "quad", qquad: "wide", thinspace: "thin", medspace: "med",
  thickspace: "thick", enspace: "thin", space: "space",
  ",": "thin", ":": "med", ";": "thick", "!": "",

  // ---- Escaped literals. The backslash is stripped; the character stays. ----
  "%": "%", "&": "&", "{": "{", "}": "}", "_": "_", " ": "space",
  "|": "bar.v.double", "#": "\\#", "$": "\\$",
};

/**
 * Named operators: \sin, \log, \det. Typst sets these upright automatically,
 * which is the whole point of writing \sin rather than sin in LaTeX.
 */
const OPERATORS: Record<string, string> = {
  sin: "sin", cos: "cos", tan: "tan", sec: "sec", csc: "csc", cot: "cot",
  arcsin: "arcsin", arccos: "arccos", arctan: "arctan", sinh: "sinh",
  cosh: "cosh", tanh: "tanh", coth: "coth", log: "log", ln: "ln", lg: "lg",
  exp: "exp", det: "det", dim: "dim", deg: "deg", arg: "arg", ker: "ker",
  gcd: "gcd", lcm: "lcm", min: "min", max: "max", sup: "sup", inf: "inf",
  lim: "lim", limsup: "limsup", liminf: "liminf", mod: "mod", bmod: "mod",
  Pr: "Pr", hom: "hom", tr: "tr",
};

/**
 * Commands that change style or spacing and have no Typst equivalent worth
 * emitting. Dropped silently rather than rendered as stray words.
 */
const IGNORED = new Set([
  "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle",
  "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr",
  "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr", "mathstrut",
  "strut", "noalign", "notag", "nonumber", "allowbreak",
]);

/** Accents and one-argument wrappers: \hat{x} -> hat(x). */
const UNARY: Record<string, (a: string) => string> = {
  overline: (a) => `overline(${a})`,
  underline: (a) => `underline(${a})`,
  bar: (a) => `macron(${a})`,
  hat: (a) => `hat(${a})`,
  widehat: (a) => `hat(${a})`,
  tilde: (a) => `tilde(${a})`,
  widetilde: (a) => `tilde(${a})`,
  vec: (a) => `arrow(${a})`,
  overrightarrow: (a) => `arrow(${a})`,
  overleftarrow: (a) => `accent(${a}, arrow.l)`,
  dot: (a) => `dot(${a})`,
  ddot: (a) => `dot.double(${a})`,
  dddot: (a) => `dot.triple(${a})`,
  breve: (a) => `breve(${a})`,
  acute: (a) => `acute(${a})`,
  grave: (a) => `grave(${a})`,
  check: (a) => `caron(${a})`,
  mathring: (a) => `circle(${a})`,
  underbrace: (a) => `underbrace(${a})`,
  overbrace: (a) => `overbrace(${a})`,
  cancel: (a) => `cancel(${a})`,
  mathrm: (a) => `upright(${a})`,
  mathbf: (a) => `bold(upright(${a}))`,
  boldsymbol: (a) => `bold(${a})`,
  bm: (a) => `bold(${a})`,
  pmb: (a) => `bold(${a})`,
  mathit: (a) => `italic(${a})`,
  mathsf: (a) => `sans(${a})`,
  mathtt: (a) => `mono(${a})`,
  mathcal: (a) => `cal(${a})`,
  mathscr: (a) => `cal(${a})`,
  mathfrak: (a) => `frak(${a})`,
  mathop: (a) => `op(${a})`,
};

/** Two-argument commands. */
const BINARY: Record<string, (a: string, b: string) => string> = {
  frac: (a, b) => `frac(${a}, ${b})`,
  dfrac: (a, b) => `display(frac(${a}, ${b}))`,
  tfrac: (a, b) => `inline(frac(${a}, ${b}))`,
  cfrac: (a, b) => `display(frac(${a}, ${b}))`,
  binom: (a, b) => `binom(${a}, ${b})`,
  dbinom: (a, b) => `binom(${a}, ${b})`,
  tbinom: (a, b) => `binom(${a}, ${b})`,
  // \overset{above}{base} puts the FIRST argument on top of the second.
  overset: (a, b) => `attach(${b || '""'}, t: ${a})`,
  stackrel: (a, b) => `attach(${b || '""'}, t: ${a})`,
  underset: (a, b) => `attach(${b || '""'}, b: ${a})`,
};

/**
 * The matrix environments, and the delimiter each one draws.
 *
 * `delim` has to be the FIRST argument in the emitted call: Typst rejects
 * mat(1, 2; 3, 4, delim: "[") because a named argument cannot follow the
 * positional rows.
 */
const MATRIX_DELIMS: Record<string, string> = {
  matrix: "#none",
  smallmatrix: "#none",
  array: "#none",
  pmatrix: '"("',
  bmatrix: '"["',
  Bmatrix: '"{"',
  vmatrix: '"|"',
  Vmatrix: "bar.v.double",
};

/** Environments whose rows are stacked with Typst's own line break. */
const ALIGN_ENVS = new Set([
  "aligned", "align", "align*", "alignat", "alignat*", "gathered", "gather",
  "gather*", "split", "eqnarray", "eqnarray*", "multline", "multline*",
  "equation", "equation*", "displaymath",
]);

// -- Parser / emitter ----------------------------------------------------------

interface Cursor {
  toks: Tok[];
  i: number;
  /** Command names encountered with no mapping. Surfaced for diagnostics. */
  unknown: string[];
}

/** One parsed atom, and whether it came from an invisible LaTeX brace group. */
interface Atom {
  src: string;
  /**
   * True when the atom was a {...} group. It matters for attachment: LaTeX
   * braces are invisible, so "{a+b}^2" must NOT become "(a+b)^2" (which
   * prints brackets Typst would draw) but attach(a + b, t: 2), which draws
   * none.
   */
  grouped: boolean;
}

function peek(cur: Cursor): Tok | undefined {
  return cur.toks[cur.i];
}

/** Skips whitespace tokens, which carry no meaning in math mode. */
function skipSpace(cur: Cursor): void {
  while (cur.toks[cur.i]?.t === "sp") cur.i += 1;
}

function quoteTypstString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Rebuilds the literal source of a braced group, for \text{} and friends.
 * Runs on tokens rather than the original string because the caller is
 * already mid-stream; the "sp" token exists so this can put the spaces back.
 */
function readRawGroup(cur: Cursor): string {
  skipSpace(cur);
  if (peek(cur)?.t !== "lb") {
    // A single-token argument: \text x. Rare but legal.
    const tk = cur.toks[cur.i];
    if (!tk) return "";
    cur.i += 1;
    return tk.t === "ch" || tk.t === "num" ? tk.v : "";
  }
  cur.i += 1; // consume {
  let depth = 1;
  let out = "";
  while (cur.i < cur.toks.length) {
    const tk = cur.toks[cur.i];
    cur.i += 1;
    if (tk.t === "lb") { depth += 1; out += "{"; continue; }
    if (tk.t === "rb") {
      depth -= 1;
      if (depth === 0) break;
      out += "}";
      continue;
    }
    if (tk.t === "sp") { out += " "; continue; }
    if (tk.t === "ch" || tk.t === "num") { out += tk.v; continue; }
    if (tk.t === "sup") { out += "^"; continue; }
    if (tk.t === "sub") { out += "_"; continue; }
    if (tk.t === "amp") { out += "&"; continue; }
    if (tk.t === "row") { out += " "; continue; }
    // \% and \& inside text are escapes for the character itself; a control
    // word text mode cannot show leaves only its name behind.
    if (tk.t === "cmd") out += tk.v;
  }
  return out.trim();
}

/** Reads one argument: a brace group, or the single atom that follows. */
function readArg(cur: Cursor): string {
  skipSpace(cur);
  if (peek(cur)?.t === "lb") {
    cur.i += 1;
    const inner = readSeq(cur, (t) => t.t === "rb");
    if (peek(cur)?.t === "rb") cur.i += 1;
    return inner;
  }
  const atom = readAtom(cur);
  return atom ? atom.src : "";
}

/** Reads \sqrt's optional [n] index, if present. */
function readOptionalArg(cur: Cursor): string | null {
  skipSpace(cur);
  const tk = peek(cur);
  if (!(tk?.t === "ch" && tk.v === "[")) return null;
  cur.i += 1;
  const inner = readSeq(cur, (t) => t.t === "ch" && t.v === "]");
  const closer = peek(cur);
  if (closer?.t === "ch" && closer.v === "]") cur.i += 1;
  return inner;
}

/** Reads the environment name in \begin{...} / \end{...}. */
function readEnvName(cur: Cursor): string {
  return readRawGroup(cur).replace(/\s+/g, "");
}

/**
 * Reads the rows of an environment, splitting on \\ and & .
 * Stops at the matching \end, which it consumes.
 */
function readEnvRows(cur: Cursor): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  for (;;) {
    const cell = readSeq(
      cur,
      (t) =>
        t.t === "amp" ||
        t.t === "row" ||
        (t.t === "cmd" && (t.v === "end" || t.v === "cr" || t.v === "newline")) ||
        t.t === "rb",
    );
    row.push(cell);
    const tk = peek(cur);
    if (tk?.t === "amp") { cur.i += 1; continue; }
    if (tk?.t === "row" || (tk?.t === "cmd" && (tk.v === "cr" || tk.v === "newline"))) {
      cur.i += 1;
      rows.push(row);
      row = [];
      continue;
    }
    if (tk?.t === "cmd" && tk.v === "end") {
      cur.i += 1;
      readEnvName(cur);
      break;
    }
    // Ran out of tokens (or hit a stray brace) without an \end. Take what
    // there is rather than losing the row.
    break;
  }
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.length > 0));
}

function emitEnvironment(cur: Cursor, env: string): string {
  // \begin{array}{ccc} -- the column spec is a LaTeX layout detail with no
  // Typst counterpart. Read it so it cannot be parsed as content.
  if (env === "array" || env === "tabular" || env.startsWith("alignat")) {
    skipSpace(cur);
    if (peek(cur)?.t === "lb") readRawGroup(cur);
  }
  const rows = readEnvRows(cur);

  if (env === "cases" || env === "dcases" || env === "rcases") {
    // The & between a case's value and its condition is alignment in LaTeX
    // and alignment in Typst too, so it survives the crossing intact -- but
    // the GAP does not. LaTeX's cases environment sets its second column off
    // from the first; Typst butts them together, which printed "-xx<0" for
    // "-x" when "x < 0". quad restores the space the condition needs.
    return `cases(${rows.map((r) => r.join(" & quad ")).join(", ")})`;
  }
  if (env in MATRIX_DELIMS) {
    const delim = MATRIX_DELIMS[env];
    const body = rows.map((r) => r.join(", ")).join("; ");
    return delim === '"("' ? `mat(${body})` : `mat(delim: ${delim}, ${body})`;
  }
  if (ALIGN_ENVS.has(env)) {
    // Typst aligns on & in an equation just as LaTeX does, and its row break
    // is a bare backslash, so the rows translate one for one.
    return rows.map((r) => r.join(" & ")).join(" \\ ");
  }
  // An environment nobody taught this module about: keep the mathematics,
  // drop the layout. Better a run-on line than a lost question.
  cur.unknown.push(env);
  return rows.map((r) => r.join(" ")).join(" ");
}

/**
 * \left( ... \right) and friends.
 *
 * Typst scales ordinary brackets automatically, so most pairs need no lr()
 * at all. The pairs that have a dedicated Typst function -- absolute value,
 * norm, floor, ceiling -- use it, because those read better and because
 * their glyphs are not ASCII.
 */
function emitLeftRight(cur: Cursor): string {
  const open = readDelimiter(cur);
  const body = readSeq(
    cur,
    (t) => t.t === "cmd" && (t.v === "right" || t.v === "end"),
  );
  let close = "";
  const tk = peek(cur);
  if (tk?.t === "cmd" && tk.v === "right") {
    cur.i += 1;
    close = readDelimiter(cur);
  }
  if (open === "|" && close === "|") return `abs(${body})`;
  if (open === "bar.v.double" && close === "bar.v.double") return `norm(${body})`;
  if (open === "floor.l" && close === "floor.r") return `floor(${body})`;
  if (open === "ceil.l" && close === "ceil.r") return `ceil(${body})`;
  if (open === "" && close === "") return body;
  // lr() is what makes a mismatched or one-sided pair -- \left. ... \right)
  // -- scale as one unit, which is exactly when LaTeX authors reach for it.
  return `lr(${open} ${body} ${close})`;
}

/** Reads the delimiter character or command after \left / \right. */
function readDelimiter(cur: Cursor): string {
  skipSpace(cur);
  const tk = peek(cur);
  if (!tk) return "";
  if (tk.t === "ch") {
    cur.i += 1;
    if (tk.v === ".") return ""; // \left. -- a deliberately absent delimiter
    return tk.v;
  }
  if (tk.t === "cmd") {
    cur.i += 1;
    if (tk.v === ".") return "";
    return SYMBOLS[tk.v] ?? "";
  }
  if (tk.t === "lb") { cur.i += 1; return "{"; }
  if (tk.t === "rb") { cur.i += 1; return "}"; }
  return "";
}

function emitCommand(cur: Cursor, name: string): string | null {
  if (IGNORED.has(name)) return null;
  // Outside an environment a row break is just a line break, and Typst spells
  // that with the bare backslash it already is.
  if (name === "cr" || name === "newline") return "\\";

  if (name === "begin") return emitEnvironment(cur, readEnvName(cur));
  if (name === "end") { readEnvName(cur); return null; }
  if (name === "left") return emitLeftRight(cur);

  if (name === "sqrt") {
    const index = readOptionalArg(cur);
    const radicand = readArg(cur);
    return index ? `root(${index}, ${radicand})` : `sqrt(${radicand})`;
  }

  // Text-mode arguments are read raw: their spaces are content, and their
  // letters must stay words rather than becoming a product of variables.
  if (name === "text" || name === "textrm" || name === "textnormal" || name === "mbox" || name === "textup") {
    return quoteTypstString(readRawGroup(cur));
  }
  if (name === "textbf") return `bold(${quoteTypstString(readRawGroup(cur))})`;
  if (name === "textit" || name === "emph") return `italic(${quoteTypstString(readRawGroup(cur))})`;
  if (name === "operatorname") return `op(${quoteTypstString(readRawGroup(cur))})`;
  if (name === "mathbb") {
    const inner = readArg(cur);
    const set: Record<string, string> = { R: "RR", N: "NN", Z: "ZZ", Q: "QQ", C: "CC" };
    return set[inner] ?? `bb(${inner})`;
  }
  // \color / \textcolor: keep the mathematics, drop the colour. A packet is
  // printed in one ink.
  if (name === "textcolor" || name === "colorbox") { readRawGroup(cur); return readArg(cur); }
  if (name === "color") { readRawGroup(cur); return null; }
  if (name === "phantom" || name === "hphantom" || name === "vphantom") {
    readArg(cur);
    return null;
  }
  if (name === "pmod") return `quad (mod ${readArg(cur)})`;
  if (name === "substack") return readArg(cur);

  if (name in BINARY) {
    const a = readArg(cur);
    const b = readArg(cur);
    return BINARY[name](a, b);
  }
  if (name in UNARY) return UNARY[name](readArg(cur));
  if (name in OPERATORS) return OPERATORS[name];
  if (name in SYMBOLS) return SYMBOLS[name];

  // Unknown. Show it as upright text rather than dropping it: a teacher
  // proof-reading the PDF can see that something did not translate, which a
  // silent deletion would hide.
  if (/^[A-Za-z]+$/.test(name)) {
    cur.unknown.push(name);
    return quoteTypstString(name);
  }
  return null;
}

function readAtom(cur: Cursor): Atom | null {
  skipSpace(cur);
  const tk = peek(cur);
  if (!tk) return null;

  if (tk.t === "lb") {
    cur.i += 1;
    const inner = readSeq(cur, (t) => t.t === "rb");
    if (peek(cur)?.t === "rb") cur.i += 1;
    return { src: inner, grouped: true };
  }
  if (tk.t === "rb") { cur.i += 1; return null; } // unmatched; drop it
  if (tk.t === "num") { cur.i += 1; return { src: tk.v, grouped: false }; }
  if (tk.t === "amp") { cur.i += 1; return { src: "&", grouped: false }; }
  if (tk.t === "row") { cur.i += 1; return { src: "\\", grouped: false }; }
  if (tk.t === "sp") { cur.i += 1; return null; }
  if (tk.t === "cmd") {
    cur.i += 1;
    const out = emitCommand(cur, tk.v);
    return out === null ? null : { src: out, grouped: false };
  }
  if (tk.t === "ch") {
    cur.i += 1;
    // Every letter is its own atom on purpose: LaTeX "ab" is a product, and
    // Typst would read an unsplit "ab" as a variable that does not exist.
    return { src: tk.v, grouped: false };
  }
  // sup / sub with nothing before them, e.g. a leading ^\circ. Typst rejects
  // a bare attachment, so give it an empty base of zero width.
  cur.i += 1;
  const script = tk.t === "sup" ? "^" : "_";
  return { src: `#h(0pt)${script}(${readArg(cur)})`, grouped: false };
}

/** Attaches every ^ / _ / \limits that follows an atom to that atom. */
function attachScripts(cur: Cursor, atom: Atom): string {
  let top: string | null = null;
  let bottom: string | null = null;
  let base = atom.src;
  let limits: "limits" | "scripts" | null = null;

  for (;;) {
    const save = cur.i;
    skipSpace(cur);
    const tk = peek(cur);
    if (tk?.t === "sup" || tk?.t === "sub") {
      cur.i += 1;
      const arg = readArg(cur);
      if (tk.t === "sup") {
        // 30^\circ is thirty degrees. Everywhere else \circ is function
        // composition, and that is what SYMBOLS maps it to -- but a ring in
        // the exponent has meant "degrees" since long before either language,
        // and a composition glyph there would be both wrong and too large.
        const sup = arg === "compose" ? "degree" : arg;
        top = top === null ? sup : `${top} ${sup}`;
      } else {
        bottom = bottom === null ? arg : `${bottom} ${arg}`;
      }
      continue;
    }
    if (tk?.t === "cmd" && (tk.v === "limits" || tk.v === "nolimits")) {
      cur.i += 1;
      limits = tk.v === "limits" ? "limits" : "scripts";
      continue;
    }
    cur.i = save;
    break;
  }

  if (limits) base = `${limits}(${base})`;
  if (top === null && bottom === null) return base;

  // A brace group is invisible in LaTeX, so its scripts cannot be written
  // with Typst's ^( ) -- that would need a printed bracket as the base.
  // attach() takes the base as a function argument instead, and draws none.
  if (atom.grouped || base === "") {
    const args = [base || '""'];
    if (top !== null) args.push(`t: ${top}`);
    if (bottom !== null) args.push(`b: ${bottom}`);
    return `attach(${args.join(", ")})`;
  }
  let out = base;
  if (bottom !== null) out += `_(${bottom})`;
  if (top !== null) out += `^(${top})`;
  return out;
}

function readSeq(cur: Cursor, isStop: (t: Tok) => boolean): string {
  const atoms: string[] = [];
  while (cur.i < cur.toks.length) {
    skipSpace(cur);
    const tk = peek(cur);
    if (!tk) break;
    if (isStop(tk)) break;
    const atom = readAtom(cur);
    if (atom === null) continue;
    atoms.push(attachScripts(cur, atom));
  }
  return atoms.filter((a) => a.length > 0).join(" ").trim();
}

// -- Public API ----------------------------------------------------------------

export interface LatexToTypstResult {
  typst: string;
  /** Command and environment names with no mapping, in encounter order. */
  unknown: string[];
}

/** Converts one LaTeX math expression (no $ delimiters) to Typst math. */
export function latexToTypstVerbose(latex: string): LatexToTypstResult {
  const cur: Cursor = { toks: tokenize(latex), i: 0, unknown: [] };
  const typst = readSeq(cur, () => false);
  return { typst, unknown: [...new Set(cur.unknown)] };
}

/** Converts one LaTeX math expression (no $ delimiters) to Typst math. */
export function latexToTypst(latex: string): string {
  return latexToTypstVerbose(latex).typst;
}

/**
 * Does this $...$ segment hold LaTeX, or the Typst syntax packets were
 * written in before this module existed?
 *
 * A backslash is the whole test, and it is exact rather than heuristic:
 * LaTeX math of any substance has a control sequence in it, and Typst math
 * has no backslash at all except as a line break -- which never appears in
 * the stored packets. Anything without one is left to the legacy path, so
 * every packet saved before the switch keeps rendering exactly as it did.
 */
export function isLatexMath(segment: string): boolean {
  return segment.includes("\\");
}

/**
 * Rewrites the LaTeX math in a prose string into trusted, pre-converted
 * Typst, leaving everything else -- prose, currency, legacy Typst spans --
 * byte for byte as it was.
 *
 * Pure and idempotent: the sentinel-wrapped output contains no $ pair for a
 * second pass to find.
 */
export function convertLatexSegmentsToTypst(
  text: string,
  /**
   * Decides, per span, whether to convert. Defaults to "does it contain a
   * backslash", which is the exact test for hand-written LaTeX. Callers that
   * can tell more -- typst-payload.ts knows what the Typst side would refuse
   * -- pass their own; see spanIsForLatexConversion in math-typesetting.ts.
   */
  shouldConvert: (span: string) => boolean = isLatexMath,
): string {
  if (typeof text !== "string" || !text.includes("$")) return text;
  // A currency escape is not a delimiter and must not be counted as one --
  // see ESCAPED_DOLLAR. Masked for the whole of the split below, and put
  // back on the way out.
  const masked = maskCurrency(text);
  if (masked !== text) return unmaskCurrency(convertLatexSegmentsToTypst(masked, shouldConvert));
  // $$...$$ is display math in LaTeX and nothing at all here: the packet
  // template has one delimiter, and a $$ pair splits into two EMPTY math
  // segments with the expression stranded between them as prose, which is how
  // a displayed equation would reach the page as its own source code. The
  // generator is told not to write one (rule 11b); if it does anyway, the
  // expression renders inline rather than raw. Collapsing pairs cannot change
  // the parity of the split, so a balanced string stays balanced.
  const parts = text.replace(/\${2}/g, "$").split("$");
  // An odd number of delimiters means they are unbalanced -- a currency
  // amount, most often -- and pairing them up would invent a math span the
  // author never wrote. Touch nothing.
  if (parts.length % 2 === 0) return text;
  return parts
    .map((part, i) => {
      if (i % 2 === 0) return part;
      if (!shouldConvert(part)) return `$${part}$`;
      const { typst } = latexToTypstVerbose(part);
      // A segment that converts to nothing at all (only ignored commands)
      // keeps its original delimiters rather than vanishing from the page.
      if (typst.length === 0) return `$${part}$`;
      return `${TRUSTED_MATH_DELIM}${typst}${TRUSTED_MATH_DELIM}`;
    })
    .join("");
}
