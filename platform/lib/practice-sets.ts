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
  /** 1 or 2. Null when the bank has no paper recorded for the question. */
  paper: number | null;
  imageUrls: string[];
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

/**
 * Which stored images to serve for one item.
 *
 * `curated` is the teacher's verified list from practice_set_items; `available`
 * is every image the bank holds for that code with image_type 'question'. The
 * result is the intersection, in the curated order, and an empty curated list
 * means "all of them".
 *
 * The intersection is the point. The curated column is hand-entered, so it is
 * the wrong place to trust; `available` is the only list that has been
 * filtered on image_type. A mark scheme path typed into the curated column
 * therefore drops out here rather than being signed and served -- which is
 * what keeps a typo from becoming an answer leak while mark schemes are
 * withheld.
 */
export function selectQuestionImagePaths(
  curated: readonly string[],
  available: readonly string[]
): string[] {
  if (available.length === 0) return [];
  const allowed = new Set(available);
  if (curated.length === 0) return [...available];

  const chosen = curated.filter((path) => allowed.has(path));
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
