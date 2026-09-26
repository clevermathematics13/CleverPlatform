/**
 * The reads a mark-scheme build plans from, shared by the build script
 * (scripts/build-mark-schemes.ts, service role) and LaTeX Review's Accept
 * (app/api/questions/markscheme-builds, the teacher's session), so both plan
 * against the same picture of a question.
 *
 * Under the teacher's session RLS shows only their own tests and saved
 * exams. That is every one today; and apply_markscheme_build() checks again
 * with markscheme_question_in_use(), which sees all of them, so a use this
 * misses makes the write refuse rather than go ahead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { toBankLabel, type ExistingPart, type InUseTarget } from "./markscheme-build";
import { fetchAllRows, fetchInChunks } from "./supabase-paging";

export const EXISTING_PART_COLUMNS =
  "id, question_id, part_label, marks, sort_order, markscheme_latex, content_latex, command_term, command_terms, latex_verified, subtopic_codes, primary_subtopic_code";

/** Each question's parts in paper order. */
export async function loadExistingParts(
  supabase: SupabaseClient,
  questionIds: readonly string[]
): Promise<Map<string, ExistingPart[]>> {
  // 50 questions a request keeps even a many-part question set under 1000 rows.
  const rows = await fetchInChunks<ExistingPart & { question_id: string }>(
    questionIds,
    (chunk) => supabase.from("question_parts").select(EXISTING_PART_COLUMNS).in("question_id", chunk),
    50
  );
  const byQuestion = new Map<string, ExistingPart[]>();
  for (const r of rows) byQuestion.set(r.question_id, [...(byQuestion.get(r.question_id) ?? []), r]);
  for (const parts of byQuestion.values()) {
    parts.sort((a, b) => a.sort_order - b.sort_order || a.part_label.localeCompare(b.part_label));
  }
  return byQuestion;
}

export interface QuestionUse {
  target: InUseTarget;
  /** Tests that disagree on a part's marks: the teacher settles which is right. */
  conflicts: string[];
}

interface SavedExamQuestion {
  id?: unknown;
  partSubtopics?: { partLabel?: unknown }[] | null;
}

const labelName = (l: string) => (l ? `(${l})` : "the question");

/**
 * The labels each question's tests and saved exams use, as the planner's
 * in-use target, matching markscheme_question_in_use(): tests by code, saved
 * exams (live and archived) by question id. A saved exam item with no
 * partSubtopics is one whole-question item, as the test import reads it.
 * Questions nothing uses are absent from the map.
 */
export async function loadQuestionUse(
  supabase: SupabaseClient,
  questions: readonly { id: string; code: string }[]
): Promise<Map<string, QuestionUse>> {
  const ids = new Set(questions.map((q) => q.id));
  const idByCode = new Map(questions.map((q) => [q.code, q.id]));
  const labels = new Map<string, Set<string>>();
  const marks = new Map<string, Map<string, Set<number>>>();
  const add = (questionId: string, label: string, max?: number | null) => {
    labels.set(questionId, (labels.get(questionId) ?? new Set<string>()).add(label));
    if (typeof max === "number") {
      const byLabel = marks.get(questionId) ?? new Map<string, Set<number>>();
      byLabel.set(label, (byLabel.get(label) ?? new Set<number>()).add(max));
      marks.set(questionId, byLabel);
    }
  };

  const items = await fetchInChunks<{ ib_question_code: string; part_label: string | null; max_marks: number | null }>(
    [...idByCode.keys()],
    (chunk) => supabase.from("test_items").select("ib_question_code, part_label, max_marks").in("ib_question_code", chunk)
  );
  for (const it of items) {
    const id = idByCode.get(it.ib_question_code);
    if (id) add(id, toBankLabel(it.part_label ?? ""), it.max_marks);
  }
  for (const table of ["saved_exams", "archived_saved_exams"]) {
    const exams = await fetchAllRows<{ questions: unknown }>((from, to) =>
      supabase.from(table).select("id, questions").order("id").range(from, to)
    );
    for (const exam of exams) {
      if (!Array.isArray(exam.questions)) continue;
      for (const q of exam.questions as SavedExamQuestion[]) {
        if (typeof q?.id !== "string" || !ids.has(q.id)) continue;
        const subs = Array.isArray(q.partSubtopics) ? q.partSubtopics : [];
        if (subs.length === 0) add(q.id, "");
        for (const s of subs) add(q.id, toBankLabel(typeof s?.partLabel === "string" ? s.partLabel : ""));
      }
    }
  }

  const out = new Map<string, QuestionUse>();
  for (const [id, set] of labels) {
    const maxMarks: Record<string, number> = {};
    const conflicts: string[] = [];
    for (const [label, values] of marks.get(id) ?? new Map<string, Set<number>>()) {
      if (values.size === 1) maxMarks[label] = [...values][0];
      else conflicts.push(`Its tests disagree on ${labelName(label)}: ${[...values].join(" vs ")} marks.`);
    }
    out.set(id, { target: { labels: [...set], maxMarks }, conflicts });
  }
  return out;
}
