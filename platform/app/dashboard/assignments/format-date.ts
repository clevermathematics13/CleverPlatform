/**
 * format-date.ts
 * -----------------------------------------------------------------------------
 * The date shown against a saved thing in Assignments Studio -- a saved
 * Formative Assessment in the load picker, a saved packet in the manage list.
 *
 * One implementation rather than one per list. The two it replaced were
 * character-for-character identical and forty lines apart in this directory,
 * and the second existed only because the first was copied -- carrying its bug
 * with it. A third copy would have done the same.
 * -----------------------------------------------------------------------------
 */

/**
 * Format an ISO timestamp, falling back to the raw value if it is not one.
 *
 * The invalid case is CHECKED, not caught. `new Date("nonsense")` does not
 * throw -- it yields an Invalid Date whose `toLocaleDateString` returns the
 * string "Invalid Date" -- so a try/catch around it never fires and that string
 * is what lands in the list. The try/catch is still here for the narrower thing
 * it does guard: `toLocaleDateString` throwing RangeError on a bad locale or
 * options in some runtimes.
 */
export function formatSavedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
