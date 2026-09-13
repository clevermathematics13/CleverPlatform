/**
 * Loading a whole class's practice answers for the marking view.
 *
 * Teacher-side only, behind requireTeacher()/getApiTeacher(). It reads three
 * tables a student's own page never joins -- the roster, every student's
 * answers, and the teacher's marks -- which is exactly why it lives apart from
 * practice-set-service.ts rather than growing a "load everyone" flag there.
 *
 * One query per table, not one per student. Fourteen students times
 * twenty-six parts is 364 cells; fetched per student that is fourteen round
 * trips before the page can render, and the shape gets worse with the class.
 */

import { createClient } from "@/lib/supabase/server";
import { loadInvitedRoster } from "@/lib/na-scanning";
import { answerSlots } from "@/lib/practice-answers";
import {
  isEmptyAnswer,
  isStale,
  isVerdict,
  markingOrder,
  summariseCells,
  type PartProgress,
  type StudentAnswerCell,
  type Verdict,
} from "@/lib/practice-marking";

export interface MarkingPart {
  /** practice_set_items.id -- what a mark is saved against. */
  itemId: string;
  position: number;
  /** "(a)", or "" for a question with no labelled parts. */
  partLabel: string;
  /** Cells for every student on the roster, in marking order. */
  cells: StudentAnswerCell[];
  progress: PartProgress;
}

export interface MarkingQuestion {
  itemId: string;
  position: number;
  marks: number;
  subtopics: string[];
  /** Null for a scanned bank question, whose content is its images. */
  questionLatex: string | null;
  imageUrls: string[];
  parts: MarkingPart[];
  progress: PartProgress;
}

export interface MarkingView {
  setId: string;
  setName: string;
  courseName: string;
  releasedAt: string | null;
  questions: MarkingQuestion[];
  students: { invitedId: string; profileId: string | null; fullName: string }[];
  progress: PartProgress;
}

const SIGNED_URL_TTL_SECONDS = 3600;

interface AnswerRow {
  id: string;
  practice_set_item_id: string;
  profile_id: string;
  part_label: string;
  answer_latex: string;
  updated_at: string;
}

interface MarkRow {
  practice_answer_id: string;
  verdict: string;
  note: string | null;
  updated_at: string;
}

export async function loadMarkingView(setId: string): Promise<MarkingView | null> {
  const supabase = await createClient();

  const { data: set } = await supabase
    .from("practice_sets")
    .select("id, name, course_id, released_at, courses(name)")
    .eq("id", setId)
    .maybeSingle();
  if (!set) return null;

  const { data: itemRows } = await supabase
    .from("practice_set_items")
    .select("id, position, marks, subtopic_codes, question_latex, source, ib_question_code, question_image_paths")
    .eq("practice_set_id", setId)
    .order("position");
  const items = (itemRows ?? []) as unknown as {
    id: string;
    position: number;
    marks: number;
    subtopic_codes: string[] | null;
    question_latex: string | null;
    source: string;
    ib_question_code: string | null;
    question_image_paths: string[] | null;
  }[];
  if (items.length === 0) {
    return {
      setId,
      setName: set.name as string,
      courseName: courseNameOf(set),
      releasedAt: (set.released_at as string | null) ?? null,
      questions: [],
      students: [],
      progress: { answered: 0, marked: 0, stale: 0, onRoster: 0 },
    };
  }

  // The roster, not the enrolment table, for the reason set out in migration
  // 20260911142643: they disagree in production and a student missing from
  // `students` is still in the class.
  const { roster } = await loadInvitedRoster(supabase, set.course_id as string);
  const students = roster
    .map((r) => ({ invitedId: r.invitedId, profileId: r.profileId, fullName: r.fullName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const itemIds = items.map((i) => i.id);
  const { data: answerData } = await supabase
    .from("practice_answers")
    .select("id, practice_set_item_id, profile_id, part_label, answer_latex, updated_at")
    .in("practice_set_item_id", itemIds);
  const answers = (answerData ?? []) as unknown as AnswerRow[];

  // Marks are fetched by answer id rather than joined through, so a class with
  // no marking yet costs one cheap query that returns nothing.
  const answerIds = answers.map((a) => a.id);
  const { data: markData } = answerIds.length
    ? await supabase
        .from("practice_answer_marks")
        .select("practice_answer_id, verdict, note, updated_at")
        .in("practice_answer_id", answerIds)
    : { data: [] };
  const marks = new Map<string, MarkRow>();
  for (const row of (markData ?? []) as unknown as MarkRow[]) {
    marks.set(row.practice_answer_id, row);
  }

  const answerByKey = new Map<string, AnswerRow>();
  for (const a of answers) {
    answerByKey.set(`${a.practice_set_item_id}::${a.profile_id}::${a.part_label}`, a);
  }

  const subtopicLabels = await loadSubtopicLabels(
    supabase,
    [...new Set(items.flatMap((i) => i.subtopic_codes ?? []))]
  );
  const imageUrlsByItem = await loadQuestionImages(supabase, items);

  const questions: MarkingQuestion[] = items.map((item) => {
    const parts: MarkingPart[] = answerSlots(item.question_latex).map((partLabel) => {
      const cells: StudentAnswerCell[] = students.map((student) => {
        const answer = student.profileId
          ? answerByKey.get(`${item.id}::${student.profileId}::${partLabel}`)
          : undefined;
        const mark = answer ? marks.get(answer.id) : undefined;
        const answerLatex = answer?.answer_latex ?? "";
        const answerUpdatedAt = answer?.updated_at ?? null;
        const markUpdatedAt = mark?.updated_at ?? null;
        return {
          invitedId: student.invitedId,
          profileId: student.profileId,
          fullName: student.fullName,
          answerId: answer?.id ?? null,
          answerLatex,
          answerUpdatedAt,
          verdict: mark && isVerdict(mark.verdict) ? (mark.verdict as Verdict) : null,
          note: mark?.note ?? null,
          markUpdatedAt,
          empty: isEmptyAnswer(answerLatex),
          stale: isStale(answerUpdatedAt, markUpdatedAt),
        };
      });
      return {
        itemId: item.id,
        position: item.position,
        partLabel,
        cells: markingOrder(cells),
        progress: summariseCells(cells),
      };
    });

    return {
      itemId: item.id,
      position: item.position,
      marks: item.marks,
      subtopics: (item.subtopic_codes ?? []).map((c) => subtopicLabels.get(c) ?? c),
      questionLatex: item.question_latex,
      imageUrls: imageUrlsByItem.get(item.id) ?? [],
      parts,
      progress: sumProgress(parts.map((p) => p.progress)),
    };
  });

  return {
    setId,
    setName: set.name as string,
    courseName: courseNameOf(set),
    releasedAt: (set.released_at as string | null) ?? null,
    questions,
    students,
    progress: sumProgress(questions.map((q) => q.progress)),
  };
}

function courseNameOf(set: Record<string, unknown>): string {
  const course = Array.isArray(set.courses) ? set.courses[0] : set.courses;
  return (course as { name: string } | null)?.name ?? "Unassigned";
}

/**
 * onRoster is the MAXIMUM rather than the sum: it is the same class counted
 * once per part, and adding it up would say a set of thirteen questions has
 * 364 students.
 */
function sumProgress(parts: readonly PartProgress[]): PartProgress {
  return parts.reduce<PartProgress>(
    (acc, p) => ({
      answered: acc.answered + p.answered,
      marked: acc.marked + p.marked,
      stale: acc.stale + p.stale,
      onRoster: Math.max(acc.onRoster, p.onRoster),
    }),
    { answered: 0, marked: 0, stale: 0, onRoster: 0 }
  );
}

async function loadSubtopicLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  codes: string[]
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (codes.length === 0) return labels;
  const { data } = await supabase.from("subtopics").select("code, descriptor").in("code", codes);
  for (const row of data ?? []) labels.set(row.code as string, row.descriptor as string);
  return labels;
}

/**
 * Signed URLs for the scanned pages of any bank questions in the set.
 *
 * image_type is pinned here as it is everywhere else that touches this table:
 * this runs on a teacher's client, where RLS would return the mark scheme rows
 * too, and a marking screen showing the answers next to the students' work is
 * not what this screen is for.
 */
async function loadQuestionImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: { id: string; source: string; ib_question_code: string | null; question_image_paths: string[] | null }[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const bank = items.filter((i) => i.source !== "generated" && i.ib_question_code);
  if (bank.length === 0) return out;

  const codes = [...new Set(bank.map((i) => i.ib_question_code as string))];
  const { data: questions } = await supabase.from("ib_questions").select("id, code").in("code", codes);
  const idByCode = new Map((questions ?? []).map((q) => [q.code as string, q.id as string]));

  const questionIds = [...idByCode.values()];
  const { data: images } = questionIds.length
    ? await supabase
        .from("question_images")
        .select("question_id, storage_path, sort_order")
        .eq("image_type", "question")
        .in("question_id", questionIds)
        .order("sort_order")
    : { data: [] };

  const pathsByQuestion = new Map<string, string[]>();
  for (const row of images ?? []) {
    const list = pathsByQuestion.get(row.question_id as string) ?? [];
    list.push(row.storage_path as string);
    pathsByQuestion.set(row.question_id as string, list);
  }

  const allPaths: string[] = [];
  const chosenByItem = new Map<string, string[]>();
  for (const item of bank) {
    const questionId = idByCode.get(item.ib_question_code as string);
    const available = questionId ? (pathsByQuestion.get(questionId) ?? []) : [];
    const curated = item.question_image_paths ?? [];
    const chosen = curated.length > 0 ? curated.filter((p) => available.includes(p)) : available;
    const final = chosen.length > 0 ? chosen : available;
    chosenByItem.set(item.id, final);
    allPaths.push(...final);
  }

  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("question-images")
      .createSignedUrls([...new Set(allPaths)], SIGNED_URL_TTL_SECONDS);
    const urlByPath = new Map<string, string>();
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
    }
    for (const [itemId, paths] of chosenByItem) {
      out.set(itemId, paths.map((p) => urlByPath.get(p)).filter((u): u is string => !!u));
    }
  }

  return out;
}
