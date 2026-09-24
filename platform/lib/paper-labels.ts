/**
 * How a printed paper numbers its questions: "2.3" for the third question of
 * section two. Plain functions with no imports, on purpose.
 *
 * They used to live only in lib/assignments.ts, next to the AI prompt
 * builders and draft parsing, so a client page that needed just the labels --
 * the AI-grade review screen -- shipped all of that (about 49 KB) to the
 * browser. lib/assignments re-exports both, so every existing import keeps
 * working; a client bundle should import them from here.
 */

export function formatQuestionLabel(
  sectionIndex: number,
  questionIndex: number,
  numberingStyle: "numeric" | "lettered"
): string {
  if (numberingStyle === "lettered") {
    const code = "a".charCodeAt(0) + questionIndex;
    return `(${String.fromCharCode(code)})`;
  }
  return `${sectionIndex + 1}.${questionIndex + 1}`;
}

/**
 * Maps each test_items.sort_order to the "<section>.<question>" prefix the
 * printed paper itself uses (e.g. "2.3"), from a Formative Assessment's
 * stored draft (tests.custom_content) -- the same structure formatQuestionLabel
 * renders the paper from, and the same order
 * lib/formative-assessment-bridge.ts's buildTestItemsFromSections walks to
 * assign sort_order in the first place, so the two line up.
 *
 * This is the single source of truth for recovering "which section did this
 * part come from" at read time. buildTestItemsFromSections flattens that
 * structure into one global question_number, discarding it -- so every place
 * that wants to show a part the way the paper numbers it, rather than as a
 * flat "Q5", has to walk the same draft the same way to get it back. Before
 * this existed that walk had already been written at least four times
 * (lib/rubric-validator.ts's paperFacts(), the AI-grading review screen, the
 * gradebook's section-range reconstruction, the reflection portal), each its
 * own chance to drift from the walk that actually assigned sort_order.
 *
 * Returns an empty map for anything that is not a Formative-Assessment-style
 * draft (an IB-bank test's custom_content is null, and its question_number
 * already is the paper's own number).
 */
export function paperQuestionPrefixes(customContent: unknown): Map<number, string> {
  const prefixes = new Map<number, string>();
  const sections = (
    customContent as { sections?: { questions?: { subparts?: unknown[] }[] }[] } | null | undefined
  )?.sections;
  if (!Array.isArray(sections)) return prefixes;
  let sortOrder = 0;
  sections.forEach((section, sIdx) => {
    (section.questions ?? []).forEach((question, qIdx) => {
      const prefix = formatQuestionLabel(sIdx, qIdx, "numeric");
      const partCount = Array.isArray(question.subparts) && question.subparts.length > 0 ? question.subparts.length : 1;
      for (let i = 0; i < partCount; i++) prefixes.set(sortOrder++, prefix);
    });
  });
  return prefixes;
}
