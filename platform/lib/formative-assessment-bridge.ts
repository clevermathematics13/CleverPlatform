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
 * from a Nuanced Analysis packet's saved sections).
 *
 * This file used to say that a full delete-and-reinsert of the `source =
 * 'custom'` rows was safe on every save, because "test_items has no separate
 * teacher-editing surface today (rows are display-only)". That was true of
 * the rows and false of what points at them. Four tables reference
 * test_items.id ON DELETE CASCADE, so the reinsert was destroying every mark,
 * AI suggestion and self-score on any assessment that had already been
 * marked. syncTestItems below no longer deletes a row that student work hangs
 * off -- see its own comment for what it does instead, and what it refuses.
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

/** A part as the teacher reads it on the paper: "Q3(b)", or "Q7". */
function itemLabel(questionNumber: number, partLabel: string | null): string {
  return partLabel ? `Q${questionNumber}(${partLabel})` : `Q${questionNumber}`;
}

/** The natural key test_items is uniquely indexed on, within one test. */
function itemKey(questionNumber: number, partLabel: string | null): string {
  return `${questionNumber}|${partLabel ?? ""}`;
}

/**
 * Everything that hangs off a test_items row by id, ON DELETE CASCADE.
 *
 * This list is the reason this module no longer deletes rows on its way to
 * writing them. Deleting one item row silently takes every mark, AI
 * suggestion, mark-change record and self-score awarded against that part --
 * Formative Assessment 1 carries 2091, 2378, and 1429 of them.
 */
const DEPENDENT_TABLES = [
  "ai_grade_results",
  "mark_changes",
  "student_marks",
  "student_self_scores",
] as const;

/**
 * Which of these item ids have student work attached.
 *
 * Asked only about the ids a sync is considering disturbing, not the whole
 * paper: on a fully marked assessment the answer for every row would be
 * thousands of rows of nothing this function needs.
 */
async function itemsWithStudentWork(
  supabase: SupabaseClient,
  itemIds: string[],
): Promise<{ ok: true; ids: Set<string> } | { ok: false; error: string }> {
  const ids = new Set<string>();
  if (itemIds.length === 0) return { ok: true, ids };

  for (const table of DEPENDENT_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("test_item_id")
      .in("test_item_id", itemIds);
    if (error) return { ok: false, error: `checking ${table}: ${error.message}` };
    for (const row of (data ?? []) as { test_item_id: string | null }[]) {
      if (row.test_item_id) ids.add(row.test_item_id);
    }
  }
  return { ok: true, ids };
}

export type TestItemSyncResult =
  | {
      ok: true;
      synced: number;
      /** Rows dropped because the draft no longer has that part. Never one with student work against it. */
      removed: number;
      /**
       * Parts that kept their marks while their wording changed under them.
       * Not an error -- a teacher correcting a marked paper is entitled to --
       * but the marks there were awarded against the words that used to be
       * in this row, so the caller says so rather than letting it pass.
       */
      rewordedUnderStudentWork: string[];
    }
  | { ok: false; error: string };

type ExistingItem = {
  id: string;
  question_number: number;
  part_label: string | null;
  question_text: string | null;
  source: string;
};

/**
 * Brings this test's `source = 'custom'` test_items rows into line with
 * `sections`, WITHOUT deleting a row that student work hangs off.
 *
 * It used to delete every custom row and reinsert them, which was described
 * as safe because "test_items has no teacher-editing surface". That was true
 * of the rows and false of what points AT them: ai_grade_results,
 * mark_changes, student_marks and student_self_scores all reference
 * test_items.id ON DELETE CASCADE, so re-saving an already-marked assessment
 * from the creator destroyed every mark on it -- no warning, no undo, and
 * nothing in the save's response to say it had happened.
 *
 * So rows are now matched on (question_number, part_label), the natural key
 * test_items is already uniquely indexed on, and updated in place. An id that
 * survives keeps the marks that hang off it.
 *
 * WHAT IT REFUSES. A part that has gone from the draft but still carries
 * student work cannot be removed without destroying that work, and this
 * module is not the place to decide that a mark should stop existing. The
 * whole sync is refused, nothing is written, and the caller is told which
 * parts and what is on them. Every check runs before the first write for that
 * reason -- a refusal has to leave the paper exactly as it found it.
 *
 * WHAT IT CANNOT CHECK. A draft carries no stable id per question (see
 * AssignmentQuestion), so position is the only identity a part has. A
 * regenerated paper that happens to put different content at the same
 * position will rebind that position's marks to it. That cannot be detected
 * from the draft alone, so it is reported rather than prevented:
 * rewordedUnderStudentWork names every surviving part whose wording changed
 * while carrying marks.
 */
export async function syncTestItems(
  supabase: SupabaseClient,
  testId: string,
  sections: AssignmentSection[],
): Promise<TestItemSyncResult> {
  const rows = buildTestItemsFromSections(testId, sections);

  // Every row, not just the custom ones: a derived key landing on an IB-bank
  // row would be quietly converted by the upsert below, where the old
  // delete-then-insert would at least have failed on the unique index.
  const { data: existingRows, error: readError } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, question_text, source")
    .eq("test_id", testId);
  if (readError) return { ok: false, error: readError.message };

  const existing = (existingRows ?? []) as ExistingItem[];
  const byKey = new Map(existing.map((r) => [itemKey(r.question_number, r.part_label), r]));
  const derivedKeys = new Set(rows.map((r) => itemKey(r.question_number, r.part_label)));

  const occupied = rows
    .map((r) => byKey.get(itemKey(r.question_number, r.part_label)))
    .filter((r): r is ExistingItem => Boolean(r) && r!.source !== "custom");
  if (occupied.length > 0) {
    const names = occupied.map((r) => itemLabel(r.question_number, r.part_label)).join(", ");
    return {
      ok: false,
      error:
        `${names} already exist on this test from the question bank, not the creator. ` +
        "Sync would overwrite them, so nothing was changed.",
    };
  }

  const stale = existing.filter(
    (r) => r.source === "custom" && !derivedKeys.has(itemKey(r.question_number, r.part_label)),
  );
  const reworded = rows
    .map((row) => ({ row, prior: byKey.get(itemKey(row.question_number, row.part_label)) }))
    .filter(({ row, prior }) => prior && (prior.question_text ?? "") !== row.question_text);

  const work = await itemsWithStudentWork(supabase, [
    ...stale.map((r) => r.id),
    ...reworded.map(({ prior }) => prior!.id),
  ]);
  if (!work.ok) return { ok: false, error: work.error };

  const blocked = stale.filter((r) => work.ids.has(r.id));
  if (blocked.length > 0) {
    const names = blocked.map((r) => itemLabel(r.question_number, r.part_label)).join(", ");
    return {
      ok: false,
      error:
        `${names} no longer appear on this paper, but student work has already been marked ` +
        "against them. Nothing was changed -- the marks would have been deleted with the parts. " +
        "Put those parts back, or remove their marks first.",
    };
  }

  // Past every refusal, so from here a partial write is the only failure mode
  // left. The upsert goes first: an item row that briefly duplicates a removed
  // part is recoverable, one that briefly does not exist is not.
  const { error: upsertError } = await supabase
    .from("test_items")
    .upsert(rows, { onConflict: "test_id,question_number,part_label" });
  if (upsertError) return { ok: false, error: upsertError.message };

  if (stale.length > 0) {
    const { error: deleteError } = await supabase
      .from("test_items")
      .delete()
      .in(
        "id",
        stale.map((r) => r.id),
      );
    if (deleteError) return { ok: false, error: deleteError.message };
  }

  return {
    ok: true,
    synced: rows.length,
    removed: stale.length,
    rewordedUnderStudentWork: reworded
      .filter(({ prior }) => work.ids.has(prior!.id))
      .map(({ row }) => itemLabel(row.question_number, row.part_label)),
  };
}
