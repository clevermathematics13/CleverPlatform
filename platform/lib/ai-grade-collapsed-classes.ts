/**
 * Which classes the AI-grade roster shows folded away. A Grade 9 test's
 * roster pools every class in its track (9A, 9C, 9G) under its own heading,
 * and clicking a heading collapses that class.
 *
 * Remembered per browser in a cookie, like the navigation position
 * (lib/nav-position.ts), and for the same reason: it must be known before
 * the first paint. The page reads it on the server and renders those classes
 * collapsed in its first HTML; browser storage could only be read once the
 * page had already drawn them open. Kept by class name, so it carries across
 * every test's roster -- the classes are the same ones.
 */

export const COLLAPSED_CLASSES_COOKIE = "cp_ai_grade_collapsed";

/** More than any track has; past it the oldest are dropped. */
const MAX_CLASSES = 20;
/** Longer names are not remembered -- keeps the cookie far below a browser's 4 KB. */
const MAX_NAME_LENGTH = 40;
/** A value longer than a full cookie can be is not ours to read. */
const MAX_VALUE_LENGTH = 4096;

/** Distinct, non-empty, short names, the most recently added last. */
function cleanNames(values: readonly unknown[]): string[] {
  const names = values.filter(
    (v): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_NAME_LENGTH
  );
  return [...new Set(names)].slice(-MAX_CLASSES);
}

function decodeOrNull(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * The class names in the cookie's value. Anything that is not a JSON array
 * of names -- a truncated or hand-edited cookie -- reads as nothing
 * collapsed, never as an error: at worst the roster opens fully expanded.
 */
export function parseCollapsedClasses(value: string | null | undefined): string[] {
  if (!value || value.length > MAX_VALUE_LENGTH) return [];
  // Next decodes a cookie's value before handing it over (cookies()); read
  // the value as written too, in case whatever reads it does not.
  for (const candidate of [value, decodeOrNull(value)]) {
    if (candidate === null) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return cleanNames(parsed);
    } catch {
      // Not JSON in this form; try the other.
    }
  }
  return [];
}

/**
 * The Set-Cookie string (document.cookie form) remembering `names` for a
 * year on every AI-grade page, or deleting the cookie once nothing is
 * collapsed. Scoped to /dashboard/tests, the only pages that read it.
 */
export function collapsedClassesCookie(names: Iterable<string>, secure: boolean): string {
  const kept = cleanNames([...names]);
  const value = encodeURIComponent(JSON.stringify(kept));
  const maxAge = kept.length > 0 ? 31536000 : 0;
  return `${COLLAPSED_CLASSES_COOKIE}=${value}; path=/dashboard/tests; max-age=${maxAge}; SameSite=Lax${
    secure ? "; Secure" : ""
  }`;
}

/** Client-side: remember which classes are collapsed now. */
export function writeCollapsedClassesCookie(names: Iterable<string>): void {
  document.cookie = collapsedClassesCookie(names, window.location.protocol === "https:");
}
