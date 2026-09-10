import { createClient } from "@/lib/supabase/server";
import { computeDisagreement } from "@/lib/reflection-utils";
import { fetchAllRows, loadInvitedRoster } from "@/lib/na-scanning";
import { buildSelfScoreRows, SELF_SCORE_CONFLICT_TARGET } from "@/lib/reflection-self-scores";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { correctionsKey } from "@/lib/storage-keys";
import type { GradeBoundary } from "@/lib/grade-bands";
import type {
  ReflectionTest,
  ReflectionItem,
  SelfScore,
  PdfUpload,
  StudentReflectionRow,
  SubtopicMastery,
  HeatmapCell,
} from "@/lib/reflection-types";

export { computeDisagreement };

/** Stands in for an empty id list. PostgREST renders `.in("col", [])` as
 *  `in.()`, which is a syntax error rather than a match-nothing filter, so a
 *  uuid that cannot exist is passed instead. */
const NO_SUCH_UUID = "00000000-0000-0000-0000-000000000000";

function computeReleaseTimestamp(
  testDate: string | null,
  examTime: string | null,
  releaseAt: string | null
): number | null {
  if (releaseAt) {
    const parsed = Date.parse(releaseAt);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (!testDate || !examTime) return null;
  const parsed = Date.parse(`${testDate}T${examTime.slice(0, 5)}:00`);
  if (Number.isNaN(parsed)) return null;
  return parsed + 80 * 60 * 1000;
}

/** Core of getTestsForStudent/getTestsForInvitedStudent: every test visible
 *  from a set of enrolled course ids, expanded to their track family (a
 *  test attached to one class of a track, e.g. Formative Assessment 1 on
 *  9G, is sat by the whole track, so a sibling class's list must include
 *  it -- track_family_course_ids is the same rule the student RLS policies
 *  on tests/test_items use, migration student_track_family_test_access). */
async function getTestsVisibleToCourses(courseIds: string[]): Promise<ReflectionTest[]> {
  if (courseIds.length === 0) return [];
  const supabase = await createClient();

  const allCourseIds = new Set(courseIds);
  for (const courseId of courseIds) {
    const { data: family } = await supabase.rpc("track_family_course_ids", { p_course_id: courseId });
    for (const id of (family ?? []) as string[]) allCourseIds.add(id);
  }

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, name, test_date, exam_time, release_at, total_marks, course_id, paper_url, mark_scheme_url, hidden, require_self_assessment")
    .in("course_id", [...allCourseIds])
    .eq("hidden", false)
    .order("test_date", { ascending: false });

  if (error) {
    // Fallback if migration 045/049/this one's columns haven't been applied yet
    if (/paper_url|mark_scheme_url|hidden|exam_time|release_at|require_self_assessment/.test(error.message)) {
      const { data: fallback, error: fallbackError } = await supabase
        .from("tests")
        .select("id, name, test_date, total_marks, course_id")
        .in("course_id", [...allCourseIds])
        .order("test_date", { ascending: false });
      if (fallbackError) throw fallbackError;
      return (fallback ?? []).map((t) => ({ ...t, exam_time: null, release_at: null, paper_url: null, mark_scheme_url: null, hidden: false, require_self_assessment: true })) as ReflectionTest[];
    }
    throw error;
  }
  const now = Date.now();
  return ((tests ?? []) as ReflectionTest[]).filter((t) => {
    const unlockAt = computeReleaseTimestamp(t.test_date, t.exam_time, t.release_at);
    return unlockAt === null || unlockAt <= now;
  });
}

/** Fetch all tests visible to a student (via their course enrollment). */
export async function getTestsForStudent(
  studentProfileId: string
): Promise<ReflectionTest[]> {
  const supabase = await createClient();

  // Get the student's course IDs
  const { data: enrollments } = await supabase
    .from("students")
    .select("course_id")
    .eq("profile_id", studentProfileId);

  if (!enrollments || enrollments.length === 0) return [];
  return getTestsVisibleToCourses(enrollments.map((e) => e.course_id as string));
}

/** Same as getTestsForStudent, but for a teacher's "view as" preview of an
 *  invited_students row that has no profiles row yet (never signed in).
 *  There is no students row to look an enrolment up through in that case --
 *  the roster's own course_id, which the caller already has from
 *  resolveViewAs, stands in directly. */
export async function getTestsForInvitedStudent(courseId: string): Promise<ReflectionTest[]> {
  return getTestsVisibleToCourses([courseId]);
}

/** Fetch all tests (teacher view). */
export async function getAllTests(): Promise<ReflectionTest[]> {
  const supabase = await createClient();

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, name, test_date, exam_time, release_at, total_marks, course_id, paper_url, mark_scheme_url, hidden, require_self_assessment")
    .eq("hidden", false)
    .order("test_date", { ascending: false });

  if (error) {
    // Fallback if migration 045/049/this one's columns haven't been applied yet
    if (/paper_url|mark_scheme_url|hidden|exam_time|release_at|require_self_assessment/.test(error.message)) {
      const { data: fallback, error: fallbackError } = await supabase
        .from("tests")
        .select("id, name, test_date, total_marks, course_id")
        .order("test_date", { ascending: false });
      if (fallbackError) throw fallbackError;
      return (fallback ?? []).map((t) => ({ ...t, exam_time: null, release_at: null, paper_url: null, mark_scheme_url: null, hidden: false, require_self_assessment: true })) as ReflectionTest[];
    }
    throw error;
  }
  return (tests ?? []) as ReflectionTest[];
}

/** Fetch test items with teacher marks and self-scores for a student. */
export async function getReflectionItems(
  testId: string,
  studentId: string
): Promise<ReflectionItem[]> {
  const supabase = await createClient();

  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("code, descriptor");

  const subtopicMap = new Map(
    (subtopics ?? []).map((s) => [s.code, s.descriptor])
  );

  // Get test items
  const { data: items, error: itemsError } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks, subtopic_codes")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  // Get teacher marks
  const itemIds = items.map((i) => i.id);
  const { data: marks } = await supabase
    .from("student_marks")
    .select("test_item_id, marks_awarded")
    .eq("student_id", studentId)
    .in("test_item_id", itemIds);

  // Get self-scores
  const { data: selfScores } = await supabase
    .from("student_self_scores")
    .select("test_item_id, self_marks")
    .eq("student_id", studentId)
    .in("test_item_id", itemIds);

  const marksMap = new Map(
    (marks ?? []).map((m) => [m.test_item_id, m.marks_awarded])
  );
  const selfMap = new Map(
    (selfScores ?? []).map((s) => [s.test_item_id, s.self_marks])
  );

  return items.map((item) => ({
    id: item.id,
    test_item_id: item.id,
    question_number: item.question_number,
    part_label: item.part_label,
    max_marks: item.max_marks,
    subtopic_codes: item.subtopic_codes ?? [],
    subtopic_labels: (item.subtopic_codes ?? []).map(
      (code: string) => `${code} — ${subtopicMap.get(code) ?? code}`
    ),
    marks_awarded: marksMap.get(item.id) ?? null,
    self_marks: selfMap.get(item.id) ?? null,
  }));
}

/** Same as getReflectionItems, but for a teacher's "view as" preview of a
 *  student who has no profiles row yet. Teacher marks are looked up by
 *  invited_student_id -- the fallback key student_marks carries for a mark
 *  entered before the student's first login (migration
 *  student_marks_invited_student_fallback); getReflectionItems's own
 *  student_id-keyed query would find none of them, same as the real app
 *  would for that student today. Self-assessment is always empty here:
 *  student_self_scores has no invited-student fallback, correctly -- an
 *  account that doesn't exist yet cannot have submitted one. */
export async function getReflectionItemsForInvitedStudent(
  testId: string,
  invitedStudentId: string
): Promise<ReflectionItem[]> {
  const supabase = await createClient();

  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("code, descriptor");

  const subtopicMap = new Map(
    (subtopics ?? []).map((s) => [s.code, s.descriptor])
  );

  const { data: items, error: itemsError } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks, subtopic_codes")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  const itemIds = items.map((i) => i.id);
  const { data: marks } = await supabase
    .from("student_marks")
    .select("test_item_id, marks_awarded")
    .eq("invited_student_id", invitedStudentId)
    .in("test_item_id", itemIds);

  const marksMap = new Map(
    (marks ?? []).map((m) => [m.test_item_id, m.marks_awarded])
  );

  return items.map((item) => ({
    id: item.id,
    test_item_id: item.id,
    question_number: item.question_number,
    part_label: item.part_label,
    max_marks: item.max_marks,
    subtopic_codes: item.subtopic_codes ?? [],
    subtopic_labels: (item.subtopic_codes ?? []).map(
      (code: string) => `${code} — ${subtopicMap.get(code) ?? code}`
    ),
    marks_awarded: marksMap.get(item.id) ?? null,
    self_marks: null,
  }));
}

/** Submit student self-assessment scores.
 *
 *  One upsert for the whole assessment, for the reason spelled out in
 *  lib/reflection-self-scores.ts: a row-at-a-time loop that fails partway
 *  leaves a half-saved self-assessment behind, and a half-saved one is worse
 *  than none. */
export async function submitSelfScores(
  studentId: string,
  testId: string,
  scores: SelfScore[]
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("student_self_scores")
    .upsert(buildSelfScoreRows(scores, studentId), {
      onConflict: SELF_SCORE_CONFLICT_TARGET,
    });
  if (error) throw error;
}

/** Upload a PDF to Supabase Storage. */
export async function uploadCorrectionsPdf(
  studentId: string,
  testId: string,
  file: File
): Promise<PdfUpload> {
  const supabase = await createClient();

  const storagePath = correctionsKey(studentId, testId, file.name);

  const { error: uploadError } = await supabase.storage
    .from("corrections")
    .upload(storagePath, file, { upsert: true });

  if (uploadError) throw uploadError;

  // Upsert the record
  const { data, error } = await supabase
    .from("pdf_uploads")
    .upsert(
      {
        student_id: studentId,
        test_id: testId,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: "student_id,test_id" }
    )
    .select()
    .single();

  if (error) throw error;
  return data as PdfUpload;
}

/** Delete the PDF upload record and remove the file from storage. */
export async function clearPdfUpload(
  studentId: string,
  testId: string
): Promise<void> {
  const supabase = await createClient();

  // Get existing upload record so we can remove the file from storage
  const { data: existing } = await supabase
    .from("pdf_uploads")
    .select("storage_path")
    .eq("student_id", studentId)
    .eq("test_id", testId)
    .maybeSingle();

  if (existing?.storage_path) {
    // Do not let this fail quietly. Until the policies added in
    // 20260910181334_corrections_bucket_update_delete_policies.sql, the bucket
    // had no DELETE policy, so this call removed nothing while the row below
    // was deleted anyway -- and because neither half of the result was read,
    // every object in the bucket ended up stranded with nobody aware of it.
    //
    // RLS filtering a removal out is not reported as an error: the call comes
    // back with an empty `data` and `error` null. The returned list is the only
    // honest signal that the object actually went.
    const { data: removed, error: removeError } = await supabase.storage
      .from("corrections")
      .remove([existing.storage_path]);

    if (removeError || !removed?.length) {
      console.error(
        "[clearPdfUpload] correction object was not removed from storage",
        {
          storagePath: existing.storage_path,
          studentId,
          testId,
          reason: removeError?.message ?? "storage reported no object removed",
        }
      );
    }
  }

  await supabase
    .from("pdf_uploads")
    .delete()
    .eq("student_id", studentId)
    .eq("test_id", testId);
}

/** Get the PDF upload record for a student+test. */
export async function getPdfUpload(
  studentId: string,
  testId: string
): Promise<PdfUpload | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("pdf_uploads")
    .select("*")
    .eq("student_id", studentId)
    .eq("test_id", testId)
    .maybeSingle();

  return (data as PdfUpload | null) ?? null;
}

/** Get mastery stats for a student, grouped by subtopic with section info. */
export async function getStudentMastery(
  studentId: string
): Promise<SubtopicMastery[]> {
  const supabase = await createClient();

  // Get all marks for the student
  const { data: marks } = await supabase
    .from("student_marks")
    .select(
      "marks_awarded, test_item_id, test_items(max_marks, subtopic_codes)"
    )
    .eq("student_id", studentId);

  // Get self-scores
  const { data: selfScores } = await supabase
    .from("student_self_scores")
    .select("self_marks, test_item_id, test_items(max_marks, subtopic_codes)")
    .eq("student_id", studentId);

  // Get subtopic descriptors AND section numbers
  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("code, descriptor, section");

  const subtopicMap = new Map(
    (subtopics ?? []).map((s) => [s.code, { descriptor: s.descriptor, section: s.section as number }])
  );

  // Aggregate by subtopic
  const agg = new Map<
    string,
    { total: number; awarded: number; self: number }
  >();

  for (const m of marks ?? []) {
    const item = m.test_items as unknown as {
      max_marks: number;
      subtopic_codes: string[];
    } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.total += item.max_marks;
      cur.awarded += m.marks_awarded;
      agg.set(code, cur);
    }
  }

  for (const s of selfScores ?? []) {
    const item = s.test_items as unknown as {
      max_marks: number;
      subtopic_codes: string[];
    } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.self += s.self_marks;
      // Only add total if not already counted from marks
      if (!agg.has(code) || cur.total === 0) {
        cur.total += item.max_marks;
      }
      agg.set(code, cur);
    }
  }

  const results: SubtopicMastery[] = [];
  for (const [code, data] of agg) {
    if (data.total === 0) continue;
    const meta = subtopicMap.get(code);
    results.push({
      code,
      descriptor: meta?.descriptor ?? code,
      section: meta?.section ?? 0,
      total_marks: data.total,
      marks_awarded: data.awarded,
      self_marks: data.self,
      percentage: Math.round((100 * data.awarded) / data.total),
      self_percentage: Math.round((100 * data.self) / data.total),
    });
  }

  results.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return results;
}

/** Get class-wide reflection data for teacher dashboard. */
export async function getClassReflectionData(
  testId: string
): Promise<{
  items: { id: string; question_number: number; part_label: string; max_marks: number; subtopic_codes: string[]; subtopic_labels: string[] }[];
  rows: StudentReflectionRow[];
  /** tests.total_marks, for the percentage behind each achievement level. */
  totalMarks: number | null;
  /** The test's grade boundaries, or null when it has no set assigned -- the
   *  dashboard then falls back to generic bands and says so. */
  boundaries: GradeBoundary[] | null;
}> {
  const supabase = await createClient();

  // Get test items
  const { data: items } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks, subtopic_codes")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("code, descriptor");

  const subtopicMap = new Map(
    (subtopics ?? []).map((s) => [s.code, s.descriptor])
  );

  const itemsWithLabels = (items ?? []).map((item) => ({
    ...item,
    subtopic_codes: item.subtopic_codes ?? [],
    subtopic_labels: (item.subtopic_codes ?? []).map(
      (code: string) => `${code} — ${subtopicMap.get(code) ?? code}`
    ),
  }));

  if (!itemsWithLabels.length) return { items: [], rows: [], totalMarks: null, boundaries: null };

  // Get the test to find course
  const { data: test } = await supabase
    .from("tests")
    .select("course_id, total_marks, boundary_set_id")
    .eq("id", testId)
    .single();

  // Levels come from the test's own boundary set where it has one, so the
  // dashboard and the gradebook never disagree about a student's grade.
  let boundaries: GradeBoundary[] | null = null;
  if (test?.boundary_set_id) {
    const { data: rows } = await supabase
      .from("grade_boundaries")
      .select("grade, min_proportion")
      .eq("set_id", test.boundary_set_id)
      .order("grade", { ascending: true });
    boundaries = (rows ?? []).map((b) => ({
      grade: b.grade as number,
      min_proportion: Number(b.min_proportion),
    }));
    if (boundaries.length === 0) boundaries = null;
  }
  const totalMarks = (test?.total_marks as number | null) ?? null;

  if (!test?.course_id) return { items: itemsWithLabels, rows: [], totalMarks, boundaries };

  // The roster, not the accounts. This used to read the `students` table,
  // which only gains a row on a student's first sign-in -- so a class where
  // nobody has signed in yet returned zero rows here and the dashboard drew
  // its columns above an empty grid, with no way to tell that apart from a
  // test nobody had sat. Every student who was invited is on the roster from
  // the moment the teacher imports them, whether or not they ever log in.
  //
  // includeTrackSiblings because a test is attached to ONE class while the
  // paper is sat by the whole track: Formative Assessment 1 hangs off 9G and
  // has marks for 50 students across 9A, 9C and 9G. Scoping to the test's own
  // course would show 17 of them.
  const { roster, sourceCourseIds } = await loadInvitedRoster(supabase, test.course_id, {
    includeTrackSiblings: true,
  });
  if (roster.length === 0) return { items: itemsWithLabels, rows: [], totalMarks, boundaries };

  const itemIds = itemsWithLabels.map((i) => i.id);
  const invitedIds = roster.map((r) => r.invitedId);
  const profileIds = roster.map((r) => r.profileId).filter((id): id is string => !!id);

  // Marks are keyed by whichever identity existed when they were written:
  // invited_student_id for a student with no account, student_id once
  // auto_enroll_from_invitations backfills it on first sign-in. Read both and
  // resolve each row back to its roster entry, or a class that has since
  // signed in would lose the marks recorded before they did.
  //
  // Paged: one 50-student assessment is 2050 mark rows, past PostgREST's
  // silent 1000-row cap.
  type MarkRow = { student_id: string | null; invited_student_id: string | null; test_item_id: string; marks_awarded: number | null };
  const marksByIdentity = async (column: "student_id" | "invited_student_id", ids: string[]) =>
    ids.length === 0
      ? []
      : await fetchAllRows<MarkRow>((from, to) =>
          supabase
            .from("student_marks")
            .select("student_id, invited_student_id, test_item_id, marks_awarded")
            .in(column, ids)
            .in("test_item_id", itemIds)
            .order("id", { ascending: true })
            .range(from, to)
        );

  const allMarks = [
    ...(await marksByIdentity("invited_student_id", invitedIds)),
    ...(await marksByIdentity("student_id", profileIds)),
  ];

  // marks[invitedId][itemId]. Keyed on the roster row so both identities land
  // in the same place; a row carrying both columns resolves once.
  const profileToInvited = new Map(
    roster.filter((r) => r.profileId).map((r) => [r.profileId as string, r.invitedId])
  );
  const markMap = new Map<string, Map<string, number>>();
  for (const m of allMarks) {
    const invitedId =
      m.invited_student_id ?? (m.student_id ? profileToInvited.get(m.student_id) : undefined);
    if (!invitedId || m.marks_awarded === null) continue;
    if (!markMap.has(invitedId)) markMap.set(invitedId, new Map());
    markMap.get(invitedId)!.set(m.test_item_id, m.marks_awarded);
  }

  // There are two independent hide flags with two independent toggles:
  // invited_students.hidden (setInvitedStudentHidden), which loadInvitedRoster
  // already filters, and students.hidden (setStudentHidden), which only
  // exists once a student has enrolled. Reading the roster instead of the
  // `students` table dropped the second one, so a student the teacher had
  // deliberately hidden came back -- and could not be hidden again, because
  // the Students page offers the invited toggle only for people who are NOT
  // yet enrolled. Both flags are honoured, as the gradebook already does.
  const { data: enrolled } = await supabase
    .from("students")
    .select("profile_id, hidden")
    .in("course_id", sourceCourseIds)
    .in("profile_id", profileIds.length ? profileIds : [NO_SUCH_UUID]);
  const hiddenProfiles = new Set(
    (enrolled ?? []).filter((e) => e.hidden).map((e) => e.profile_id as string)
  );

  // Self-scores and corrections uploads stay profile-keyed: both are things
  // the student does in their own account, so a student who has never signed
  // in correctly has none rather than being missing data.
  //
  // Paged for the same reason the mark reads are: this used to cover one
  // class and now covers a whole track, so it can outgrow PostgREST's silent
  // 1000-row cap once a cohort actually self-assesses.
  type SelfRow = { student_id: string; test_item_id: string; self_marks: number | null };
  const allSelf = profileIds.length
    ? await fetchAllRows<SelfRow>((from, to) =>
        supabase
          .from("student_self_scores")
          .select("student_id, test_item_id, self_marks")
          .in("student_id", profileIds)
          .in("test_item_id", itemIds)
          .order("id", { ascending: true })
          .range(from, to)
      )
    : [];

  const { data: uploads } = await supabase
    .from("pdf_uploads")
    .select("student_id, storage_path, file_name")
    .eq("test_id", testId)
    .in("student_id", profileIds.length ? profileIds : [NO_SUCH_UUID]);

  const uploadMap = new Map(
    (uploads ?? []).map((u) => [u.student_id, u])
  );

  // Build rows with disagreement computed server-side
  const rows: StudentReflectionRow[] = roster.map((s) => {
    const marks = markMap.get(s.invitedId);
    const rowItems = itemsWithLabels.map((item) => ({
      test_item_id: item.id,
      marks_awarded: marks?.get(item.id) ?? null,
      self_marks:
        (s.profileId
          ? allSelf?.find((ss) => ss.student_id === s.profileId && ss.test_item_id === item.id)
              ?.self_marks
          : null) ?? null,
    }));

    // Compute disagreement for this student
    const reflectionItems: ReflectionItem[] = rowItems.map((ri, idx) => ({
      id: itemsWithLabels[idx].id,
      test_item_id: ri.test_item_id,
      question_number: itemsWithLabels[idx].question_number,
      part_label: itemsWithLabels[idx].part_label,
      max_marks: itemsWithLabels[idx].max_marks,
      subtopic_codes: itemsWithLabels[idx].subtopic_codes ?? [],
      subtopic_labels: itemsWithLabels[idx].subtopic_labels ?? [],
      marks_awarded: ri.marks_awarded,
      self_marks: ri.self_marks,
    }));
    const disagreement = computeDisagreement(reflectionItems);

    const upload = s.profileId ? uploadMap.get(s.profileId) : undefined;
    // Build a public-style path; the client can create a signed URL if needed
    const pdf_url = upload
      ? supabase.storage.from("corrections").getPublicUrl(upload.storage_path).data.publicUrl
      : null;

    return {
      // The opaque subject id every grading endpoint understands: a real
      // profiles.id once the student has an account, "invited-<id>" until
      // then (parseGradingSubject). Editing a cell posts this back, so it has
      // to carry the identity the mark can actually be written against.
      student_id: s.profileId ?? `${INVITED_SUBJECT_PREFIX}${s.invitedId}`,
      display_name: s.fullName,
      items: rowItems,
      has_upload: !!upload,
      pdf_url,
      disagreement,
      hidden: s.profileId ? hiddenProfiles.has(s.profileId) : false,
    };
  });

  rows.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return { items: itemsWithLabels, rows, totalMarks, boundaries };
}

/** Get heatmap data for class mastery. */
export async function getClassHeatmap(): Promise<HeatmapCell[]> {
  const supabase = await createClient();

  // Get visible students only
  const { data: students } = await supabase
    .from("students")
    .select("profile_id, hidden, profiles(display_name)")
    .eq("hidden", false);

  if (!students || students.length === 0) return [];

  const roster = students.map((s) => ({
    student_id: s.profile_id,
    display_name:
      (s.profiles as unknown as { display_name: string } | null)?.display_name ??
      "Unknown",
  }));

  const masteryByStudent = new Map<string, SubtopicMastery[]>();
  const subtopicSet = new Set<string>();

  for (const s of roster) {
    const mastery = await getStudentMastery(s.student_id);
    masteryByStudent.set(s.student_id, mastery);
    for (const m of mastery) subtopicSet.add(m.code);
  }

  const subtopics = [...subtopicSet].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  // If no mastery data exists yet, return empty to keep existing empty-state UX.
  if (subtopics.length === 0) return [];

  const cells: HeatmapCell[] = [];
  for (const s of roster) {
    const mastery = masteryByStudent.get(s.student_id) ?? [];
    const masteryMap = new Map(mastery.map((m) => [m.code, m.percentage]));

    for (const code of subtopics) {
      cells.push({
        student_id: s.student_id,
        display_name: s.display_name,
        subtopic_code: code,
        percentage: masteryMap.get(code) ?? 0,
        hidden: false,
      });
    }
  }

  return cells;
}
