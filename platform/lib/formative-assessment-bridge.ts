/**
 * Formative Assessment — bridge into tests / test_items
 * -------------------------------------------------------
 * A Formative Assessment is authored as an AssignmentDraft (see
 * lib/assignments.ts) but graded through the existing, anchor-free
 * `tests` + lib/ai-grading.ts pipeline — the same batch-scan/segment/split/
 * grade/accept flow used for IB question-bank exams
 * (app/api/tests/[id]/ai-grade/*), unmodified.
 *
 * This module is what makes a saved draft gradeable: it derives one
 * `test_items` row per question (or per subpart, when present) with inline
 * `question_text`/`markscheme_text` (`source: "custom"`), which
 * lib/ai-grading.ts's assembleMarkScheme() reads directly instead of
 * joining to the IB question bank.
 *
 * Mirrors the pattern of lib/na-rubric-bridge.ts (deriving na_rubric_items
 * from a Nuanced Analysis packet's saved sections), but simpler: test_items
 * has no separate teacher-editing surface today (rows are display-only —
 * see app/dashboard/tests/tests-client.tsx), so a full delete-and-reinsert
 * of this test's `source = 'custom'` rows on every save is as safe as an
 * upsert-with-skip and needs no provenance tracking beyond `source` itself.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentSection } from "./assignments";

export type TestItemInsert = {
  test_id: string;
  question_number: number;
  part_label: string;
  max_marks: number;
  /**
   * The stem of the question this row is a part of, or null when the row IS
   * the whole question (its text is already question_text) or the question
   * carried no stem.
   *
   * Its own column rather than a prefix on question_text, because
   * question_text is ALSO what lib/rubric-validator.ts checks each part
   * against, and several of its rules would read a stem as the part's own
   * words -- rule 10's self-numbering check is anchored to the start of the
   * prompt, and WORKING_COMMAND / SUBSTITUTES_VALUES match words a stem may
   * legitimately contain. Folding the stem in would have silently changed
   * every one of those answers.
   */
  stem_text: string | null;
  question_text: string;
  markscheme_text: string;
  source: "custom";
  sort_order: number;
};

/**
 * Derives one test_items row per question (or, when a question has
 * subparts, one row per subpart) from a Formative Assessment's sections.
 * Numbering is global (1-based) across all sections, matching the same
 * convention used by lib/na-rubric-bridge.ts's buildRubricItemsFromSections.
 *
 * A subpart row carries its question's stem in stem_text, repeated on every
 * subpart of that question. Without it a part is stored as the words of the
 * command alone: Key Assessment 1 Q9(a) was "Rearrange the formula to make $x$
 * the subject. Show every step." -- with the formula it names nowhere in the
 * row, and so nowhere in what the AI marker was given to mark against.
 */
export function buildTestItemsFromSections(
  testId: string,
  sections: AssignmentSection[],
): TestItemInsert[] {
  const rows: TestItemInsert[] = [];
  let questionNumber = 0;
  let sortOrder = 0;

  for (const section of sections ?? []) {
    for (const question of section.questions ?? []) {
      questionNumber += 1;

      if (question.subparts && question.subparts.length > 0) {
        // A whitespace-only stem is stored as no stem at all, rather than as a
        // blank line every grading prompt for this question would then carry.
        const stem = question.prompt?.trim() ? question.prompt : null;
        question.subparts.forEach((subpart, index) => {
          const partLabel = String.fromCharCode(97 + index); // a, b, c, ...
          rows.push({
            test_id: testId,
            question_number: questionNumber,
            part_label: partLabel,
            max_marks: subpart.marks ?? 0,
            stem_text: stem,
            question_text: subpart.prompt ?? "",
            markscheme_text: subpart.markScheme ?? "",
            source: "custom",
            sort_order: sortOrder++,
          });
        });
      } else {
        rows.push({
          test_id: testId,
          question_number: questionNumber,
          part_label: "",
          max_marks: question.marks ?? 0,
          // The prompt is the question_text below; repeating it here would
          // hand the marker the same sentence twice.
          stem_text: null,
          question_text: question.prompt ?? "",
          markscheme_text: question.markScheme ?? "",
          source: "custom",
          sort_order: sortOrder++,
        });
      }
    }
  }

  return rows;
}

/** Sum of every question's (or, when present, its subparts') marks. */
export function computeTotalMarks(sections: AssignmentSection[]): number {
  let total = 0;
  for (const section of sections ?? []) {
    for (const question of section.questions ?? []) {
      if (question.subparts && question.subparts.length > 0) {
        total += question.subparts.reduce((sum, sp) => sum + (sp.marks ?? 0), 0);
      } else {
        total += question.marks ?? 0;
      }
    }
  }
  return total;
}

export type TestItemSyncResult =
  | { ok: true; synced: number }
  | { ok: false; error: string };

/**
 * Replaces this test's `source = 'custom'` test_items rows with rows
 * derived fresh from `sections`. Safe to call on every save: test_items
 * has no teacher-editing surface today, so there is nothing to preserve
 * across a re-sync (unlike lib/na-rubric-bridge.ts's syncRubricItems,
 * which must skip teacher-edited na_rubric_items rows).
 */
export async function syncTestItems(
  supabase: SupabaseClient,
  testId: string,
  sections: AssignmentSection[],
): Promise<TestItemSyncResult> {
  const { error: deleteError } = await supabase
    .from("test_items")
    .delete()
    .eq("test_id", testId)
    .eq("source", "custom");

  if (deleteError) return { ok: false, error: deleteError.message };

  const rows = buildTestItemsFromSections(testId, sections);
  if (rows.length === 0) return { ok: true, synced: 0 };

  const { error: insertError } = await supabase.from("test_items").insert(rows);
  if (insertError) return { ok: false, error: insertError.message };

  return { ok: true, synced: rows.length };
}
