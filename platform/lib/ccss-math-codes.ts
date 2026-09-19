/**
 * ccss-math-codes.ts
 * -----------------------------------------------------------------------------
 * Which Common Core Math standard codes are real, so a Grade 9 Standard Level
 * rubric (lib/standards-rubric.ts) can reject a typo'd or invented one instead
 * of accepting any string. Source of truth is the official document stored at
 * docs/standards/ccss-math/Common_Core_State_Standards_for_Mathematics.pdf;
 * CCSS_MATH_DOMAINS below was read off that document's own domain headers
 * (each one is a "<domain name>  <CODE>" line, unambiguous regardless of how
 * a cluster's standards are numbered).
 *
 * Scoped to Grades 6-8 and High School, plus the 8 Standards for Mathematical
 * Practice (MP1-MP8) -- the only ranges a Grade 9 course legitimately cites.
 * K-5 domains are deliberately left out: a K-5 code on a Grade 9 rubric is a
 * mistake worth surfacing, not a case to support silently. Grade 9 itself has
 * no domain codes of its own in CCSS -- grade 9 content lives under the High
 * School domains (A-*, F-*, G-*, N-*, S-*), which is exactly why "9.EE.A.1"
 * correctly fails validation here (it isn't a real code; the equivalent
 * content is under a High School domain).
 *
 * What this validates: the CODE prefix of a standards[] entry ("F-LE.A.2 Build
 * a linear rule from ..." -> "F-LE.A.2") is grammatically well-formed AND its
 * domain is real. It does NOT verify that the cluster letter or standard
 * number after the domain is a real one -- that would need an exact parse of
 * every standard in the document, which its layout (no cluster letters
 * printed in the body text; they're an external convention) does not make
 * reliable to automate without risking wrong data presented as authoritative.
 * So "F-LE.Z.99" passes structurally (a plausible-looking wrong cluster/
 * number within a real domain is not caught), but "F-LE.A.2" with the domain
 * misspelled, or from a domain that does not exist, or from Grade 9/K-5 (no
 * such domains), is caught. That is still the overwhelming majority of
 * realistic mistakes -- an AI-authored rubric hallucinating a domain, or a
 * teacher typing "9.EE.A.1" out of habit -- without pretending to a precision
 * this module cannot honestly deliver.
 */

/** Domain code -> its official name, for grades 6-8 and every High School conceptual category. */
export const CCSS_MATH_DOMAINS: Readonly<Record<string, string>> = {
  // Grade 6
  "6.RP": "Ratios and Proportional Relationships",
  "6.NS": "The Number System",
  "6.EE": "Expressions and Equations",
  "6.G": "Geometry",
  "6.SP": "Statistics and Probability",
  // Grade 7
  "7.RP": "Ratios and Proportional Relationships",
  "7.NS": "The Number System",
  "7.EE": "Expressions and Equations",
  "7.G": "Geometry",
  "7.SP": "Statistics and Probability",
  // Grade 8
  "8.NS": "The Number System",
  "8.EE": "Expressions and Equations",
  "8.F": "Functions",
  "8.G": "Geometry",
  "8.SP": "Statistics and Probability",
  // High School -- Number and Quantity
  "N-RN": "The Real Number System",
  "N-Q": "Quantities",
  "N-CN": "The Complex Number System",
  "N-VM": "Vector and Matrix Quantities",
  // High School -- Algebra
  "A-SSE": "Seeing Structure in Expressions",
  "A-APR": "Arithmetic with Polynomials and Rational Expressions",
  "A-CED": "Creating Equations",
  "A-REI": "Reasoning with Equations and Inequalities",
  // High School -- Functions
  "F-IF": "Interpreting Functions",
  "F-BF": "Building Functions",
  "F-LE": "Linear, Quadratic, and Exponential Models",
  "F-TF": "Trigonometric Functions",
  // High School -- Geometry
  "G-CO": "Congruence",
  "G-SRT": "Similarity, Right Triangles, and Trigonometry",
  "G-C": "Circles",
  "G-GPE": "Expressing Geometric Properties with Equations",
  "G-GMD": "Geometric Measurement and Dimension",
  "G-MG": "Modeling with Geometry",
  // High School -- Statistics and Probability
  "S-ID": "Interpreting Categorical and Quantitative Data",
  "S-IC": "Making Inferences and Justifying Conclusions",
  "S-CP": "Conditional Probability and the Rules of Probability",
  "S-MD": "Using Probability to Make Decisions",
};

/** A domain code, matched greedily so "A-SSE" wins over a false partial match. */
const DOMAIN_TOKEN_RE = /^([678]\.[A-Z]+|[A-Z]+-[A-Z]+)\.(.+)$/;

/** After the domain: a cluster letter, a standard number, and an optional lettered sub-part. */
const CLUSTER_STANDARD_RE = /^[A-Z]\.\d{1,2}[a-z]?$/;

const MP_RE = /^MP[1-8]$/;
const MP_LOOKALIKE_RE = /^MP\d+$/i;

export type StandardCodeValidation = { ok: true } | { ok: false; reason: string };

/**
 * Is `code` (just the code, e.g. "F-LE.A.2" or "MP7" -- not the description
 * that follows it in a rubric's standards[] entry) a real CCSS Math code?
 */
export function validateStandardCode(code: string): StandardCodeValidation {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: "is empty" };
  if (MP_RE.test(trimmed)) return { ok: true };
  if (MP_LOOKALIKE_RE.test(trimmed)) {
    return { ok: false, reason: `"${trimmed}" -- the Standards for Mathematical Practice are only MP1 through MP8` };
  }

  const m = trimmed.match(DOMAIN_TOKEN_RE);
  if (!m) {
    return {
      ok: false,
      reason: `"${trimmed}" doesn't look like a CCSS Math code (expected e.g. "F-LE.A.2", "7.EE.A.1", or "MP3")`,
    };
  }
  const [, domain, rest] = m;
  const domainName = CCSS_MATH_DOMAINS[domain];
  if (!domainName) {
    return {
      ok: false,
      reason: `"${domain}" is not a Grade 6-8 or High School CCSS Math domain (see docs/standards/ccss-math)`,
    };
  }
  if (!CLUSTER_STANDARD_RE.test(rest)) {
    return {
      ok: false,
      reason: `"${trimmed}" -- expected "${domain}.<cluster letter>.<standard number>[sub-part]", e.g. "${domain}.A.1"`,
    };
  }
  return { ok: true };
}

/**
 * Split a rubric's standards[] entry ("F-LE.A.2 Build a linear rule from a
 * description ...") into its leading code and the description after it. The
 * description is the strand author's own paraphrase, not verbatim CCSS text,
 * so only the code is validated.
 */
export function parseStandardEntry(entry: string): { code: string; description: string } {
  const trimmed = entry.trim();
  const m = trimmed.match(/^(\S+)\s+(.*)$/);
  return m ? { code: m[1], description: m[2] } : { code: trimmed, description: "" };
}
