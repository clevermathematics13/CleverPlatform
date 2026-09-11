/**
 * Practice sets: the pure half.
 *
 * Everything here is a plain function over plain data, so the decisions that
 * matter -- which images get served, what a student is allowed to see -- can
 * be tested without a database. The queries live in practice-set-service.ts.
 *
 * A practice set is a teacher-curated list of bank questions handed to one
 * course to work through. It is not an assessment: no marks are collected,
 * nothing reaches the gradebook, and the questions are not registered as used
 * in the bank. See the 20260911142401_practice_sets migration for why it is
 * its own pair of tables rather than a `tests` or `saved_exams` row.
 */

export type PracticeTier = "basic" | "medium" | "challenging";

/** Fixed order. A set reads basic-first whatever order the rows come back in. */
export const TIER_ORDER: readonly PracticeTier[] = ["basic", "medium", "challenging"] as const;

export const TIER_LABEL: Record<PracticeTier, string> = {
  basic: "Basic",
  medium: "Medium",
  challenging: "Challenging",
};

/** What each tier is for, in the student's own terms. */
export const TIER_BLURB: Record<PracticeTier, string> = {
  basic: "One technique each, applied directly.",
  medium: "A named technique plus one more step.",
  challenging: "You choose the method, and often more than one.",
};

export function isPracticeTier(value: string): value is PracticeTier {
  return (TIER_ORDER as readonly string[]).includes(value);
}

export interface PracticeSubtopic {
  code: string;
  descriptor: string | null;
}

export interface PracticeItem {
  position: number;
  tier: PracticeTier;
  marks: number;
  subtopics: PracticeSubtopic[];
  /** 1 or 2. Null for a generated question, which belongs to no paper. */
  paper: number | null;
  /** Set for a bank question: the scanned page. Empty for a generated one. */
  imageUrls: string[];
  /**
   * Set for a generated question: the question itself, as LaTeX for
   * LatexRenderer. Null for a bank question, whose content is its image.
   * Exactly one of imageUrls / questionLatex carries the question.
   */
  questionLatex: string | null;
  /**
   * The IB code (e.g. "22M.1.AHL.TZ1.H_1"). Populated for the teacher's own
   * preview and null for a student -- see buildPracticeItem. Typing it as
   * nullable rather than optional is deliberate: a caller that renders it has
   * to handle the absence, so a student view cannot leak it by forgetting.
   */
  questionCode: string | null;
}

export interface PracticeTierGroup {
  tier: PracticeTier;
  label: string;
  blurb: string;
  marks: number;
  items: PracticeItem[];
}

export interface PracticeSetView {
  id: string;
  name: string;
  description: string | null;
  questionCount: number;
  totalMarks: number;
  /** False means the page shows questions only. Nothing in this module can
   *  produce a mark scheme URL either way -- see practice-set-service.ts. */
  markschemeReleased: boolean;
  groups: PracticeTierGroup[];
}

/**
 * Paper 1 is the no-calculator paper and Paper 2 is the calculator one, for
 * every DP maths course. Worth surfacing on a mixed practice set: a student
 * who reaches for the GDC on a Paper 1 question has practised the wrong
 * thing, and there is nothing on the question itself to tell them.
 */
export function calculatorAllowed(paper: number | null): boolean {
  return paper === 2;
}

/** The directory part of a storage path: "22M.1.AHL.TZ1.H_1/question". */
function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * Which stored images to serve for one item.
 *
 * `curated` is the teacher's verified list from practice_set_items; `available`
 * is every image the bank holds for that code with image_type 'question'. An
 * empty curated list means "all of them".
 *
 * A curated path is served when it sits in the same DIRECTORY as one of the
 * available question images -- not when it is one of them exactly. The bank's
 * own images are the raw page scans, and some carry a printed answer box a
 * page deep that is dead space on screen; the set can point instead at a
 * trimmed derivative stored beside them under `<code>/question/`, which has no
 * question_images row of its own precisely so it stays out of the teacher's
 * bank UI and out of printed papers, where the box belongs.
 *
 * Directory rather than exact path still closes the leak this check exists
 * for. Every available path is a question image, so the only directory that
 * can ever be allowed is `<code>/question`; a mark scheme lives in
 * `<code>/markscheme` and the bank's loose imports sit under prefixes of their
 * own, so neither can match however the curated column is typed. The storage
 * policy enforces the same shape independently -- a student may read only
 * objects whose second path segment is "question" -- so this is the inner of
 * two locks, not the only one.
 */
export function selectQuestionImagePaths(
  curated: readonly string[],
  available: readonly string[]
): string[] {
  if (available.length === 0) return [];
  if (curated.length === 0) return [...available];

  const allowedDirs = new Set(available.map(directoryOf));
  const chosen = curated.filter((path) => allowedDirs.has(directoryOf(path)));
  // A curated list that matches nothing usually means the bank was re-imported
  // and the paths moved. Falling back to every question image shows the
  // student something real, with at worst some clutter, instead of a question
  // that renders as an empty box.
  return chosen.length > 0 ? chosen : [...available];
}

/** Marks and question count for the set as a whole. */
export function summarisePracticeSet(items: readonly PracticeItem[]): {
  questionCount: number;
  totalMarks: number;
} {
  return {
    questionCount: items.length,
    totalMarks: items.reduce((sum, item) => sum + item.marks, 0),
  };
}

/**
 * Group into the three tiers, in TIER_ORDER, dropping any tier the set does
 * not use. Items keep their stored order within a tier, which is the order the
 * teacher put them in -- not re-sorted by marks, because a set often opens a
 * tier with its gentlest question on purpose.
 */
export function groupItemsByTier(items: readonly PracticeItem[]): PracticeTierGroup[] {
  return TIER_ORDER.map((tier) => {
    const tierItems = items.filter((item) => item.tier === tier);
    return {
      tier,
      label: TIER_LABEL[tier],
      blurb: TIER_BLURB[tier],
      marks: tierItems.reduce((sum, item) => sum + item.marks, 0),
      items: tierItems,
    };
  }).filter((group) => group.items.length > 0);
}

export function buildPracticeSetView(input: {
  id: string;
  name: string;
  description: string | null;
  markschemeReleased: boolean;
  items: readonly PracticeItem[];
}): PracticeSetView {
  const { questionCount, totalMarks } = summarisePracticeSet(input.items);
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    questionCount,
    totalMarks,
    markschemeReleased: input.markschemeReleased,
    groups: groupItemsByTier(input.items),
  };
}
