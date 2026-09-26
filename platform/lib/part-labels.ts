/**
 * Where a PPQ-bank part sits among its siblings, from its label alone.
 *
 * The bank's convention (question_parts.sort_order): the unlabelled
 * whole-question part is 0, each lettered part is ten apart (a = 10,
 * b = 20, ...), and a roman sub-part sits just after its letter (bi = 21,
 * bii = 22). Anything else takes the caller's fallback.
 *
 * Moved out of app/api/questions/part-metadata/route.ts so the mark-scheme
 * build (lib/markscheme-build.ts) orders the parts it creates exactly as
 * that route orders the parts a teacher adds.
 */
export function sortOrderFromLabel(label: string, fallback: number): number {
  if (!label) return 0;
  const m = label.match(/^([a-z])(i|ii|iii|iv|v)?$/);
  if (!m) return fallback;
  const base = (m[1].charCodeAt(0) - 96) * 10;
  const subMap: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
  return base + (m[2] ? subMap[m[2]] ?? 0 : 0);
}
