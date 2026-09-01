/** Lowercase and strip diacritics, for accent-insensitive name search.
 *
 *  This roster is largely Peruvian ("Joaquín", "Inés", "Nieto Pérez") and a
 *  teacher typing on a US keyboard should not have to produce the accent to
 *  find a student. NFD splits a letter into base + combining mark, and the
 *  U+0300-U+036F range is exactly those marks, so removing them leaves the
 *  base letters. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
