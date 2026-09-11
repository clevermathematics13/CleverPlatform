/**
 * Teacher-side reads and writes for practice sets.
 *
 * The student-facing half is practice-set-service.ts and is deliberately
 * separate: that one may never see a draft question or a mark scheme, and
 * keeping the two apart means a careless join here cannot widen what a
 * student can reach. Everything in this file runs behind getApiTeacher().
 */

import { createClient } from "@/lib/supabase/server";
import { isPracticeTier, type PracticeTier } from "@/lib/practice-sets";

interface ItemRowRaw {
  id: string;
  practice_set_id: string;
  position: number;
  source: string;
  tier: string;
  marks: number;
  subtopic_codes: string[] | null;
  teacher_note: string | null;
  ib_question_code: string | null;
  question_latex: string | null;
  answer_latex: string | null;
  generated_from_code: string | null;
  generator_model: string | null;
  approved_at: string | null;
}

export interface AdminItem {
  id: string;
  position: number;
  source: "bank" | "generated";
  tier: PracticeTier;
  marks: number;
  subtopicCodes: string[];
  subtopicLabels: string[];
  teacherNote: string | null;
  /** Bank items only. */
  ibQuestionCode: string | null;
  /** Generated items only. */
  questionLatex: string | null;
  answerLatex: string | null;
  generatedFromCode: string | null;
  generatorModel: string | null;
  approvedAt: string | null;
  /** A generated item that no teacher has approved is invisible to students. */
  visibleToStudents: boolean;
}

export interface AdminSet {
  id: string;
  courseId: string;
  courseName: string;
  name: string;
  description: string | null;
  releasedAt: string | null;
  markschemeReleasedAt: string | null;
  items: AdminItem[];
  totalMarks: number;
  /** How many generated items are still waiting for a teacher to read them. */
  awaitingApproval: number;
}

export async function listPracticeSetsForTeacher(): Promise<AdminSet[]> {
  const supabase = await createClient();

  const { data: setRows } = await supabase
    .from("practice_sets")
    .select("id, course_id, name, description, released_at, markscheme_released_at, courses(name)")
    .order("created_at", { ascending: false });

  const sets = setRows ?? [];
  if (sets.length === 0) return [];

  const { data: itemRows } = await supabase
    .from("practice_set_items")
    .select(
      "id, practice_set_id, position, source, tier, marks, subtopic_codes, teacher_note, " +
        "ib_question_code, question_latex, answer_latex, generated_from_code, generator_model, approved_at"
    )
    .in(
      "practice_set_id",
      sets.map((s) => s.id as string)
    )
    .order("position");

  // The generated select string is long enough that postgrest-js gives up on
  // inferring a row type and falls back to its error shape; naming the shape
  // here is what keeps the rest of this function typed.
  const rows = (itemRows ?? []) as unknown as ItemRowRaw[];

  const allCodes = [...new Set(rows.flatMap((r) => r.subtopic_codes ?? []))];
  const descriptor = new Map<string, string>();
  if (allCodes.length > 0) {
    const { data } = await supabase.from("subtopics").select("code, descriptor").in("code", allCodes);
    for (const row of data ?? []) descriptor.set(row.code as string, row.descriptor as string);
  }

  const bySet = new Map<string, AdminItem[]>();
  for (const row of rows) {
    const codes = row.subtopic_codes ?? [];
    const source = row.source === "generated" ? "generated" : "bank";
    const item: AdminItem = {
      id: row.id,
      position: row.position,
      source,
      tier: isPracticeTier(row.tier) ? (row.tier as PracticeTier) : "medium",
      marks: row.marks,
      subtopicCodes: codes,
      subtopicLabels: codes.map((c) => descriptor.get(c) ?? c),
      teacherNote: row.teacher_note ?? null,
      ibQuestionCode: row.ib_question_code ?? null,
      questionLatex: row.question_latex ?? null,
      answerLatex: row.answer_latex ?? null,
      generatedFromCode: row.generated_from_code ?? null,
      generatorModel: row.generator_model ?? null,
      approvedAt: row.approved_at ?? null,
      visibleToStudents: source === "bank" || row.approved_at !== null,
    };
    const list = bySet.get(row.practice_set_id) ?? [];
    list.push(item);
    bySet.set(row.practice_set_id, list);
  }

  return sets.map((s) => {
    const course = Array.isArray(s.courses) ? s.courses[0] : s.courses;
    const items = bySet.get(s.id as string) ?? [];
    return {
      id: s.id as string,
      courseId: s.course_id as string,
      courseName: (course as { name: string } | null)?.name ?? "Unassigned",
      name: s.name as string,
      description: (s.description as string | null) ?? null,
      releasedAt: (s.released_at as string | null) ?? null,
      markschemeReleasedAt: (s.markscheme_released_at as string | null) ?? null,
      items,
      totalMarks: items.reduce((sum, i) => sum + i.marks, 0),
      awaitingApproval: items.filter((i) => i.source === "generated" && !i.approvedAt).length,
    };
  });
}

/** The next free position in a set, so an added item lands at the end. */
export async function nextPosition(setId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("practice_set_items")
    .select("position")
    .eq("practice_set_id", setId)
    .order("position", { ascending: false })
    .limit(1);
  return ((data?.[0]?.position as number | undefined) ?? 0) + 1;
}

export interface BankQuestionFacts {
  code: string;
  paper: number | null;
  marks: number;
  subtopicCodes: string[];
  subtopicLabels: string[];
  /** The stored question images, in reading order. */
  imagePaths: string[];
}

/**
 * Everything the generator and the "add from bank" flow need about one bank
 * question. Marks and sub-topics are summed and unioned across its parts,
 * which is how a whole question's tariff is defined here.
 */
export async function loadBankQuestionFacts(code: string): Promise<BankQuestionFacts | null> {
  const supabase = await createClient();

  const { data: question } = await supabase
    .from("ib_questions")
    .select("id, code, paper")
    .eq("code", code)
    .maybeSingle();
  if (!question) return null;

  const { data: parts } = await supabase
    .from("question_parts")
    .select("marks, subtopic_codes")
    .eq("question_id", question.id as string);

  const subtopicCodes = [
    ...new Set((parts ?? []).flatMap((p) => (p.subtopic_codes as string[] | null) ?? [])),
  ];
  const descriptor = new Map<string, string>();
  if (subtopicCodes.length > 0) {
    const { data } = await supabase
      .from("subtopics")
      .select("code, descriptor")
      .in("code", subtopicCodes);
    for (const row of data ?? []) descriptor.set(row.code as string, row.descriptor as string);
  }

  // image_type pinned, as everywhere else that touches this table: a teacher's
  // client can read mark scheme rows, and the generator must never be handed
  // one by accident.
  const { data: images } = await supabase
    .from("question_images")
    .select("storage_path, sort_order")
    .eq("question_id", question.id as string)
    .eq("image_type", "question")
    .order("sort_order");

  return {
    code: question.code as string,
    paper: (question.paper as number | null) ?? null,
    marks: (parts ?? []).reduce((sum, p) => sum + ((p.marks as number) ?? 0), 0),
    subtopicCodes,
    subtopicLabels: subtopicCodes.map((c) => `${c} ${descriptor.get(c) ?? ""}`.trim()),
    imagePaths: (images ?? []).map((i) => i.storage_path as string),
  };
}
