/**
 * Practice sets: the data half. Pure logic lives in practice-sets.ts.
 *
 * ---------------------------------------------------------------------------
 * Mark schemes
 * ---------------------------------------------------------------------------
 * Nothing in this module can produce a mark scheme URL. There is no code path
 * for it: every image query filters image_type = 'question', and the paths are
 * run through selectQuestionImagePaths, which intersects the teacher's curated
 * list with that filtered set before anything is signed.
 *
 * That is deliberate rather than incidental, because RLS alone is not enough
 * here. A student's own JWT cannot read markscheme rows or objects any more
 * (migration 20260911142419), but the teacher's PREVIEW of a student's page
 * runs on the teacher's client, where RLS allows everything. If the filter
 * lived only in the policy, the preview would quietly show the teacher a page
 * their students do not get -- which is the one thing a preview must not do.
 *
 * When mark schemes are eventually released to students, all three of these
 * have to move together, and in this order:
 *   1. widen the RLS on question_images and on the question-images bucket;
 *   2. add the fetch here, gated on practice_sets.markscheme_released_at;
 *   3. render it.
 * Doing (3) alone renders nothing; doing (2) alone is a leak the moment (1)
 * lands. There is no shortcut through this module.
 */

import { createClient } from "@/lib/supabase/server";
import {
  buildPracticeSetView,
  isPracticeTier,
  selectQuestionImagePaths,
  type PracticeItem,
  type PracticeSetView,
  type PracticeSubtopic,
} from "@/lib/practice-sets";

/** An hour: long enough to work through a set in one sitting without a
 *  refresh, short enough that a copied URL is not a handout. */
const SIGNED_URL_TTL_SECONDS = 3600;

export interface PracticeSetSummary {
  id: string;
  courseId: string;
  name: string;
}

/**
 * The courses whose practice sets this student should see.
 *
 * Both tables, for the reason set out in migration 20260911142643: `students`
 * is the enrolment table and `invited_students` is the roster, they disagree
 * in production, and a student missing from the first is still in the class.
 * This mirrors public.student_is_on_course_roster so the app and the RLS
 * cannot drift into showing different things.
 */
export async function getStudentCourseIds(
  profileId: string,
  email: string | null
): Promise<string[]> {
  const supabase = await createClient();

  const [enrolled, invited] = await Promise.all([
    supabase.from("students").select("course_id").eq("profile_id", profileId),
    supabase.from("invited_students").select("course_id").eq("profile_id", profileId),
  ]);

  const ids = new Set<string>();
  for (const row of enrolled.data ?? []) if (row.course_id) ids.add(row.course_id as string);
  for (const row of invited.data ?? []) if (row.course_id) ids.add(row.course_id as string);

  // Roster rows are matched on email as well, for a registered student whose
  // profile_id was never backfilled. Only worth a second query when the
  // profile-keyed lookups found nothing.
  if (ids.size === 0 && email) {
    const { data } = await supabase
      .from("invited_students")
      .select("course_id")
      .ilike("email", email);
    for (const row of data ?? []) if (row.course_id) ids.add(row.course_id as string);
  }

  return [...ids];
}

/**
 * Released practice sets for these courses, newest first.
 *
 * `released_at` is filtered here and not left to RLS on purpose. A student's
 * policy already hides unreleased sets, but a teacher's does not, and this is
 * the query behind the teacher's preview too -- without the filter the
 * preview would show a draft set the class cannot see.
 */
export async function getReleasedPracticeSets(courseIds: string[]): Promise<PracticeSetSummary[]> {
  if (courseIds.length === 0) return [];
  const supabase = await createClient();

  const { data } = await supabase
    .from("practice_sets")
    .select("id, course_id, name, released_at")
    .in("course_id", courseIds)
    .not("released_at", "is", null)
    .order("released_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    courseId: row.course_id as string,
    name: row.name as string,
  }));
}

/** Cheap existence check for the dashboard tile. */
export async function hasReleasedPracticeSet(courseIds: string[]): Promise<boolean> {
  if (courseIds.length === 0) return false;
  const supabase = await createClient();

  const { count } = await supabase
    .from("practice_sets")
    .select("id", { count: "exact", head: true })
    .in("course_id", courseIds)
    .not("released_at", "is", null);

  return (count ?? 0) > 0;
}

interface ItemRow {
  position: number;
  source: string;
  ib_question_code: string | null;
  question_latex: string | null;
  tier: string;
  marks: number;
  subtopic_codes: string[] | null;
  question_image_paths: string[] | null;
}

/**
 * One practice set, ready to render.
 *
 * Returns null when the set does not exist, is not released, or is not one of
 * `courseIds` -- the caller passes the viewer's own courses, so a guessed set
 * id from another class resolves to a plain not-found rather than a partly
 * rendered page.
 *
 * includeQuestionCodes is for the teacher's preview only. Students are not
 * shown the IB code: it is the exact string that finds a published mark
 * scheme in one search, and the whole point of this set right now is that the
 * answers are not available yet. Numbering the questions 1..n is what they
 * need to talk about them in class anyway.
 */
export async function loadPracticeSetView(options: {
  setId: string;
  courseIds: string[];
  includeQuestionCodes: boolean;
}): Promise<PracticeSetView | null> {
  const { setId, courseIds, includeQuestionCodes } = options;
  if (courseIds.length === 0) return null;

  const supabase = await createClient();

  const { data: setRow } = await supabase
    .from("practice_sets")
    .select("id, course_id, name, description, released_at, markscheme_released_at")
    .eq("id", setId)
    .not("released_at", "is", null)
    .in("course_id", courseIds)
    .maybeSingle();

  if (!setRow) return null;

  const { data: itemRows } = await supabase
    .from("practice_set_items")
    .select(
      "position, source, ib_question_code, question_latex, tier, marks, subtopic_codes, question_image_paths"
    )
    .eq("practice_set_id", setId)
    .order("position");

  const items = (itemRows ?? []) as ItemRow[];
  if (items.length === 0) {
    return buildPracticeSetView({
      id: setRow.id as string,
      name: setRow.name as string,
      description: (setRow.description as string | null) ?? null,
      markschemeReleased: setRow.markscheme_released_at !== null,
      items: [],
    });
  }

  // Only bank items have a code to resolve. A generated item carries its own
  // question text and never touches ib_questions or the image bucket.
  const bankItems = items.filter(
    (item): item is ItemRow & { ib_question_code: string } =>
      item.source === "bank" && !!item.ib_question_code
  );
  const codes = [...new Set(bankItems.map((item) => item.ib_question_code))];

  const { data: questionRows } = codes.length
    ? await supabase.from("ib_questions").select("id, code, paper").in("code", codes)
    : { data: [] };

  const questionIdByCode = new Map<string, string>();
  const paperByCode = new Map<string, number | null>();
  for (const row of questionRows ?? []) {
    questionIdByCode.set(row.code as string, row.id as string);
    paperByCode.set(row.code as string, (row.paper as number | null) ?? null);
  }

  // image_type is pinned here, not just in RLS -- this same query runs on a
  // teacher's client during a preview, where RLS would happily return the
  // mark scheme rows too.
  const questionIds = [...questionIdByCode.values()];
  const { data: imageRows } = questionIds.length
    ? await supabase
        .from("question_images")
        .select("question_id, storage_path, sort_order")
        .eq("image_type", "question")
        .in("question_id", questionIds)
        .order("sort_order")
    : { data: [] };

  const availableByQuestionId = new Map<string, string[]>();
  for (const row of imageRows ?? []) {
    const list = availableByQuestionId.get(row.question_id as string) ?? [];
    list.push(row.storage_path as string);
    availableByQuestionId.set(row.question_id as string, list);
  }

  const subtopicCodes = [...new Set(items.flatMap((item) => item.subtopic_codes ?? []))];
  const descriptorByCode = new Map<string, string | null>();
  if (subtopicCodes.length > 0) {
    const { data: subtopicRows } = await supabase
      .from("subtopics")
      .select("code, descriptor")
      .in("code", subtopicCodes);
    for (const row of subtopicRows ?? []) {
      descriptorByCode.set(row.code as string, (row.descriptor as string | null) ?? null);
    }
  }

  // Every path the page will show, signed in one round trip rather than one
  // per image: a 13-question set is 13+ separate requests otherwise.
  const pathsByPosition = new Map<number, string[]>();
  const allPaths: string[] = [];
  for (const item of bankItems) {
    const questionId = questionIdByCode.get(item.ib_question_code);
    const available = questionId ? (availableByQuestionId.get(questionId) ?? []) : [];
    const chosen = selectQuestionImagePaths(item.question_image_paths ?? [], available);
    pathsByPosition.set(item.position, chosen);
    allPaths.push(...chosen);
  }

  const signedUrlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("question-images")
      .createSignedUrls([...new Set(allPaths)], SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) signedUrlByPath.set(entry.path, entry.signedUrl);
    }
  }

  const built: PracticeItem[] = items.map((item) => {
    const subtopics: PracticeSubtopic[] = (item.subtopic_codes ?? []).map((code) => ({
      code,
      descriptor: descriptorByCode.get(code) ?? null,
    }));

    return {
      position: item.position,
      // The column is CHECK-constrained to the three tiers; the guard is for
      // the type, and anything unrecognised lands in the middle rather than
      // vanishing from a set the teacher has already released.
      tier: isPracticeTier(item.tier) ? item.tier : "medium",
      marks: item.marks,
      subtopics,
      paper: item.ib_question_code ? (paperByCode.get(item.ib_question_code) ?? null) : null,
      imageUrls: (pathsByPosition.get(item.position) ?? [])
        .map((path) => signedUrlByPath.get(path))
        .filter((url): url is string => !!url),
      // A generated question IS its text; a bank question is its scanned
      // page. Never both, so the page has one thing to render either way.
      questionLatex: item.source === "generated" ? item.question_latex : null,
      questionCode: includeQuestionCodes ? item.ib_question_code : null,
    };
  });

  return buildPracticeSetView({
    id: setRow.id as string,
    name: setRow.name as string,
    description: (setRow.description as string | null) ?? null,
    markschemeReleased: setRow.markscheme_released_at !== null,
    items: built,
  });
}
