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

import {
  isLatexMath,
  ESCAPED_DOLLAR,
  maskCurrency,
  unmaskCurrency,
  unwrapProseTextCommands,
} from "./latex-to-typst";

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

/** A single backslash, kept out of the string literals that need one. */
const BACKSLASH = String.fromCharCode(92);

// ESCAPED_DOLLAR / CURRENCY_MASK live beside TRUSTED_MATH_DELIM in
// latex-to-typst.ts: they are one delimiter convention, shared by every
// function on either side that splits a string on "$".

/**
 * Characters that may appear inside an unwrapped math token.
 *
 * The LaTeX four -- backslash and the two kinds of bracket -- are here
 * because packets are authored in LaTeX now, so a token in a $...$ span can
 * legitimately be "\frac{1}{2}" or "^{n}C_{r}". Without them such a token
 * failed this test, classified as prose, and was left on the legacy Typst
 * path where it aborts the document.
 */
const MATH_CHARS = /^[0-9A-Za-z^_+\-*/=().,<>!|{}[\]\\√±×÷≤≥≠]+$/;

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
 *
 * The IBDP half of the same idea, "S3E11", is here too, and it was missed the
 * first time round with a worse consequence than italics. Its letters are
 * never adjacent, so nothing downstream reads it as a word: hasMathSignal()
 * sees the "3E" and calls it mathematics, and the prelude's looks-like-math()
 * -- which only ever looks for runs of two or more LETTERS -- waves it
 * through to eval(), where "S3E11" is one unknown variable and takes the
 * whole document with it. A packet titled "Nuanced Analysis Packet S3E11"
 * simply would not print. See api/nuanced-analyses/route.ts for where both
 * code formats come from.
 */
const SECTION_REF = /^\(?(?:[A-Z]{1,2}\.\d{1,2}|S\d{1,2}E\d{1,2})\)?[.,;:]?$/;

/**
 * An ordinal: "12th", "1st", "21st". Prose, and it has to be said explicitly
 * because every one of them carries a digit glued to a letter, which is
 * otherwise the strongest math signal there is.
 *
 * Shipped defect this fixes: the B.4 packet's international-mindedness
 * paragraph read "working in the $12t h$ century", because "12th" was wrapped
 * as mathematics and then split into "12", "t", "h" to survive Typst. A
 * century is not an expression.
 */
const ORDINAL = /^\d+(?:st|nd|rd|th)$/i;

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
  const letters = (run: string): string => {
    if (run.length === 1) return run;
    const lower = run.toLowerCase();
    const alias = ALIAS_MAP.get(lower);
    if (alias) return alias;
    if (IDENT_SET.has(lower)) return run;
    return run.split("").join(" ");
  };

  return expr.replace(
    /"[^"]*"|[A-Za-z]+(?:\.[A-Za-z]+)+|[A-Za-z]+[0-9][A-Za-z0-9]*|[A-Za-z]+/g,
    (run) => {
      if (run.startsWith('"')) return run;   // quoted operator
      if (run.includes(".")) return run;     // dotted symbol name
      if (/[0-9]/.test(run)) {
        // A LETTER glued to a digit -- "m1", "A1", "S3E11", "x2". Typst lexes
        // the whole run as ONE identifier, and an unknown identifier does not
        // degrade: it aborts the document, so a subtitle reading "Packet
        // S3E11" stops the packet printing at all. Separating the pieces
        // renders identically and compiles.
        //
        // Only this direction is dangerous. A digit glued to a letter -- the
        // "6x" of "6x^2 + 11x + 3" -- already lexes as a number beside a
        // variable and is left exactly as written.
        return (run.match(/[0-9]+|[A-Za-z]+/g) ?? [])
          .map((piece) => (/^[0-9]/.test(piece) ? piece : letters(piece)))
          .join(" ");
      }
      return letters(run);
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
  if (/[A-Za-z0-9][+*=][A-Za-z0-9]/.test(token)) return true;  // ad+bc, x=3
  // A slash is the weak one of the four, because English uses it as
  // punctuation between whole words: "sum/product", "and/or", "km/h". It
  // counts as division only when neither side is a written word -- "x/y",
  // "3/4", "2x/3" all qualify; "sum/product" does not, and the B.4 packet
  // printed it as a sigma over a pi because both happen to be the names of
  // Typst's big operators.
  if (/[A-Za-z0-9]\/[A-Za-z0-9]/.test(token) && !/(^|\/)[A-Za-z]{2,}(\/|$)/.test(token)) {
    return true;
  }
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

  // An ordinal is a word. Checked before the signal tests below, which would
  // all read the digit-letter join in "12th" as mathematics.
  if (ORDINAL.test(token.replace(TRAILING_PUNCT, ""))) return "prose";

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

  // No letters at all, and every character one mathematics uses: "4)", "(2",
  // "12,". English has no such word, so it can never be the thing that ends a
  // span -- and when it was, it ended one mid-bracket. "25p + 18(p + 4)" was
  // cut after "18(p" because ")" carried no letters and fell through to prose.
  if (letters.length === 0) return "neutral";

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
 * Does every bracket this span opens get closed inside it?
 *
 * A span that does not is the A.2 defect: "the expression 25p + 18(p + 4)
 * represents" was cut after "18(p", because the ")" of "4)" carries no
 * letters and classifies as prose. That left an unclosed bracket in one span
 * and, further along the same sentence, started the NEXT span at a bare "/",
 * which is not an expression at all -- Typst answered "unexpected slash" and
 * refused to print the packet.
 */
function bracketsBalanced(text: string): boolean {
  const closes: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const open: string[] = [];
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") open.push(ch);
    else if (ch in closes && open.pop() !== closes[ch]) return false;
  }
  return open.length === 0;
}

/**
 * Is what the author put between two dollar signs actually mathematics?
 *
 * Deliberately NOT the identifier check the Typst prelude's looks-like-math()
 * runs. That one rejects any multi-letter run Typst does not define, which
 * would throw out "a^2+2ab+b^2" -- the juxtaposed-product span that repairing
 * generator output is FOR. This asks the weaker and more useful question: is
 * there a token in here that is plainly English? One is enough, because a
 * real equation has none.
 */
function segmentIsMath(segment: string): boolean {
  return !segment
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .some((t) => classify(t) === "prose");
}

/**
 * Would the Typst prelude's looks-like-math() evaluate this span, or refuse it?
 *
 * A TS mirror of the gate in typst-render.service.ts, reading the same two
 * tables so the two cannot drift on WHICH identifiers count. It is not a
 * second opinion about what is mathematics -- it is the same opinion, asked
 * on this side of the wire, so a caller can know in advance that a span would
 * be printed with its dollar signs rather than typeset.
 */
export function typstGateAccepts(span: string): boolean {
  // Quoted spans are literal text in Typst math, so their words are fine.
  const unquoted = span.replace(/"[^"]*"/g, " ");
  // A letter glued to a digit is one identifier, and an unknown one aborts.
  if (/[A-Za-z][A-Za-z0-9]*[0-9]/.test(unquoted)) return false;
  // An attachment with nothing to attach to. Typst answers "unexpected hat"
  // and refuses the document; LaTeX is perfectly happy with it, which is how
  // "$^{n}C_{r}$" -- a GDC button, written the way the calculator prints it --
  // got into a packet. The converter gives it a zero-width base instead.
  if (/(^|[\s(\[{,;+\-*/=])[\^_]/.test(unquoted)) return false;
  // "^{...}" is LaTeX grouping, and Typst PRINTS those braces rather than
  // reading them as an exponent: "$(4+x)^{1/2}$" -- which has no backslash in
  // it, so nothing else here calls it LaTeX -- came out as "(4+x){1 2}" on
  // the binomial packet's page. Typst spells the same thing "^(1/2)", so a
  // brace attached to an attachment is never Typst and always LaTeX.
  if (/[\^_]\s*\{/.test(unquoted)) return false;
  // A dotted path is ONE Typst symbol -- "arrow.l.r.double" is the double
  // left-right arrow -- and its modifiers are not identifiers in their own
  // right. Checking them as if they were rejected the span for "double", and
  // the span in question is one this module WROTE: toTypstMath() expands the
  // word "iff" to exactly that arrow, so the Factor Theorem in the polynomial
  // packet was typeset and then refused, and printed as its own source code.
  // Only the head has to be known.
  const paths = unquoted.replace(/[A-Za-z]+(?:\.[A-Za-z]+)+/g, (run) => run.split(".")[0]);
  for (const run of paths.match(/[A-Za-z]{2,}/g) ?? []) {
    if (!IDENT_SET.has(run.toLowerCase())) return false;
  }
  return true;
}

/**
 * Should this span be handed to the LaTeX-to-Typst converter?
 *
 * A backslash settles it: that is LaTeX and nothing else. The interesting
 * case is a span with NO backslash, which is one of three things:
 *
 *   1. legacy Typst syntax from a packet written before the switch
 *      ("a div b := a times 1/b", "macron(x)", "cos((3pi)/2)")
 *   2. prose whose dollar signs paired up by accident
 *      ("2.50 per package and pens cost ")
 *   3. LaTeX that simply needed no command -- "A = ac", "a^2+2ab+b^2",
 *      "Ax^2+Bx+C" -- which is most of the algebra in a Grade 9 packet
 *
 * The first renders correctly as it stands and must be left alone. The second
 * must be left alone too, and printed verbatim, which is what the gate
 * refusing it achieves. Only the third is a problem: the gate refuses it as
 * well, because "ac" and "Ax" are unknown Typst identifiers, so it reaches
 * the page as its own source code with the dollar signs showing.
 *
 * So: convert when the Typst side would refuse the span AND the span is not
 * prose. Both halves are load-bearing. Without the first, legacy packets get
 * re-read as LaTeX and "div" becomes "d i v". Without the second, a sentence
 * about the price of pencils is typeset one italic letter at a time.
 */
export function spanIsForLatexConversion(span: string): boolean {
  if (isLatexMath(span)) return true;
  if (typstGateAccepts(span)) return false;
  return segmentIsMath(span);
}

/**
 * Wraps the unwrapped mathematics in `text` with Typst `$...$` delimiters.
 *
 * Pure and idempotent: running it twice produces the same string, because
 * anything already inside $...$ is copied through untouched.
 */
/**
 * Escapes a "$" that is a currency sign rather than a math delimiter.
 *
 * The A.1 packet is set at a ticket window, so it prices things: "$60 per
 * adult", "$120 in total", "exactly $570". Thirteen of its lines carry one
 * such amount and nothing else with a dollar in it, which leaves an ODD
 * number of "$" in the line -- and both ends of the pipeline give up on a
 * line like that. typesetMath() returned it untouched (so "60a + 30c" in the
 * same sentence never became mathematics at all), and rich-legacy() printed
 * the whole string verbatim. The packet was priced correctly and had no
 * mathematics typeset anywhere near a price.
 *
 * Pairing greedily from the left is what tells the two apart, and it is the
 * same question rich-legacy() already asks: does the text between this "$"
 * and the next one read as mathematics? If it does, they are delimiters and
 * both are left alone. If it does not -- "60 for an adult and " -- the
 * opening one is a dollar sign, and escaping it lets the NEXT "$" try again
 * against the one after it. That is what keeps a line that carries both
 * kinds intact:
 *
 *   cost $60 for an adult and $30 for a child, so the total is $60a + 30c$
 *   cost \$60 for an adult and \$30 for a child, so the total is $60a + 30c$
 *
 * A "$" with no partner at all is a dollar sign by the same reasoning.
 */
function escapeCurrencyDollars(text: string): string {
  if (!text.includes("$")) return text;

  const out: string[] = [];
  let i = 0;
  for (;;) {
    const open = text.indexOf("$", i);
    if (open === -1) {
      out.push(text.slice(i));
      return out.join("");
    }
    // An author who already escaped it has settled the question.
    if (open > 0 && text[open - 1] === BACKSLASH) {
      out.push(text.slice(i, open + 1));
      i = open + 1;
      continue;
    }

    const close = text.indexOf("$", open + 1);
    const span = close === -1 ? null : text.slice(open + 1, close);
    // Every test that could call this span mathematics, because escaping is
    // destructive and this function runs on its own output: typesetDraftMath
    // re-typesets already-typeset content at render time, so a delimiter it
    // fails to recognise the second time round gets escaped into a dollar
    // sign and the span stops being mathematics. That is not hypothetical --
    // "$P(r)=0 arrow.l.r.double$" is a span this module WROTE (toTypstMath
    // expands "iff"), and segmentIsMath alone reads the arrow's modifiers as
    // four prose words. typstGateAccepts knows better, so it is asked too.
    //
    // "$$" is a display delimiter, not an empty span, and is not ours to
    // touch; convertLatexSegmentsToTypst normalises it before we see it.
    const isDelimiter =
      span !== null &&
      (span === "" || isLatexMath(span) || typstGateAccepts(span) || segmentIsMath(span));

    if (isDelimiter) {
      out.push(text.slice(i, (close as number) + 1));
      i = (close as number) + 1;
      continue;
    }

    out.push(text.slice(i, open), BACKSLASH, "$");
    i = open + 1;
  }
}

export function typesetMath(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;

  // Settle what each "$" IS before counting them, then hide the ones that
  // turned out to be currency. Until this ran, a lone price made the count
  // odd and the whole line was handed back untypeset -- see
  // escapeCurrencyDollars above for what that cost A.1.
  // Prose styling first: \textit{...} can WRAP math spans, so its braces
  // have to go before anything starts counting delimiters.
  const masked = maskCurrency(escapeCurrencyDollars(unwrapProseTextCommands(text)));
  return unmaskCurrency(typesetDelimited(masked));
}

/** typesetMath's body, with every remaining "$" known to be a delimiter. */
function typesetDelimited(text: string): string {

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
      .map((part, i) => {
        if (i % 2 === 0) return typesetSegment(part);
        // A segment the generator wrote in LaTeX is already correct and is
        // not ours to repair. toTypstMath() would shred it -- every letter of
        // \frac is a letter, so "\frac{3\pi}{2}" comes back as "\f r a c{3\p i}
        // {2}" -- and the draft is stored in LaTeX now, because that is what
        // the preview renders. latex-to-typst.ts converts it at render time.
        if (isLatexMath(part)) return part;
        // Nor is a segment that is not mathematics at all. Two currency
        // amounts in one sentence pair their dollar signs into a span that
        // was never an equation -- "Pencils cost $2.50 per package and pens
        // cost $3" -- and splitting its letter runs would turn the prose
        // between them into "p e r p a c k a g e". rich() refuses to evaluate
        // such a span and prints it verbatim; this leaves it something worth
        // printing.
        return segmentIsMath(part) ? toTypstMath(part) : part;
      })
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

    // A span must close every bracket it opens, and must not end on an
    // operator -- and fixing either can break the other, so they are settled
    // together. Shrinking from the right is the safe direction: the pieces
    // given back become ordinary prose, which is this module's whole posture.
    for (;;) {
      const before = end;
      while (end > lastMath && !bracketsBalanced(pieces.slice(start, end + 1).join(""))) end -= 1;
      while (
        end > lastMath &&
        (kinds[end] === "space" || /^[+\-*/=<>|]+$/.test(pieces[end].replace(TRAILING_PUNCT, "")))
      ) {
        end -= 1;
      }
      if (end === before) break;
    }

    // And it must not OPEN on an operator. The trailing-operator walk above
    // has always existed; without its mirror, "... + 4)) / 25p would" starts
    // a span at the slash.
    let from = start;
    while (
      from < end &&
      (kinds[from] === "space" || /^[+\-*/=<>|]+$/.test(pieces[from].replace(LEADING_PUNCT, "")))
    ) {
      from += 1;
    }

    // Still unbalanced after all that, or nothing left worth wrapping: leave
    // the whole run as the prose it came in as.
    if (from > end || !bracketsBalanced(pieces.slice(from, end + 1).join(""))) {
      for (let k = i; k <= end && k < pieces.length; k += 1) out.push(pieces[k]);
      i = end + 1;
      continue;
    }
    start = from;

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

/** A transform applied to one prose string. */
type ProseFn = (text: string) => string;

function mapFields<T extends ProseBearing>(obj: T, fields: string[], fn: ProseFn): T {
  const next = { ...obj } as ProseBearing;
  for (const f of fields) {
    if (typeof next[f] === "string") next[f] = fn(next[f] as string);
  }
  return next as T;
}

/**
 * Applies `fn` to every student-visible and teacher-visible prose field of an
 * assignment draft, and to nothing else.
 *
 * The field list is explicit rather than a deep walk over every string,
 * and that is deliberate. `contentTag` now carries CCSS codes for the
 * Grade 9 courses -- "HSA.SSE.A.2", "MP.7" -- which a generic walker would
 * read as variables joined by dots and italicise into nonsense. Tags,
 * identifiers and syllabus codes are label data, not mathematics, and are
 * left alone here on purpose.
 *
 * Two passes share this walk, and they must agree on the field list or the
 * second would miss a field the first had filled with mathematics:
 *   - typesetDraftMath(), which puts $...$ round mathematics that has none
 *   - the LaTeX-to-Typst conversion in typst-payload.ts, which rewrites that
 *     mathematics into what the PDF compiler evaluates
 *
 * Every field named here is one the Typst template renders through rich(),
 * which is the only place a $...$ span means anything. A field rendered any
 * other way must NOT be added: it would be handed a converted span it cannot
 * typeset.
 */
export function mapDraftProse<T extends ProseBearing>(draft: T, fn: ProseFn): T {
  const d = { ...draft } as ProseBearing;
  const mapStrings = (arr: unknown[]) =>
    arr.map((s) => (typeof s === "string" ? fn(s) : s));

  for (const f of [
    "title", "subtitle", "syllabusTopics", "prerequisites", "materials",
    "atl", "compulsoryCore", "plantedErrorIntro",
  ]) {
    if (typeof d[f] === "string") d[f] = fn(d[f] as string);
  }

  if (Array.isArray(d.instructions)) d.instructions = mapStrings(d.instructions as unknown[]);
  if (Array.isArray(d.reflectionQuestions)) {
    d.reflectionQuestions = mapStrings(d.reflectionQuestions as unknown[]);
  }
  if (Array.isArray(d.commandTerms)) {
    d.commandTerms = (d.commandTerms as unknown[]).map((t) =>
      t && typeof t === "object" ? mapFields(t as ProseBearing, ["term", "definition"], fn) : t,
    );
  }
  if (Array.isArray(d.tokProvocations)) {
    d.tokProvocations = (d.tokProvocations as unknown[]).map((t) =>
      t && typeof t === "object" ? mapFields(t as ProseBearing, ["body"], fn) : t,
    );
  }
  if (d.internationalMindedness && typeof d.internationalMindedness === "object") {
    d.internationalMindedness = mapFields(d.internationalMindedness as ProseBearing, ["body"], fn);
  }

  if (Array.isArray(d.sections)) {
    d.sections = (d.sections as ProseBearing[]).map((section) => {
      const s = { ...section };

      if (Array.isArray(s.questions)) {
        s.questions = (s.questions as ProseBearing[]).map((q) => {
          const nq = mapFields(q, ["prompt", "hint", "answer", "markScheme"], fn);
          if (Array.isArray(nq.subparts)) {
            nq.subparts = (nq.subparts as ProseBearing[]).map((sp) =>
              mapFields(sp, ["prompt", "hint", "answer", "markScheme"], fn),
            );
          }
          return nq;
        });
      }

      if (s.spotlight && typeof s.spotlight === "object") {
        s.spotlight = mapFields(s.spotlight as ProseBearing, ["body"], fn);
      }
      if (s.geometricReading && typeof s.geometricReading === "object") {
        s.geometricReading = mapFields(s.geometricReading as ProseBearing, ["body"], fn);
      }
      if (s.prerequisiteBox && typeof s.prerequisiteBox === "object") {
        const box = { ...(s.prerequisiteBox as ProseBearing) };
        if (Array.isArray(box.items)) box.items = mapStrings(box.items as unknown[]);
        s.prerequisiteBox = box;
      }
      if (s.translationTable && typeof s.translationTable === "object") {
        const tt = { ...(s.translationTable as ProseBearing) };
        if (Array.isArray(tt.rows)) {
          tt.rows = (tt.rows as ProseBearing[]).map((r) => mapFields(r, ["informal", "formal"], fn));
        }
        s.translationTable = tt;
      }

      return s;
    });
  }

  return d as T;
}

/**
 * Wraps the undelimited mathematics in every prose field of a draft.
 */
export function typesetDraftMath<T extends ProseBearing>(draft: T): T {
  return mapDraftProse(draft, typesetMath);
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
