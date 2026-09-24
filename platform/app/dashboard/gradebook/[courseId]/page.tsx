import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { notFound } from "next/navigation";
import { GradebookGrid, type GeneratedFile } from "./GradebookGrid";
import { CoursePicker } from "./CoursePicker";
import { NewScoresButton } from "./NewScoresButton";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { fetchAllRows, loadInvitedRoster } from "@/lib/na-scanning";
import { loadTrackLinks, trackFamilyCourseIds } from "@/lib/track-courses";
import { IB_SECTIONS, sectionsFromCustomContent } from "@/lib/test-sections";
import { CUTOFF_GRADES, cutoffsFromBoundaries, sameCutoffs, type GradeBoundary } from "@/lib/grade-bands";

function inferComponent(name: string): "P1" | "P2" | "P3" | "IA" | null {
  const u = name.toUpperCase();
  if (/\bIA\b/.test(u)) return "IA";
  if (/\bP3\b/.test(u)) return "P3";
  if (/\bP2\b/.test(u)) return "P2";
  if (/\bP1\b/.test(u)) return "P1";
  return null;
}

export default async function GradebookCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const profile = await requireTeacher();
  const { courseId } = await params;
  const supabase = await createClient();
  const showHidden = await getShowHiddenStudents(supabase, profile.id);

  // Course
  const { data: course } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .single();

  if (!course) notFound();

  // Classes the title can switch to -- the same non-archived list the gradebook
  // index shows. An archived course's gradebook is still reachable by URL, so
  // pin the current one in when it is not in that set.
  const { data: switchableCourses } = await supabase
    .from("courses")
    .select("id, name")
    .eq("archived", false)
    .order("name");
  const courseOptions = switchableCourses ?? [];
  const pickerCourses = courseOptions.some((c) => c.id === course.id)
    ? courseOptions
    : [{ id: course.id, name: course.name }, ...courseOptions];

  // Who this gradebook is for. A track (Grade 9 Extended) pools its member
  // classes' students; a class lists its own. Either way the students are
  // the invited roster (plus anyone registered) of sourceCourseIds.
  const { roster: invitedRoster, sourceCourseIds } = await loadInvitedRoster(supabase, courseId);

  // Tests for this course's track family (lib/track-courses.ts), ordered
  // most-recent-first. A test attached to one class of a track is sat by
  // the whole track, so it belongs on every member's gradebook and the
  // track's own.
  const testCourseIds = trackFamilyCourseIds(courseId, await loadTrackLinks(supabase, courseId));
  //
  // hidden_from_gradebook, not hidden: the latter keeps a test out of the
  // students' reflection dropdown, which is a separate decision. A paper with
  // an approximate boundary set is exactly the case where the teacher wants it
  // out of the students' hands and still in front of them here.
  const { data: rawTests } = await supabase
    .from("tests")
    .select("id, name, test_date, total_marks, boundary_set_id, custom_content")
    .in("course_id", testCourseIds)
    .eq("hidden_from_gradebook", false)
    .order("test_date", { ascending: false });

  const testList = rawTests ?? [];
  const testIds = testList.map((t) => t.id);

  // Test items (question parts)
  let allItems: {
    id: string;
    test_id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
    sort_order: number;
    ib_question_code?: string | null;
  }[] = [];
  if (testIds.length > 0) {
    const { data } = await supabase
      .from("test_items")
      .select("id, test_id, question_number, part_label, max_marks, sort_order, ib_question_code")
      .in("test_id", testIds)
      .order("sort_order");
    allItems = data ?? [];
  }

  // Students enrolled in this course (or, for a track, in any member class)
  let studentsQuery = supabase
    .from("students")
    .select("profile_id, profiles(display_name)")
    .in("course_id", sourceCourseIds);
  if (!showHidden) studentsQuery = studentsQuery.eq("hidden", false);
  const { data: rawStudents } = await studentsQuery;

  const registeredStudents = (rawStudents ?? []).map((s) => {
    const prof = s.profiles as unknown;
    const displayName =
      prof && typeof prof === "object" && !Array.isArray(prof)
        ? (prof as { display_name: string }).display_name
        : Array.isArray(prof) && prof.length > 0
        ? (prof[0] as { display_name: string }).display_name
        : null;
    return {
      profile_id: s.profile_id as string,
      name: displayName ?? "Unknown",
    };
  });

  // Students imported (e.g. via Google Classroom) but who have never logged
  // in have no profiles row yet, so they never appear in the students table
  // above -- see auto_enroll_from_invitations. Included here with the same
  // composite subject id every AI-grade endpoint understands (see
  // parseGradingSubject in lib/ai-grading.ts), so their marks -- accepted
  // straight from AI grading, or entered by hand below -- show up in the
  // grid like any other student's. A registered invitee is skipped: their
  // real enrollment already appears in `students` above.
  const invitedStudents = invitedRoster
    .filter((r) => !r.profileId)
    .map((r) => ({
      profile_id: `${INVITED_SUBJECT_PREFIX}${r.invitedId}`,
      name: r.fullName,
    }));

  const students = [...registeredStudents, ...invitedStudents].sort((a, b) => {
    const lastName = (n: string) => n.trim().split(/\s+/).slice(-1)[0] ?? n;
    return lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name);
  });

  // Student marks. One assessment for a 50-student track is already 2,050
  // rows, past PostgREST's silent 1000-row cap, so this pages through
  // .range() (fetchAllRows) -- a single query left half of 9G's marks off
  // the grid on 5 Sep 2026 with no error.
  const itemIds = allItems.map((i) => i.id);
  const marksMap: Record<string, Record<string, number>> = {};
  if (itemIds.length > 0) {
    const rawMarks = await fetchAllRows<{
      test_item_id: string;
      student_id: string | null;
      invited_student_id: string | null;
      marks_awarded: number;
    }>((from, to) =>
      supabase
        .from("student_marks")
        .select("test_item_id, student_id, invited_student_id, marks_awarded")
        .in("test_item_id", itemIds)
        .order("id", { ascending: true })
        .range(from, to)
    );
    for (const m of rawMarks) {
      const subjectId = m.student_id ?? (m.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${m.invited_student_id}` : null);
      if (!subjectId) continue;
      if (!marksMap[m.test_item_id]) marksMap[m.test_item_id] = {};
      marksMap[m.test_item_id][subjectId] = m.marks_awarded;
    }
  }

  // Absences (table test_absences): testId -> subject ids shown as "Abs".
  const absencesByTest: Record<string, string[]> = {};
  const absenceTestIds = testList.map((t) => t.id as string);
  if (absenceTestIds.length > 0) {
    const { data: rawAbsences } = await supabase
      .from("test_absences")
      .select("test_id, profile_id, invited_student_id")
      .in("test_id", absenceTestIds);
    for (const a of rawAbsences ?? []) {
      const subjectId = a.profile_id ?? (a.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${a.invited_student_id}` : null);
      if (!subjectId) continue;
      (absencesByTest[a.test_id] ??= []).push(subjectId);
    }
  }

  // The PowerTeacher Scores Template stored for this class, if the teacher has
  // ever uploaded one. Only the summary: the template itself is filled server
  // side and never needs to reach the browser.
  const { data: templateRow } = await supabase
    .from("powerschool_templates")
    .select("assignment_name, student_count, updated_at")
    .eq("course_id", courseId)
    .maybeSingle();
  const powerSchoolTemplate = templateRow
    ? {
        assignmentName: (templateRow.assignment_name as string | null) ?? null,
        studentCount: (templateRow.student_count as number | null) ?? null,
      }
    : null;

  // The files written as students finish their self-assessments, one per
  // assessment. Just the summary -- the object itself is served by
  // /api/gradebook/self-assessment-export.
  const { data: exportFileRows } = await supabase
    .from("powerschool_export_files")
    .select("test_id, filename, completed_count, roster_count, updated_at, drive_synced_at, drive_error")
    .eq("course_id", courseId);
  const generatedFiles: Record<string, GeneratedFile> = {};
  for (const r of exportFileRows ?? []) {
    generatedFiles[r.test_id as string] = {
      filename: r.filename as string,
      completedCount: (r.completed_count as number) ?? 0,
      rosterCount: (r.roster_count as number) ?? 0,
      updatedAt: (r.updated_at as string) ?? null,
      driveSyncedAt: (r.drive_synced_at as string | null) ?? null,
      driveError: (r.drive_error as string | null) ?? null,
    };
  }

  // Group items by test
  const itemsByTest: Record<string, typeof allItems> = {};
  for (const item of allItems) {
    if (!itemsByTest[item.test_id]) itemsByTest[item.test_id] = [];
    itemsByTest[item.test_id].push(item);
  }

  // Grade boundaries: only the sets these tests use, and the presets their own
  // sets descend from. Paged -- every assessment now has its own set of seven
  // rows, so "all bands" would pass PostgREST's silent 1000-row cap at about
  // 140 tests.
  const usedSetIds = [...new Set(testList.map((t) => t.boundary_set_id as string | null).filter((x): x is string => !!x))];
  const setsById: Record<string, { name: string; test_id: string | null; origin_set_id: string | null }> = {};
  if (usedSetIds.length > 0) {
    const { data: usedSets } = await supabase
      .from("grade_boundary_sets")
      .select("id, name, test_id, origin_set_id")
      .in("id", usedSetIds);
    for (const s of usedSets ?? []) setsById[s.id as string] = s as (typeof setsById)[string];
    const originIds = [...new Set(Object.values(setsById).map((s) => s.origin_set_id).filter((x): x is string => !!x))]
      .filter((id) => !setsById[id]);
    if (originIds.length > 0) {
      const { data: origins } = await supabase
        .from("grade_boundary_sets")
        .select("id, name, test_id, origin_set_id")
        .in("id", originIds);
      for (const s of origins ?? []) setsById[s.id as string] = s as (typeof setsById)[string];
    }
  }
  const boundariesBySetId: Record<string, GradeBoundary[]> = {};
  const bandSetIds = Object.keys(setsById);
  if (bandSetIds.length > 0) {
    const bandRows = await fetchAllRows<{ id: string; set_id: string; grade: number; min_proportion: number | string }>(
      (from, to) =>
        supabase
          .from("grade_boundaries")
          .select("id, set_id, grade, min_proportion")
          .in("set_id", bandSetIds)
          .order("id", { ascending: true })
          .range(from, to)
    );
    for (const b of bandRows) {
      (boundariesBySetId[b.set_id] ??= []).push({ grade: b.grade, min_proportion: Number(b.min_proportion) });
    }
    for (const list of Object.values(boundariesBySetId)) list.sort((a, b) => a.grade - b.grade);
  }
  // When each assessment's boundaries were last decided (teacher-only table).
  // Paged: a history of decisions per test adds up past the 1000-row cap.
  // Only the badge tooltip uses it, so a failed read drops the date rather
  // than the gradebook.
  const decidedAtByTest: Record<string, string> = {};
  if (testIds.length > 0) {
    const decisions = await fetchAllRows<{ id: string; test_id: string; decided_at: string }>((from, to) =>
      supabase
        .from("test_boundary_decisions")
        .select("id, test_id, decided_at")
        .in("test_id", testIds)
        .order("id", { ascending: true })
        .range(from, to)
    ).catch(() => [] as { id: string; test_id: string; decided_at: string }[]);
    for (const d of decisions) {
      const seen = decidedAtByTest[d.test_id];
      if (!seen || d.decided_at > seen) decidedAtByTest[d.test_id] = d.decided_at;
    }
  }

  /** Badge text and tooltip for a test's boundaries (see Test.boundary_label). */
  const describeBoundaries = (
    testId: string,
    setId: string | null,
    total: number
  ): { label: string | null; note: string | null } => {
    const set = setId ? setsById[setId] : undefined;
    if (!setId || !set) return { label: null, note: null };
    if (set.test_id === null) {
      return { label: set.name, note: `Grade boundaries: the shared ${set.name} preset (not decided for this assessment yet)` };
    }
    const own = cutoffsFromBoundaries(boundariesBySetId[setId] ?? null, total);
    const origin = set.origin_set_id ? setsById[set.origin_set_id] : undefined;
    const unchanged =
      !!origin && sameCutoffs(own, cutoffsFromBoundaries(boundariesBySetId[set.origin_set_id as string] ?? null, total));
    const lines = own ? CUTOFF_GRADES.map((g) => own[g]).join("/") : "";
    const decided = decidedAtByTest[testId]
      ? `, decided ${new Date(decidedAtByTest[testId]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : "";
    return {
      label: unchanged && origin ? origin.name : "Own",
      note: `Grade boundaries: this assessment's own${unchanged && origin ? ` (unchanged from ${origin.name})` : ""}${
        lines ? `, ${lines} of ${total}` : ""
      }${decided}`,
    };
  };

  const tests = testList.map((t) => {
    const setId = t.boundary_set_id as string | null;
    const described = describeBoundaries(t.id as string, setId, t.total_marks ?? 0);
    return {
      id: t.id,
      name: t.name,
      test_date: t.test_date as string | null,
      total_marks: t.total_marks ?? 0,
      component: inferComponent(t.name),
      boundary_set_id: setId,
      boundary_label: described.label,
      boundary_note: described.note,
      boundaries: setId ? (boundariesBySetId[setId] ?? null) : null,
      sections: sectionsFromCustomContent(t.custom_content) ?? IB_SECTIONS,
      items: (itemsByTest[t.id] ?? []).map((item) => ({
        id: item.id,
        question_number: item.question_number,
        part_label: item.part_label ?? "",
        max_marks: item.max_marks,
        sort_order: item.sort_order,
        question_code: item.ib_question_code ?? null,
      })),
    };
  });

  return (
    <div>
      <div className="mb-6">
        <p className="text-da-muted text-xs font-medium uppercase tracking-widest mb-1">
          Gradebook
        </p>
        <CoursePicker
          current={{ id: course.id, name: course.name }}
          courses={pickerCourses}
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-da-muted text-sm">
            {students.length} student{students.length !== 1 ? "s" : ""} ·{" "}
            {tests.length} assessment{tests.length !== 1 ? "s" : ""}
          </p>
          {/* Beside the class picker rather than in the grid: the batch spans
              every class, not the one being looked at. */}
          <NewScoresButton />
        </div>
      </div>

      <GradebookGrid
        courseId={courseId}
        tests={tests}
        students={students}
        initialMarks={marksMap}
        absences={absencesByTest}
        initialTemplate={powerSchoolTemplate}
        generatedFiles={generatedFiles}
      />
    </div>
  );
}
