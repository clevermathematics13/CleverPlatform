/**
 * math-typesetting.ts
 * -----------------------------------------------------------------------------
 * Guarantees that a Nuanced Analysis packet typesets its mathematics, whatever
 * the generator hands us.
 *
 * THE FAILURE THIS EXISTS TO PREVENT, with the evidence:
 *
 * The B.4 packet "Products of Linear Expressions" (Grade 9 Extended,
 * 16 Sep 2026) printed twelve pages in which EVERY equation was literal ASCII:
 * "a^2+2ab+b^2", "(x+3)(x-3)", "6x^2 + 11x + 3". Not one dollar sign appeared
 * in the whole document, and no math font was embedded in the PDF at all.
 *
 * Nothing was broken in the renderer. `rich()` in typst-render.service.ts
 * splits on "$" and evaluates the odd segments as real Typst math, and every
 * user-visible field in the template goes through it. The generator simply did
 * not emit the delimiters, despite the 11b MATH rule telling it to -- and when
 * it does not, the pipeline has no opinion: the caret prints as a caret and a
 * mathematics packet goes to fourteen-year-olds looking like source code.
 *
 * A prompt rule is a request. This module is the guarantee. It finds the
 * mathematics in a string that has no delimiters and wraps it, so the packet
 * typesets whether or not the model cooperated.
 *
 * DESIGN: CONSERVATIVE BY CONSTRUCTION.
 *
 * The cost of the two possible mistakes is wildly asymmetric. Leaving a real
 * equation unwrapped reproduces today's bug, which is ugly but legible.
 * Wrapping prose turns an English sentence into a row of italic variables --
 * or, worse, aborts the whole compile, because a multi-letter run inside
 * $...$ is a variable lookup in Typst and there is no try/catch to catch it.
 * So every rule here errs toward leaving text alone: a span is wrapped only
 * when it carries an unmistakable signal of being mathematics, and any token
 * that could plausibly be an English word stops the span dead.
 *
 * Already-delimited input is left exactly as written. A string the generator
 * got right passes through untouched, byte for byte.
 * -----------------------------------------------------------------------------
 */

/**
 * Identifiers Typst math actually defines.
 *
 * This is the single source of truth: typst-render.service.ts interpolates it
 * into the `math-idents` tuple in its Typst prelude rather than keeping a
 * second copy. The two lists drifting apart is not a hypothetical -- the
 * prelude's own comment records that excluding operator words the generator
 * genuinely emits ("times", "div") silently degraded real equations to
 * literal text, dollar signs and all, on a printed student packet.
 *
 * An entry that Typst does NOT define belongs in MATH_ALIASES instead, never
 * here alone: a genuine math segment using it would abort the entire compile.
 */
export const TYPST_MATH_IDENTS: readonly string[] = [
  "sin", "cos", "tan", "sec", "csc", "cot", "sinh", "cosh", "tanh",
  "arcsin", "arccos", "arctan", "log", "ln", "lg", "exp", "sqrt", "root", "abs",
  "floor", "ceil", "sum", "product", "integral", "lim", "liminf", "limsup",
  "dif", "diff", "partial",
  "infinity", "approx", "neq", "leq", "geq", "cdot", "pm", "mp", "equiv", "prop",
  "times", "div", "dot", "plus", "minus", "in", "subset", "union", "sect",
  "min", "max", "mod", "gcd", "lcm", "det", "deg", "dim", "arg", "ker", "inf", "sup",
  "arrow", "dots", "mapsto", "implies", "iff", "oplus", "otimes",
  "forall", "exists", "emptyset", "nothing", "because", "therefore",
  "frac", "binom", "vec", "mat", "cases", "overline", "underline", "hat", "tilde",
  "macron", "op", "bb", "cal", "frak", "upright",
  "quad", "star", "compose", "prec", "succ",
  "rr", "zz", "nn", "qq", "cc",
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta",
  "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau",
  "upsilon", "phi", "chi", "psi", "omega", "pi",
];

/**
 * LaTeX-habit operator names Typst math does NOT define, and their real
 * Typst symbols. Also mirrored into the prelude's `math-aliases`.
 */
export const MATH_ALIASES: readonly (readonly [string, string])[] = [
  ["neq", "eq.not"], ["leq", "lt.eq"], ["geq", "gt.eq"],
  ["cdot", "dot.op"], ["pm", "plus.minus"], ["mp", "minus.plus"],
  ["implies", "arrow.r.double"], ["iff", "arrow.l.r.double"],
  ["oplus", "plus.circle"], ["otimes", "times.circle"],
];

/**
 * Short English words that must never be absorbed into a math span.
 *
 * Needed because algebra is full of two- and three-letter products -- "ab",
 * "ac", "bd", "ad+bc" -- that are indistinguishable from short English words
 * by shape alone. Without this list, "the middle coefficient is ad+bc and the
 * constant is bd" would swallow "and" into the equation.
 *
 * Note the deliberate overlap with TYPST_MATH_IDENTS: "in", "min", "max",
 * "dot", "times", "sup", "inf", "deg", "arg", "mod" are all real Typst
 * identifiers AND ordinary English in this content. Inside an existing $...$
 * the identifier reading is right and the prelude accepts them; out here,
 * deciding whether to CREATE a span, the English reading is overwhelmingly
 * more likely and this list wins.
 */
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "as", "at", "by",
  "for", "from", "in", "into", "is", "it", "its", "of", "on", "to", "up", "no",
  "not", "all", "any", "be", "can", "do", "each", "one", "two", "may", "new",
  "now", "out", "own", "per", "see", "set", "sum", "that", "this", "these",
  "those", "with", "when", "what", "why", "how", "who", "you", "your", "we",
  "us", "our", "they", "them", "has", "have", "had", "was", "were", "will",
  "are", "am", "been", "being", "does", "did", "done", "get", "got", "give",
  "let", "put", "say", "use", "used", "uses", "made", "make", "more", "most",
  "much", "many", "less", "least", "same", "both", "than", "them", "there",
  "here", "over", "under", "above", "below", "after", "before", "again",
  "once", "only", "just", "also", "very", "such", "like", "term", "terms",
  "part", "parts", "step", "steps", "form", "unit", "units", "value",
  "values", "give", "must", "each", "every", "some", "none", "next", "last",
  "first", "second", "third", "left", "right", "side", "sides", "row", "rows",
  "mod", "min", "max", "dot", "times", "sup", "inf", "deg", "arg", "root",
  "cases", "star", "quad", "dots", "op", "prop", "abs", "arrow", "product",
]);

/** Characters that may appear inside an unwrapped math token. */
const MATH_CHARS = /^[0-9A-Za-z^_+\-*/=().,<>!|√±×÷≤≥≠]+$/;

/** A parenthesised list label such as "(a)", "(ii)", "(B)" -- never math. */
const LIST_LABEL = /^\([A-Za-z]{1,3}\)$/;

/**
 * A scope-and-sequence reference: "A.3", "(A.3)", "B.4;", "A.3:".
 *
 * These are everywhere in this course's prose -- the packets cite each other
 * constantly -- and a single capital letter is otherwise NEUTRAL, so an
 * adjacent equation absorbs the reference and prints it in math italic. The
 * B.4 packet shipped with "b^2(A.3)" on its prerequisites line for exactly
 * this reason: the "(A.3)" was swallowed into the span beside it.
 */
const SECTION_REF = /^\(?[A-Z]{1,2}\.\d{1,2}\)?[.,;:]?$/;

/** Trailing sentence punctuation, peeled off a span before wrapping. */
const TRAILING_PUNCT = /[,.;:!?]+$/;

/** Leading punctuation, peeled off a span before wrapping. */
const LEADING_PUNCT = /^[,;:]+/;

const IDENT_SET = new Set(TYPST_MATH_IDENTS);
const ALIAS_MAP = new Map(MATH_ALIASES.map(([k, v]) => [k, v] as const));

/**
 * Rewrites a bare expression into Typst math that actually compiles.
 *
 * WHY THIS IS NOT OPTIONAL, measured against the shipped compiler: a
 * multi-letter run in Typst math is a variable lookup, so `eval("ab + ac",
 * mode: "math")` raises "unknown variable: ab" and, since Typst has no
 * try/catch, takes the whole document down. Wrapping `a(b+c) = ab + ac` in
 * dollar signs without this step would turn today's cosmetic bug into a
 * packet that will not print at all.
 *
 * The rewrite splits an unrecognised run into spaced single letters --
 * "ab" becomes "a b", which Typst renders as exactly the juxtaposed product
 * a teacher wrote. Runs Typst DOES define ("sin", "sqrt", "alpha") are left
 * whole, and LaTeX-habit names are mapped through MATH_ALIASES. Applied
 * only to spans this module creates: a segment the generator already
 * delimited is its own author's, and the prelude's normalize-math handles it.
 */
export function toTypstMath(expr: string): string {
  // Three things must survive untouched, and each one is a real string the
  // generator emits:
  //   "Var"        a quoted operator (11b requires the quotes) -- splitting
  //                inside it yields "V a r"
  //   lt.eq        a dotted Typst symbol name; "lt" and "eq" are not
  //                identifiers on their own and would each be split
  //   sin, alpha   ordinary identifiers
  // Everything else that is 2+ letters is a juxtaposed product.
  return expr.replace(
    /"[^"]*"|[A-Za-z]+(?:\.[A-Za-z]+)+|[A-Za-z]+/g,
    (run) => {
      if (run.startsWith('"')) return run;   // quoted operator
      if (run.includes(".")) return run;     // dotted symbol name
      if (run.length === 1) return run;
      const lower = run.toLowerCase();
      const alias = ALIAS_MAP.get(lower);
      if (alias) return alias;
      if (IDENT_SET.has(lower)) return run;
      return run.split("").join(" ");
    },
  );
}

type TokenKind =
  /** Unmistakably mathematics -- carries a structural signal. */
  | "math"
  /** Can sit inside a span but cannot start or justify one. */
  | "neutral"
  /** Ordinary prose. Always ends a span. */
  | "prose";

/**
 * Does this token carry a signal that it is mathematics rather than prose?
 *
 * Each signal is chosen to be one that ordinary English simply does not
 * produce. A caret, a subscript, adjacent bracket groups, a coefficient glued
 * to a variable, a letter glued to an opening bracket, or two letters joined
 * by an arithmetic operator.
 */
function hasMathSignal(token: string): boolean {
  if (/[\^_]/.test(token)) return true;                 // x^2, a_1
  if (/\)\s*\(/.test(token)) return true;               // (x+3)(x-3)
  if (/\d[A-Za-z]/.test(token)) return true;            // 6x, 2ab
  if (/[A-Za-z]\(/.test(token)) return true;            // a(b+c), sqrt(9)
  // Operator glue, deliberately WITHOUT a bare hyphen. "Q17-Q18" is a range
  // of question numbers and "Prove-vs-Verify" is a hyphenated compound; both
  // appear in real packet prose and both were wrapped -- and then shredded
  // into spaced single letters -- when "-" counted here. Subtraction still
  // reaches a span through a neighbouring token that carries a real signal
  // ("x^2 - 9" via the caret), so nothing genuine is lost.
  if (/[A-Za-z0-9][+*/=][A-Za-z0-9]/.test(token)) return true; // ad+bc, x=3
  if (/[√±×÷≤≥≠]/.test(token)) return true;
  return false;
}

function classify(token: string): TokenKind {
  if (token.length === 0) return "prose";

  // A list label is a labelling convention, not an expression. "(a) 5x^2"
  // must not become "$(a) 5x^2$" -- the label belongs to the question's
  // numbering, and italicising it detaches it from every other label on
  // the page.
  if (LIST_LABEL.test(token)) return "prose";

  // A section reference is a citation, not a quantity. Prose, so it can
  // neither start a span nor be absorbed into one.
  if (SECTION_REF.test(token)) return "prose";

  const bare = token.replace(TRAILING_PUNCT, "").replace(LEADING_PUNCT, "");
  if (bare.length === 0) return "neutral";

  // Anything carrying a character prose does not use is out of scope for
  // this decision -- an apostrophe, a quote, a slash between words.
  if (!MATH_CHARS.test(bare)) return "prose";

  if (hasMathSignal(bare)) return "math";

  // Pure operators and relations glue a span together but never justify one.
  if (/^[+\-*/=<>|]+$/.test(bare)) return "neutral";

  // A bare number is neutral: "Part 3" must not become mathematics, but the
  // 9 in "x^2 - 9" must be able to join the span beside it.
  if (/^\d+(\.\d+)?$/.test(bare)) return "neutral";

  const letters = bare.replace(/[^A-Za-z]/g, "");

  // A single letter is a variable when it sits beside mathematics, and the
  // English article "a" otherwise. Neutral, so adjacency decides.
  if (letters.length === 1) return "neutral";

  // Short all-letter runs are the genuinely ambiguous case -- "ab" the
  // product versus "as" the conjunction. The stopword list decides, and
  // anything unrecognised stays prose.
  if (letters.toLowerCase() === bare.toLowerCase()) {
    if (ENGLISH_STOPWORDS.has(bare.toLowerCase())) return "prose";
    // "ab", "ac", "bd" -- a short run of distinct-looking variable letters.
    if (bare.length <= 3 && /^[a-z]+$/.test(bare)) return "neutral";
    return "prose";
  }

  return "prose";
}

/**
 * Wraps the unwrapped mathematics in `text` with Typst `$...$` delimiters.
 *
 * Pure and idempotent: running it twice produces the same string, because
 * anything already inside $...$ is copied through untouched.
 */
export function typesetMath(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;

  // An odd number of "$" means the delimiters are unbalanced -- most often a
  // currency amount, per the 11d rule -- so the safe move is to touch nothing.
  //
  // Otherwise: typeset the pieces OUTSIDE $...$, and normalise the pieces
  // INSIDE it. The inside pass is not belt-and-braces, it is the second bug
  // this module was built for. The B.4 regeneration of 16 Sep 2026 emitted
  // correct-looking delimiters and still printed 84 literal dollar signs,
  // because it wrote juxtaposed products inside them -- "$a^2+2ab+b^2$",
  // "$(ax+b)(cx+d)$", "$A x^2+Bx+C$". Typst reads "ab", "ax", "cx" and "Bx"
  // as unknown variables, so rich()'s looks-like-math() rejects the segment
  // and falls back to printing the WHOLE string literally. One bad segment
  // poisons an entire prompt, which is why a single "2ab" put dollar signs on
  // a printed international-mindedness paragraph.
  //
  // Running toTypstMath over the generator's own spans is a no-op on any
  // segment that was already valid -- every run in it is a single letter, a
  // known identifier, a dotted symbol or a quoted operator -- and a repair on
  // the ones that were not.
  if (text.includes("$")) {
    const parts = text.split("$");
    if (parts.length % 2 === 0) return text;
    return parts
      .map((part, i) => (i % 2 === 0 ? typesetSegment(part) : toTypstMath(part)))
      .reduce((acc, part, i) => (i === 0 ? part : `${acc}$${part}`), "");
  }

  return typesetSegment(text);
}

/** Wraps math runs in one delimiter-free segment. */
function typesetSegment(segment: string): string {
  // Preserve the original whitespace exactly: split on the gaps, not the
  // tokens, so a double space or a newline survives the round trip.
  const pieces = segment.split(/(\s+)/);
  const kinds = pieces.map((p) => (/^\s+$/.test(p) ? "space" : classify(p)));

  const out: string[] = [];
  let i = 0;

  while (i < pieces.length) {
    if (kinds[i] !== "math") {
      out.push(pieces[i]);
      i += 1;
      continue;
    }

    // Walk backwards over neutrals already emitted, so "x = 5" starts at "x"
    // rather than at "5". Only whitespace and neutrals may be reclaimed.
    let start = i;
    while (start >= 2 && kinds[start - 1] === "space" && kinds[start - 2] === "neutral") {
      start -= 2;
    }

    // Walk forwards across everything that could belong to the expression.
    // Operands matter as much as operators here: "x^2 - 9" is three tokens
    // and only the first carries a math signal, so a walk that stopped at
    // the last SIGNALLING token would wrap "x^2" and leave "- 9" as prose.
    let scan = i;
    let lastMath = i;
    while (scan < pieces.length && kinds[scan] !== "prose") {
      if (kinds[scan] === "math") lastMath = scan;
      scan += 1;
    }

    // Then give back any trailing whitespace or dangling operator, so a span
    // ends on content and never on "=" or "+".
    let end = scan - 1;
    while (
      end > lastMath &&
      (kinds[end] === "space" || /^[+\-*/=<>|]+$/.test(pieces[end].replace(TRAILING_PUNCT, "")))
    ) {
      end -= 1;
    }

    // Drop whatever was already emitted for the reclaimed prefix.
    out.length -= i - start;

    const span = pieces.slice(start, end + 1).join("");
    const lead = span.match(LEADING_PUNCT)?.[0] ?? "";
    const tail = span.match(TRAILING_PUNCT)?.[0] ?? "";
    const core = span.slice(lead.length, span.length - tail.length);

    out.push(lead, core.length > 0 ? `$${toTypstMath(core)}$` : "", tail);
    i = end + 1;
  }

  return out.join("");
}

/** Every prose field on a question or subpart that should be typeset. */
type ProseBearing = Record<string, unknown>;

function typesetFields<T extends ProseBearing>(obj: T, fields: string[]): T {
  const next = { ...obj } as ProseBearing;
  for (const f of fields) {
    if (typeof next[f] === "string") next[f] = typesetMath(next[f] as string);
  }
  return next as T;
}

/**
 * Applies typesetMath across every student-visible and teacher-visible prose
 * field of an assignment draft.
 *
 * The field list is explicit rather than a deep walk over every string,
 * and that is deliberate. `contentTag` now carries CCSS codes for the
 * Grade 9 courses -- "HSA.SSE.A.2", "MP.7" -- which a generic walker would
 * read as variables joined by dots and italicise into nonsense. Tags,
 * identifiers and syllabus codes are label data, not mathematics, and are
 * left alone here on purpose.
 */
export function typesetDraftMath<T extends ProseBearing>(draft: T): T {
  const d = { ...draft } as ProseBearing;

  for (const f of ["title", "subtitle", "prerequisites", "materials", "atl", "compulsoryCore", "plantedErrorIntro"]) {
    if (typeof d[f] === "string") d[f] = typesetMath(d[f] as string);
  }

  if (Array.isArray(d.instructions)) {
    d.instructions = (d.instructions as unknown[]).map((s) => (typeof s === "string" ? typesetMath(s) : s));
  }
  if (Array.isArray(d.reflectionQuestions)) {
    d.reflectionQuestions = (d.reflectionQuestions as unknown[]).map((s) => (typeof s === "string" ? typesetMath(s) : s));
  }
  if (Array.isArray(d.tokProvocations)) {
    d.tokProvocations = (d.tokProvocations as unknown[]).map((t) =>
      t && typeof t === "object" ? typesetFields(t as ProseBearing, ["body"]) : t,
    );
  }
  if (d.internationalMindedness && typeof d.internationalMindedness === "object") {
    d.internationalMindedness = typesetFields(d.internationalMindedness as ProseBearing, ["body"]);
  }

  if (Array.isArray(d.sections)) {
    d.sections = (d.sections as ProseBearing[]).map((section) => {
      const s = { ...section };

      if (Array.isArray(s.questions)) {
        s.questions = (s.questions as ProseBearing[]).map((q) => {
          const nq = typesetFields(q, ["prompt", "hint", "answer", "markScheme"]);
          if (Array.isArray(nq.subparts)) {
            nq.subparts = (nq.subparts as ProseBearing[]).map((sp) =>
              typesetFields(sp, ["prompt", "hint", "answer", "markScheme"]),
            );
          }
          return nq;
        });
      }

      if (s.spotlight && typeof s.spotlight === "object") {
        s.spotlight = typesetFields(s.spotlight as ProseBearing, ["body"]);
      }
      if (s.geometricReading && typeof s.geometricReading === "object") {
        s.geometricReading = typesetFields(s.geometricReading as ProseBearing, ["body"]);
      }
      if (s.prerequisiteBox && typeof s.prerequisiteBox === "object") {
        const box = { ...(s.prerequisiteBox as ProseBearing) };
        if (Array.isArray(box.items)) {
          box.items = (box.items as unknown[]).map((x) => (typeof x === "string" ? typesetMath(x) : x));
        }
        s.prerequisiteBox = box;
      }
      if (s.translationTable && typeof s.translationTable === "object") {
        const tt = { ...(s.translationTable as ProseBearing) };
        if (Array.isArray(tt.rows)) {
          tt.rows = (tt.rows as ProseBearing[]).map((r) => typesetFields(r, ["informal", "formal"]));
        }
        s.translationTable = tt;
      }

      return s;
    });
  }

  return d as T;
}

/**
 * Reports prose fields that still contain undelimited mathematics.
 *
 * Fed to the sandbox's warning strip beside the command-term, numbering and
 * TOK validators. typesetDraftMath handles what it can prove; this surfaces
 * what it deliberately declined to touch, so a teacher sees it before the
 * PDF is printed rather than after.
 */
export function findUntypesetMath(draft: unknown): string[] {
  const issues: string[] = [];
  if (!draft || typeof draft !== "object") return issues;

  const sections = (draft as ProseBearing).sections;
  if (!Array.isArray(sections)) return issues;

  sections.forEach((section, si) => {
    const questions = (section as ProseBearing)?.questions;
    if (!Array.isArray(questions)) return;
    questions.forEach((q, qi) => {
      const prompt = (q as ProseBearing)?.prompt;
      if (typeof prompt !== "string") return;
      const outside = prompt.split("$").filter((_, i) => i % 2 === 0).join(" ");
      const pieces = outside.split(/\s+/);
      const bare = pieces.filter((p) => classify(p) === "math");
      if (bare.length > 0) {
        issues.push(
          `Part ${si + 1}, Q${qi + 1}: mathematics is not typeset — ${bare.slice(0, 3).join(", ")}`,
        );
      }
    });
  });

  return issues;
}
