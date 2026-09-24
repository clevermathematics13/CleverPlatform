/**
 * The sections a paper is marked in, for subtotals.
 *
 * Moved out of the gradebook page so the grade-boundaries page reads a paper
 * the same way the gradebook does. Three kinds of paper:
 *
 * - an Assessment Creator paper (tests.custom_content) is split by its own
 *   LEVEL headings, which rise in demand;
 * - a Grade 9 Standard paper (tests.standards_rubric) is split by strand;
 * - anything else gets the IB split, Section A (Q1-8) and Section B (Q9+).
 *
 * Client-safe: type-only import of the rubric, no fs.
 */

import type { StandardsRubric } from "./standards-rubric";
import { strandForItem } from "./standards-report";

export type TestSection = {
  /** Short column label, e.g. 'Sec A' or 'L1'. */
  label: string;
  /** Full name for the tooltip, e.g. 'LEVEL 3 -- CONNECT THE ALGEBRA'. */
  title: string;
  fromQ: number;
  /** Inclusive upper bound; null means open-ended (the last section). */
  toQ: number | null;
};

/** The IB split, and the default for any paper that does not carry its own
 *  structure: Section A is short response, Section B extended response. */
export const IB_SECTIONS: TestSection[] = [
  { label: "Sec A", title: "Section A - short response (Q1-8)", fromQ: 1, toQ: 8 },
  { label: "Sec B", title: "Section B - extended response (Q9+)", fromQ: 9, toQ: null },
];

/** "LEVEL 3 -- CONNECT THE ALGEBRA" -> "L3", to fit a gradebook column. */
export function shortSectionLabel(heading: string, index: number): string {
  const level = /^\s*LEVEL\s+(\d+)/i.exec(heading);
  if (level) return `L${level[1]}`;
  const firstWord = heading.trim().split(/[\s—-]+/)[0];
  return firstWord && firstWord.length <= 6 ? firstWord : `S${index + 1}`;
}

/**
 * Section ranges for a Formative Assessment, from the LEVEL headings it was
 * authored with. Question numbering is global across sections (see
 * deriveTestItems in lib/formative-assessment-bridge.ts), so each section owns
 * a contiguous run of question numbers and only the per-section question
 * *count* is needed to find it.
 *
 * That count is the only thing wanted from a ~17 kB draft, and PostgREST
 * cannot aggregate inside JSONB, so the whole blob is fetched and thrown away.
 * Fine while a course holds a handful of assessments; if that stops being true,
 * put the section on test_items at write time rather than deriving it here.
 */
export function sectionsFromCustomContent(customContent: unknown): TestSection[] | null {
  const raw = (customContent as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: TestSection[] = [];
  let lastQ = 0;
  raw.forEach((entry, i) => {
    const section = entry as { heading?: unknown; questions?: unknown };
    const count = Array.isArray(section.questions) ? section.questions.length : 0;
    if (count === 0) return; // consumes no question numbers, so lastQ is untouched
    const heading =
      typeof section.heading === "string" && section.heading.trim()
        ? section.heading.trim()
        : `Section ${i + 1}`;
    out.push({
      label: shortSectionLabel(heading, i),
      title: heading,
      fromQ: lastQ + 1,
      toQ: lastQ + count,
    });
    lastQ += count;
  });
  return out.length > 0 ? out : null;
}

export function inSection(questionNumber: number, section: TestSection): boolean {
  return (
    questionNumber >= section.fromQ &&
    (section.toQ === null || questionNumber <= section.toQ)
  );
}

/** One named section of a paper and the parts in it, for the boundaries page. */
export interface PaperSection {
  label: string;
  title: string;
  /** Sum of max_marks over the section's parts. */
  maxMarks: number;
}

export interface PaperSectionMap {
  sections: PaperSection[];
  /** test_items.id -> index into `sections`. */
  sectionIndexByItemId: Map<string, number>;
}

/**
 * Every part of a paper placed in one section, in the paper's own terms:
 * strands for a Standard paper, LEVEL headings for a creator paper, else the
 * IB split. A Standard part in no strand (a bonus question) goes to "Other".
 * Sections with no parts are dropped, so a paper that stops at Q6 has no
 * Section B.
 */
export function paperSections(args: {
  customContent: unknown;
  standardsRubric: StandardsRubric | null;
  items: { id: string; question_number: number; part_label: string | null; max_marks: number }[];
}): PaperSectionMap {
  const { customContent, standardsRubric, items } = args;
  const draft: { label: string; title: string; itemIds: string[]; maxMarks: number }[] = [];
  const assign = (index: number, item: (typeof items)[number]) => {
    draft[index].itemIds.push(item.id);
    draft[index].maxMarks += item.max_marks;
  };

  if (standardsRubric) {
    standardsRubric.strands.forEach((s) => draft.push({ label: s.code, title: s.name, itemIds: [], maxMarks: 0 }));
    let otherIndex = -1;
    for (const item of items) {
      const strand = strandForItem(standardsRubric, item);
      const index = strand ? standardsRubric.strands.findIndex((s) => s.code === strand.code) : -1;
      if (index >= 0) {
        assign(index, item);
      } else {
        if (otherIndex < 0) {
          otherIndex = draft.length;
          draft.push({ label: "Other", title: "Parts in no strand", itemIds: [], maxMarks: 0 });
        }
        assign(otherIndex, item);
      }
    }
  } else {
    const ranges = sectionsFromCustomContent(customContent) ?? IB_SECTIONS;
    ranges.forEach((r) => draft.push({ label: r.label, title: r.title, itemIds: [], maxMarks: 0 }));
    for (const item of items) {
      const index = ranges.findIndex((r) => inSection(item.question_number, r));
      // A part numbered before the first range (a Q0) joins the first section.
      assign(index >= 0 ? index : 0, item);
    }
  }

  const kept = draft.filter((d) => d.itemIds.length > 0);
  const sectionIndexByItemId = new Map<string, number>();
  kept.forEach((d, i) => d.itemIds.forEach((id) => sectionIndexByItemId.set(id, i)));
  return {
    sections: kept.map((d) => ({ label: d.label, title: d.title, maxMarks: d.maxMarks })),
    sectionIndexByItemId,
  };
}
