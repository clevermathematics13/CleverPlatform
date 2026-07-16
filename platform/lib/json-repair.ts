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

/**
 * Repairs literal, unescaped double-quote characters sitting *inside* a JSON
 * string value instead of properly escaped as \" — the way this shows up in
 * Nuanced Analysis / Activity Generator output is the required quoted-Typst-
 * operator syntax the model is explicitly instructed to emit, e.g.
 * `$op("Var")(X) = sigma^2$` for named operators like Var/Cov/Corr/SD that
 * have no built-in Typst symbol (see the MATH rule in
 * buildActivityGeneratorSystemPrompt). The model is meant to escape that
 * inner quote as \" but doesn't always. A raw quote there prematurely closes
 * the JSON string, and the parser then chokes on whatever text follows with
 * "Expected ',' or '}' after property value" — the string looked like it
 * ended, but what came next wasn't valid JSON structure.
 *
 * There's no way to know with certainty whether a given `"` inside what we
 * currently think is a string is a real closing delimiter or embedded
 * content, so this uses the same heuristic most JSON-repair tools use: look
 * at what immediately follows, skipping whitespace. A real closing quote for
 * a string value is always followed by one of `,` `}` `]` `:` or the end of
 * input. Anything else (a letter, digit, `(`, `$`...) means the quote was
 * content, not a delimiter, so it gets escaped instead of ending the string.
 *
 * Run this BEFORE sanitizeJsonBackslashes, so the backslash it inserts here
 * is recognized as an already-valid \" escape pair on that pass rather than
 * being touched again. Like sanitizeJsonBackslashes, this is a no-op on
 * already-well-formed JSON, so it's safe to apply unconditionally.
 */
export function sanitizeJsonEmbeddedQuotes(text: string): string {
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

    // Inside a string. A backslash always escapes whatever follows it —
    // copy the pair through untouched. Whether that pair is itself valid is
    // sanitizeJsonBackslashes's job, not this function's.
    if (ch === "\\") {
      result += ch + (text[i + 1] ?? "");
      i += 2;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < len && /\s/.test(text[j])) j++;
      const next = text[j];
      const isRealClose =
        next === undefined || next === "," || next === "}" || next === "]" || next === ":";
      if (isRealClose) {
        inString = false;
        result += ch;
      } else {
        result += '\\"';
      }
      i++;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
