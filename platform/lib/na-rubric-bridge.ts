/**
 * Nuanced Analysis — rubric bridge
 * --------------------------------
 * `na_rubric_items` is the first-class, editable answer key that the Stage 5
 * assessment pipeline is meant to read from (see na_rubric_items' own table
 * comment). Today it is only ever populated by hand, one packet at a time,
 * via one-off SQL migrations (see 20260823151455_populate_na_rubric_items_a1.sql)
 * — a freshly generated-and-saved packet has no rubric items at all.
 *
 * This module derives rubric-item rows directly from the shape a packet is
 * actually saved in (`nuanced_analyses.parts`, i.e. `AssignmentDraft.sections`),
 * so a new packet gets a usable answer key the moment it is saved, with no
 * manual SQL. It is a distinct, additive path — it does not read or write
 * `na_anchors`, and it does not change anything about how Stage 5 assessment
 * currently reads `na_anchors`' own columns.
 *
 * Numbering matches the convention already used for the one hand-authored
 * packet: base_qid is a global (not per-section) 1-based "Q<n>" ordinal, and
 * subpart qids append the existing subpartLetter() lettering, e.g. "Q1(e)".
 * One real, documented gap: a subpart that was split onto its own printed
 * answer box purely as a page-layout decision (as Q1(e) was for the one
 * existing packet) can't be told apart from a subpart with no box of its
 * own — that distinction lives on the printed page, not in this JSON. This
 * bridge treats every subpart as getting its own rubric row, which is the
 * correct default and matches how subparts are actually authored (each with
 * its own prompt and marks) — a page-layout exception, if one is ever
 * needed, stays a manual na_rubric_items edit, same as today.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { subpartLetter } from "./assignments";
import type { AssignmentSection } from "./assignments";

export type RubricItemRow = {
  nuanced_analysis_id: string;
  qid: string;
  base_qid: string;
  question_number: number;
  question_text: string | null;
  answer_key: string | null;
  open_rubric: string | null;
  misconception_context: string | null;
  command_term: string | null;
  marks: number | null;
  question_marks: number | null;
  source: "generated";
};

/**
 * Derives one na_rubric_items row per question (or, when a question has
 * subparts, one row per subpart) from a saved packet's sections. Pure and
 * deterministic — the same sections always produce the same rows, which is
 * what makes re-running the sync after an edit safe to diff against.
 *
 * command_term, open_rubric, and misconception_context have no structured
 * per-question source in AssignmentSection today, so they come back null on
 * every generated row — both are optional inputs to the assessor.
 */
export function buildRubricItemsFromSections(
  nuancedAnalysisId: string,
  sections: AssignmentSection[],
): RubricItemRow[] {
  const rows: RubricItemRow[] = [];
  let questionNumber = 0;

  for (const section of sections ?? []) {
    for (const question of section.questions ?? []) {
      questionNumber += 1;
      const baseQid = `Q${questionNumber}`;
      const questionMarks = question.marks ?? null;

      if (question.subparts && question.subparts.length > 0) {
        question.subparts.forEach((subpart, index) => {
          rows.push({
            nuanced_analysis_id: nuancedAnalysisId,
            qid: `${baseQid}(${subpartLetter(index)})`,
            base_qid: baseQid,
            question_number: questionNumber,
            question_text: subpart.prompt ?? null,
            answer_key: subpart.answer ?? question.answer ?? null,
            open_rubric: null,
            misconception_context: null,
            command_term: null,
            marks: subpart.marks ?? null,
            question_marks: questionMarks,
            source: "generated",
          });
        });
      } else {
        rows.push({
          nuanced_analysis_id: nuancedAnalysisId,
          qid: baseQid,
          base_qid: baseQid,
          question_number: questionNumber,
          question_text: question.prompt ?? null,
          answer_key: question.answer ?? null,
          open_rubric: null,
          misconception_context: null,
          command_term: null,
          marks: questionMarks,
          question_marks: questionMarks,
          source: "generated",
        });
      }
    }
  }

  return rows;
}

export type RubricSyncResult =
  | { ok: true; synced: number; skipped: number }
  | { ok: false; error: string };

/**
 * Upserts the derived rubric rows for one packet, without ever overwriting a
 * row a teacher has hand-edited. na_rubric_items.source defaults to
 * 'generated' and is the only provenance marker the table has, so "edited"
 * is detected as "source is no longer 'generated'" — a teacher who corrects
 * an auto-generated row is expected to also update its source (e.g. to
 * 'teacher') via the rubric editor, which is what makes it stick across a
 * later re-sync.
 */
export async function syncRubricItems(
  supabase: SupabaseClient,
  nuancedAnalysisId: string,
  sections: AssignmentSection[],
): Promise<RubricSyncResult> {
  const desired = buildRubricItemsFromSections(nuancedAnalysisId, sections);
  if (desired.length === 0) return { ok: true, synced: 0, skipped: 0 };

  const { data: existing, error: existingError } = await supabase
    .from("na_rubric_items")
    .select("qid, source")
    .eq("nuanced_analysis_id", nuancedAnalysisId);

  if (existingError) return { ok: false, error: existingError.message };

  const editedQids = new Set(
    (existing ?? [])
      .filter((row: { qid: string; source: string | null }) => row.source !== "generated")
      .map((row: { qid: string; source: string | null }) => row.qid),
  );

  const toUpsert = desired.filter((row) => !editedQids.has(row.qid));
  const skipped = desired.length - toUpsert.length;

  if (toUpsert.length === 0) return { ok: true, synced: 0, skipped };

  const { error: upsertError } = await supabase
    .from("na_rubric_items")
    .upsert(toUpsert, { onConflict: "nuanced_analysis_id,qid" });

  if (upsertError) return { ok: false, error: upsertError.message };
  return { ok: true, synced: toUpsert.length, skipped };
}
