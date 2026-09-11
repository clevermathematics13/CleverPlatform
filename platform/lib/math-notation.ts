/**
 * What the notation editor offers a student, and where each thing lives.
 *
 * The organising rule, and the reason this is data rather than markup: the
 * notation a DP student reaches for many times an hour is ALWAYS ON SCREEN,
 * and everything else is one click away behind "Advanced notation". A palette
 * that shows a student every symbol in the syllabus at once is a palette they
 * have to read rather than use -- and the ones they actually need (a fraction,
 * a power, an integral) get no more prominence than the Fraktur alphabet.
 *
 * So: BASIC is deliberately short and stays short. Adding to it is a decision
 * about what a student sees every single time they answer a question, and the
 * bar is "would a Year 12 use this most days". Everything else goes in
 * ADVANCED, which is grouped by topic because that is how someone hunting for
 * a symbol thinks -- "it's a vectors thing" -- rather than alphabetically.
 *
 * `insert` is LaTeX for MathLive. `#?` is its placeholder token: the cursor
 * lands on the first one, and Tab moves between them. `preview` is what the
 * button shows, rendered with KaTeX -- so a student picks a fraction by
 * looking at a fraction, not at the word "frac".
 */

export interface NotationItem {
  /** Stable id, unique across the whole palette. */
  id: string;
  /** LaTeX inserted into the field. */
  insert: string;
  /** LaTeX drawn on the button. Falls back to `insert` when omitted. */
  preview?: string;
  /** Tooltip and screen-reader name. Every item needs one. */
  label: string;
}

export interface NotationGroup {
  id: string;
  /** Shown as the group heading in the advanced panel. */
  title: string;
  items: NotationItem[];
}

/**
 * Always visible, above the fold, no clicking to reach.
 *
 * Six small groups rather than one long row, because a flat strip of thirty
 * buttons is scanned linearly and a grouped one is scanned by shape.
 */
export const BASIC_NOTATION: NotationGroup[] = [
  {
    id: "structure",
    title: "Structure",
    items: [
      { id: "frac", insert: "\\frac{#?}{#?}", preview: "\\frac{a}{b}", label: "Fraction" },
      { id: "sup", insert: "#?^{#?}", preview: "x^{n}", label: "Power" },
      { id: "square", insert: "#?^{2}", preview: "x^{2}", label: "Squared" },
      { id: "sub", insert: "#?_{#?}", preview: "x_{n}", label: "Subscript" },
      { id: "sqrt", insert: "\\sqrt{#?}", preview: "\\sqrt{x}", label: "Square root" },
      { id: "nthroot", insert: "\\sqrt[#?]{#?}", preview: "\\sqrt[n]{x}", label: "nth root" },
      { id: "paren", insert: "\\left(#?\\right)", preview: "(\\,)", label: "Brackets" },
      { id: "abs", insert: "\\left|#?\\right|", preview: "|x|", label: "Absolute value" },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    items: [
      { id: "times", insert: "\\times", label: "Multiply" },
      { id: "div", insert: "\\div", label: "Divide" },
      { id: "cdot", insert: "\\cdot", label: "Dot multiply" },
      { id: "pm", insert: "\\pm", label: "Plus or minus" },
    ],
  },
  {
    id: "relations",
    title: "Relations",
    items: [
      { id: "eq", insert: "=", label: "Equals" },
      { id: "neq", insert: "\\neq", label: "Not equal to" },
      { id: "approx", insert: "\\approx", label: "Approximately equal to" },
      { id: "lt", insert: "<", label: "Less than" },
      { id: "gt", insert: ">", label: "Greater than" },
      { id: "le", insert: "\\le", label: "Less than or equal to" },
      { id: "ge", insert: "\\ge", label: "Greater than or equal to" },
    ],
  },
  {
    id: "constants",
    title: "Constants",
    items: [
      { id: "pi", insert: "\\pi", label: "Pi" },
      { id: "e", insert: "\\mathrm{e}", preview: "\\mathrm{e}", label: "Euler's number" },
      { id: "theta", insert: "\\theta", label: "Theta" },
      { id: "infty", insert: "\\infty", label: "Infinity" },
      { id: "degree", insert: "^{\\circ}", preview: "{}^{\\circ}", label: "Degrees" },
    ],
  },
  {
    id: "functions",
    title: "Functions",
    items: [
      { id: "sin", insert: "\\sin(#?)", preview: "\\sin", label: "Sine" },
      { id: "cos", insert: "\\cos(#?)", preview: "\\cos", label: "Cosine" },
      { id: "tan", insert: "\\tan(#?)", preview: "\\tan", label: "Tangent" },
      { id: "ln", insert: "\\ln(#?)", preview: "\\ln", label: "Natural logarithm" },
      { id: "log", insert: "\\log(#?)", preview: "\\log", label: "Logarithm base 10" },
      { id: "logb", insert: "\\log_{#?}(#?)", preview: "\\log_{b}", label: "Logarithm, any base" },
      { id: "exp", insert: "\\mathrm{e}^{#?}", preview: "\\mathrm{e}^{x}", label: "e to a power" },
    ],
  },
  {
    id: "calculus",
    title: "Calculus",
    items: [
      { id: "int", insert: "\\int #? \\,d#?", preview: "\\int", label: "Integral" },
      {
        id: "defint",
        insert: "\\int_{#?}^{#?} #? \\,d#?",
        preview: "\\int_{a}^{b}",
        label: "Definite integral",
      },
      { id: "dydx", insert: "\\frac{dy}{dx}", preview: "\\frac{dy}{dx}", label: "Derivative dy/dx" },
      {
        id: "ddx",
        insert: "\\frac{d}{dx}\\left(#?\\right)",
        preview: "\\frac{d}{dx}",
        label: "Differentiate with respect to x",
      },
      { id: "fprime", insert: "f'(#?)", preview: "f'(x)", label: "f prime" },
      { id: "sum", insert: "\\sum_{#?}^{#?} #?", preview: "\\sum", label: "Sum" },
    ],
  },
];

/**
 * Everything else, behind one click, grouped the way someone hunting for a
 * symbol thinks about it.
 */
export const ADVANCED_NOTATION: NotationGroup[] = [
  {
    id: "adv-calculus",
    title: "Calculus and analysis",
    items: [
      {
        id: "d2ydx2",
        insert: "\\frac{d^{2}y}{dx^{2}}",
        preview: "\\frac{d^{2}y}{dx^{2}}",
        label: "Second derivative",
      },
      { id: "fdprime", insert: "f''(#?)", preview: "f''(x)", label: "f double prime" },
      { id: "partial", insert: "\\frac{\\partial #?}{\\partial #?}", preview: "\\partial", label: "Partial derivative" },
      { id: "limit", insert: "\\lim_{#? \\to #?} #?", preview: "\\lim", label: "Limit" },
      {
        id: "evalbar",
        insert: "\\left[#?\\right]_{#?}^{#?}",
        preview: "\\left[\\;\\right]_{a}^{b}",
        label: "Evaluate between limits",
      },
      { id: "prod", insert: "\\prod_{#?}^{#?} #?", preview: "\\prod", label: "Product" },
      { id: "to", insert: "\\to", label: "Tends to" },
      { id: "approaches", insert: "\\pm\\infty", preview: "\\pm\\infty", label: "Plus or minus infinity" },
    ],
  },
  {
    id: "adv-vectors",
    title: "Vectors and matrices",
    items: [
      {
        id: "vec2",
        insert: "\\begin{pmatrix}#?\\\\#?\\end{pmatrix}",
        preview: "\\begin{pmatrix}a\\\\b\\end{pmatrix}",
        label: "Column vector, two rows",
      },
      {
        id: "vec3",
        insert: "\\begin{pmatrix}#?\\\\#?\\\\#?\\end{pmatrix}",
        preview: "\\begin{pmatrix}a\\\\b\\\\c\\end{pmatrix}",
        label: "Column vector, three rows",
      },
      {
        id: "mat22",
        insert: "\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}",
        preview: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
        label: "Two by two matrix",
      },
      {
        id: "det",
        insert: "\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}",
        preview: "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}",
        label: "Determinant",
      },
      { id: "boldvec", insert: "\\boldsymbol{#?}", preview: "\\boldsymbol{a}", label: "Vector, bold" },
      {
        id: "arrowvec",
        insert: "\\overrightarrow{#?}",
        preview: "\\overrightarrow{AB}",
        label: "Vector, arrow notation",
      },
      { id: "dotprod", insert: "\\boldsymbol{\\cdot}", preview: "\\boldsymbol{\\cdot}", label: "Scalar (dot) product" },
      { id: "crossprod", insert: "\\times", preview: "\\boldsymbol{\\times}", label: "Vector (cross) product" },
      { id: "magnitude", insert: "\\left|#?\\right|", preview: "|\\boldsymbol{a}|", label: "Magnitude" },
    ],
  },
  {
    id: "adv-sets",
    title: "Sets and number systems",
    items: [
      { id: "in", insert: "\\in", label: "Is an element of" },
      { id: "notin", insert: "\\notin", label: "Is not an element of" },
      { id: "subset", insert: "\\subset", label: "Is a subset of" },
      { id: "subseteq", insert: "\\subseteq", label: "Is a subset of or equal to" },
      { id: "cup", insert: "\\cup", label: "Union" },
      { id: "cap", insert: "\\cap", label: "Intersection" },
      { id: "emptyset", insert: "\\varnothing", preview: "\\varnothing", label: "Empty set" },
      { id: "naturals", insert: "\\mathbb{N}", label: "Natural numbers" },
      { id: "integers", insert: "\\mathbb{Z}", label: "Integers" },
      { id: "rationals", insert: "\\mathbb{Q}", label: "Rational numbers" },
      { id: "reals", insert: "\\mathbb{R}", label: "Real numbers" },
      { id: "complexset", insert: "\\mathbb{C}", label: "Complex numbers" },
      { id: "setbuild", insert: "\\left\\{#? : #?\\right\\}", preview: "\\{x:P\\}", label: "Set builder" },
    ],
  },
  {
    id: "adv-logic",
    title: "Logic and reasoning",
    items: [
      { id: "implies", insert: "\\Rightarrow", label: "Implies" },
      { id: "impliedby", insert: "\\Leftarrow", label: "Is implied by" },
      { id: "iff", insert: "\\Leftrightarrow", label: "If and only if" },
      { id: "forall", insert: "\\forall", label: "For all" },
      { id: "exists", insert: "\\exists", label: "There exists" },
      { id: "land", insert: "\\land", label: "And" },
      { id: "lor", insert: "\\lor", label: "Or" },
      { id: "lnot", insert: "\\neg", label: "Not" },
      { id: "therefore", insert: "\\therefore", label: "Therefore" },
    ],
  },
  {
    id: "adv-complex",
    title: "Complex numbers",
    items: [
      { id: "imag", insert: "\\mathrm{i}", preview: "\\mathrm{i}", label: "Imaginary unit" },
      { id: "conj", insert: "\\overline{#?}", preview: "\\overline{z}", label: "Complex conjugate" },
      { id: "modz", insert: "\\left|#?\\right|", preview: "|z|", label: "Modulus" },
      { id: "argz", insert: "\\arg(#?)", preview: "\\arg z", label: "Argument" },
      { id: "rez", insert: "\\operatorname{Re}(#?)", preview: "\\operatorname{Re}", label: "Real part" },
      { id: "imz", insert: "\\operatorname{Im}(#?)", preview: "\\operatorname{Im}", label: "Imaginary part" },
      { id: "cis", insert: "\\operatorname{cis}#?", preview: "\\operatorname{cis}\\theta", label: "cis theta" },
      {
        id: "polarform",
        insert: "#?\\left(\\cos #? + \\mathrm{i}\\sin #?\\right)",
        preview: "r(\\cos\\theta+\\mathrm{i}\\sin\\theta)",
        label: "Modulus-argument form",
      },
      { id: "eulerform", insert: "#?\\mathrm{e}^{\\mathrm{i}#?}", preview: "r\\mathrm{e}^{\\mathrm{i}\\theta}", label: "Euler form" },
    ],
  },
  {
    id: "adv-stats",
    title: "Probability and statistics",
    items: [
      { id: "prob", insert: "\\mathrm{P}(#?)", preview: "\\mathrm{P}(A)", label: "Probability" },
      {
        id: "condprob",
        insert: "\\mathrm{P}(#? \\mid #?)",
        preview: "\\mathrm{P}(A\\mid B)",
        label: "Conditional probability",
      },
      { id: "ncr", insert: "\\binom{#?}{#?}", preview: "\\binom{n}{r}", label: "Binomial coefficient" },
      { id: "npr", insert: "{}^{#?}P_{#?}", preview: "{}^{n}P_{r}", label: "Permutations" },
      { id: "factorial", insert: "#?!", preview: "n!", label: "Factorial" },
      { id: "mean", insert: "\\bar{#?}", preview: "\\bar{x}", label: "Sample mean" },
      { id: "mu", insert: "\\mu", label: "Population mean" },
      { id: "sigma", insert: "\\sigma", label: "Standard deviation" },
      { id: "variance", insert: "\\sigma^{2}", preview: "\\sigma^{2}", label: "Variance" },
      { id: "expect", insert: "\\mathrm{E}(#?)", preview: "\\mathrm{E}(X)", label: "Expected value" },
    ],
  },
  {
    id: "adv-trig",
    title: "More trigonometry",
    items: [
      { id: "arcsin", insert: "\\arcsin(#?)", preview: "\\arcsin", label: "Inverse sine" },
      { id: "arccos", insert: "\\arccos(#?)", preview: "\\arccos", label: "Inverse cosine" },
      { id: "arctan", insert: "\\arctan(#?)", preview: "\\arctan", label: "Inverse tangent" },
      { id: "sec", insert: "\\sec(#?)", preview: "\\sec", label: "Secant" },
      { id: "csc", insert: "\\csc(#?)", preview: "\\csc", label: "Cosecant" },
      { id: "cot", insert: "\\cot(#?)", preview: "\\cot", label: "Cotangent" },
      { id: "sinh", insert: "\\sinh(#?)", preview: "\\sinh", label: "Hyperbolic sine" },
      { id: "cosh", insert: "\\cosh(#?)", preview: "\\cosh", label: "Hyperbolic cosine" },
      { id: "tanh", insert: "\\tanh(#?)", preview: "\\tanh", label: "Hyperbolic tangent" },
      { id: "radians", insert: "\\text{ rad}", preview: "\\text{rad}", label: "Radians" },
    ],
  },
  {
    id: "adv-greek",
    title: "Greek letters",
    items: [
      { id: "alpha", insert: "\\alpha", label: "Alpha" },
      { id: "beta", insert: "\\beta", label: "Beta" },
      { id: "gamma", insert: "\\gamma", label: "Gamma" },
      { id: "delta", insert: "\\delta", label: "Delta" },
      { id: "epsilon", insert: "\\varepsilon", preview: "\\varepsilon", label: "Epsilon" },
      { id: "lambda", insert: "\\lambda", label: "Lambda" },
      { id: "rho", insert: "\\rho", label: "Rho" },
      { id: "tau", insert: "\\tau", label: "Tau" },
      { id: "phi", insert: "\\phi", label: "Phi" },
      { id: "omega", insert: "\\omega", label: "Omega" },
      { id: "Delta", insert: "\\Delta", label: "Capital delta" },
      { id: "Sigma", insert: "\\Sigma", label: "Capital sigma" },
      { id: "Omega", insert: "\\Omega", label: "Capital omega" },
    ],
  },
  {
    id: "adv-misc",
    title: "Other notation",
    items: [
      { id: "equiv", insert: "\\equiv", label: "Is identical to" },
      { id: "propto", insert: "\\propto", label: "Is proportional to" },
      { id: "sim", insert: "\\sim", label: "Is distributed as" },
      { id: "cong", insert: "\\cong", label: "Is congruent to" },
      { id: "floor", insert: "\\left\\lfloor #? \\right\\rfloor", preview: "\\lfloor x \\rfloor", label: "Floor" },
      { id: "ceil", insert: "\\left\\lceil #? \\right\\rceil", preview: "\\lceil x \\rceil", label: "Ceiling" },
      {
        id: "cases",
        insert: "\\begin{cases}#? & #?\\\\#? & #?\\end{cases}",
        preview: "\\begin{cases}a\\\\b\\end{cases}",
        label: "Piecewise function",
      },
      { id: "angle", insert: "\\angle", label: "Angle" },
      { id: "triangle", insert: "\\triangle", label: "Triangle" },
      { id: "perp", insert: "\\perp", label: "Is perpendicular to" },
      { id: "parallel", insert: "\\parallel", label: "Is parallel to" },
      { id: "text", insert: "\\text{#?}", preview: "\\text{abc}", label: "Words" },
    ],
  },
];

/** Every item in the palette, both halves, for checks that must cover all of it. */
export function allNotationItems(): NotationItem[] {
  return [...BASIC_NOTATION, ...ADVANCED_NOTATION].flatMap((g) => g.items);
}

/** What a button draws: its own preview, or its insert text when it needs no gloss. */
export function previewLatex(item: NotationItem): string {
  return item.preview ?? item.insert;
}
