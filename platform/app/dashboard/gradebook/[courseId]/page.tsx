import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { notFound } from "next/navigation";
import { GradebookGrid, type GeneratedFile, type TestSection } from "./GradebookGrid";
import { CoursePicker } from "./CoursePicker";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { fetchAllRows, loadInvitedRoster } from "@/lib/na-scanning";
import { loadTrackLinks, trackFamilyCourseIds } from "@/lib/track-courses";

/** The IB split, and the default for any paper that does not carry its own
 *  structure: Section A is short response, Section B extended response. */
const IB_SECTIONS: TestSection[] = [
  { label: "Sec A", title: "Section A - short response (Q1-8)", fromQ: 1, toQ: 8 },
  { label: "Sec B", title: "Section B - extended response (Q9+)", fromQ: 9, toQ: null },
];

/** "LEVEL 3 -- CONNECT THE ALGEBRA" -> "L3", to fit a gradebook column. */
function shortSectionLabel(heading: string, index: number): string {
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
function sectionsFromCustomContent(customContent: unknown): TestSection[] | null {
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

  // All boundary sets (small table — fetch once, pass to client)
  const { data: rawSets } = await supabase
    .from("grade_boundary_sets")
    .select("id, name, description");

  const { data: rawBoundaries } = await supabase
    .from("grade_boundaries")
    .select("set_id, grade, min_proportion")
    .order("grade", { ascending: true });

  // Build a lookup: setId → sorted boundary array (grade 1→7)
  type BoundaryRow = { grade: number; min_proportion: number };
  const boundariesBySetId: Record<string, BoundaryRow[]> = {};
  for (const b of rawBoundaries ?? []) {
    if (!boundariesBySetId[b.set_id]) boundariesBySetId[b.set_id] = [];
    boundariesBySetId[b.set_id].push({
      grade: b.grade,
      min_proportion: Number(b.min_proportion),
    });
  }

  // Build a lookup: setId → set name (e.g. 'B')
  const setNameById: Record<string, string> = {};
  for (const s of rawSets ?? []) {
    setNameById[s.id] = s.name;
  }

  // Who this gradebook is for. A track (Grade 9 Extended) pools its member
  // classes' students; a class lists its own. Either way the students are
  // the invited roster (plus anyone registered) of sourceCourseIds.
  const { roster: invitedRoster, sourceCourseIds } = await loadInvitedRoster(supabase, courseId);

  // Tests for this course's track family (lib/track-courses.ts), ordered
  // most-recent-first. A test attached to one class of a track is sat by
  // the whole track, so it belongs on every member's gradebook and the
  // track's own.
  const testCourseIds = trackFamilyCourseIds(courseId, await loadTrackLinks(supabase, courseId));
  const { data: rawTests } = await supabase
    .from("tests")
    .select("id, name, test_date, total_marks, boundary_set_id, custom_content")
    .in("course_id", testCourseIds)
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
    .select("test_id, filename, completed_count, roster_count, updated_at")
    .eq("course_id", courseId);
  const generatedFiles: Record<string, GeneratedFile> = {};
  for (const r of exportFileRows ?? []) {
    generatedFiles[r.test_id as string] = {
      filename: r.filename as string,
      completedCount: (r.completed_count as number) ?? 0,
      rosterCount: (r.roster_count as number) ?? 0,
      updatedAt: (r.updated_at as string) ?? null,
    };
  }

  // Group items by test
  const itemsByTest: Record<string, typeof allItems> = {};
  for (const item of allItems) {
    if (!itemsByTest[item.test_id]) itemsByTest[item.test_id] = [];
    itemsByTest[item.test_id].push(item);
  }

  const tests = testList.map((t) => {
    const setId = t.boundary_set_id as string | null;
    return {
      id: t.id,
      name: t.name,
      test_date: t.test_date as string | null,
      total_marks: t.total_marks ?? 0,
      component: inferComponent(t.name),
      boundary_set_id: setId,
      boundary_set_name: setId ? (setNameById[setId] ?? null) : null,
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
        <p className="text-da-muted text-sm mt-1">
          {students.length} student{students.length !== 1 ? "s" : ""} ·{" "}
          {tests.length} assessment{tests.length !== 1 ? "s" : ""}
        </p>
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
