/**
 * Repairs the most common way LLMs produce malformed JSON when a string value
 * contains literal backslashes — e.g. raw LaTeX like \binom{n}{r} or a correctly
 * pre-escaped \\frac{1}{2}: a backslash that isn't part of a valid JSON escape
 * sequence.
 *
 * Valid JSON escapes are: \" \\ \/ \b \f \n \r \t \uXXXX
 *
 * In this LaTeX-generation context, an unescaped \b, \f, \n, \r, or \t is
 * overwhelmingly more likely to be the start of a LaTeX command (\binom, \frac,
 * \neq, \rangle, \tan, \theta, \times, \to, \underline...) than an intentional
 * control character, so those five are treated as needing escaping too, rather
 * than being left alone as "already valid." Only \" \\ \/ and genuine \uXXXX
 * sequences are assumed correct and left untouched.
 *
 * This is a single left-to-right scan that tracks whether the cursor is inside
 * a JSON string (toggling on unescaped double quotes), so structural characters
 * outside strings are never touched, and a raw literal newline/tab/carriage
 * return sitting unescaped inside a string gets properly escaped too (another
 * common way LLMs emit invalid JSON).
 *
 * Safe to run on already-correctly-escaped JSON: valid escape pairs are copied
 * through unchanged char-for-char, so this is idempotent and a no-op on
 * well-formed input — it's safe to apply unconditionally before every parse,
 * not just as a fallback after a failure.
 */
export function sanitizeJsonBackslashes(text: string): string {
  let result = "";
  let inString = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = false;
      result += ch;
      i++;
      continue;
    }

    if (ch === "\\") {
      const next = text[i + 1];
      if (next === '"' || next === "\\" || next === "/") {
        // Already a valid, unambiguous escape pair — copy both chars unchanged.
        result += ch + next;
        i += 2;
        continue;
      }
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
        // Already a valid unicode escape — copy all 6 chars unchanged.
        result += text.slice(i, i + 6);
        i += 6;
        continue;
      }
      // Anything else — including b/f/n/r/t, which in this domain are almost
      // always the start of an unescaped LaTeX command, not an intentional
      // control character — needs its backslash escaped.
      result += "\\\\";
      i += 1;
      continue;
    }

    // A raw, literal control character sitting unescaped inside a string is
    // also invalid JSON on its own — escape it rather than let JSON.parse reject it.
    if (ch === "\n") {
      result += "\\n";
      i++;
      continue;
    }
    if (ch === "\r") {
      result += "\\r";
      i++;
      continue;
    }
    if (ch === "\t") {
      result += "\\t";
      i++;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
