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

/**
 * The same, with the time of day.
 *
 * For lists where several entries land on one day and the date alone cannot
 * order them -- the draft list, where "Saved" is the whole point of the column.
 * Kept as its own function rather than an options argument: two call shapes do
 * not justify a formatter API, and the point of this module is that nobody has
 * to think about the Invalid Date trap again.
 */
export function formatSavedDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
