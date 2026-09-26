import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITED_SUBJECT_PREFIX } from "./grading-subject";
import { fetchAllRows, loadInvitedRoster } from "./na-scanning";

/**
 * report-roster.ts
 * -----------------------------------------------------------------------------
 * Who is on a test's roster, what each of them scored, and who was away.
 *
 * Extracted from lib/standards-report-data.ts when the Exploration/homework
 * report needed the identical thing. The two reports say different things
 * about a student (performance levels per strand; Got it / Almost / Not yet
 * per learning target) but they must never disagree about WHO is on the
 * roster or WHICH marks count, and the surest way to hold that is for there
 * to be one function.
 *
 * The roster rule is the AI grader's: the test's own class plus its track
 * siblings (a Grade 9 test is attached to one class and sat by the track),
 * registered students from `students` and never-logged-in ones from
 * `invited_students`, each under the same opaque subject id the marks are
 * keyed by.
 *
 * Marks are student_marks -- what a teacher has ACCEPTED -- not AI
 * suggestions. Anything a report says is therefore something that has been
 * signed off part by part, which is the only kind that belongs on a report.
 * -----------------------------------------------------------------------------
 */

export interface RosterSubject {
  subjectId: string;
  name: string;
  /** "9D", for grouping when the roster spans classes. */
  className: string | null;
  courseId: string;
  absent: boolean;
  /** Accepted marks for this student, keyed by test_items.id. Empty when unmarked. */
  marks: Map<string, number>;
}

export interface ReportRoster {
  /** Sorted by class, then by last name, then by full name. */
  subjects: RosterSubject[];
  /** More than one class on the roster, so rows should be grouped. */
  classCount: number;
}

export interface LoadReportRosterOptions {
  /**
   * Also return anyone who has ACCEPTED MARKS on this test but is on no
   * roster the test's course reaches -- a student from a class that sat the
   * paper without being a member of its track.
   *
   * Off by default, because the standards and activity reports are about a
   * class and a blank row for a stranger would be noise. The general
   * Standard Level view turns it on, where the opposite is true: a paper
   * that has been marked and then silently left out of the class averages is
   * the one failure that view exists to prevent. Costs two small queries,
   * and only when such a student exists.
   */
  includeMarkedOutsideRoster?: boolean;
}

export type ReportRosterLoad =
  | { ok: true; data: ReportRoster }
  | { ok: false; status: 500; error: string };

/** Surname-ish: the last whitespace-separated word, which is how a register reads. */
function lastName(n: string): string {
  return n.trim().split(/\s+/).slice(-1)[0] ?? n;
}

export async function loadReportRoster(
  supabase: SupabaseClient,
  args: {
    testId: string;
    courseId: string | null;
    itemIds: string[];
    showHidden: boolean;
  } & LoadReportRosterOptions
): Promise<ReportRosterLoad> {
  const { testId, courseId, itemIds, showHidden, includeMarkedOutsideRoster = false } = args;

  // ---- Roster -------------------------------------------------------------
  let sourceCourseIds: string[] = [];
  let courseNames: Record<string, string> = {};
  const students: { subjectId: string; name: string; courseId: string }[] = [];
  if (courseId) {
    const resolution = await loadInvitedRoster(supabase, courseId, { includeTrackSiblings: true });
    sourceCourseIds = resolution.sourceCourseIds;
    courseNames = resolution.sourceCourseNames;

    let query = supabase
      .from("students")
      .select("profile_id, course_id, profiles:profile_id(display_name)")
      .in("course_id", sourceCourseIds);
    if (!showHidden) query = query.eq("hidden", false);
    const { data: registered, error: regError } = await query;
    if (regError) return { ok: false, status: 500, error: regError.message };

    const seen = new Set<string>();
    for (const s of registered ?? []) {
      const pid = s.profile_id as string | null;
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const prof = s.profiles as unknown;
      const displayName =
        prof && typeof prof === "object" && !Array.isArray(prof)
          ? (prof as { display_name: string | null }).display_name
          : Array.isArray(prof) && prof.length > 0
            ? (prof[0] as { display_name: string | null }).display_name
            : null;
      students.push({ subjectId: pid, name: displayName ?? "Unknown", courseId: s.course_id as string });
    }
    for (const r of resolution.roster) {
      if (r.profileId) {
        if (seen.has(r.profileId)) continue;
        seen.add(r.profileId);
        students.push({ subjectId: r.profileId, name: r.fullName, courseId: r.sourceCourseId });
      } else {
        students.push({ subjectId: `${INVITED_SUBJECT_PREFIX}${r.invitedId}`, name: r.fullName, courseId: r.sourceCourseId });
      }
    }
  }

  // ---- Marks and absences ---------------------------------------------------
  const marksBySubject = new Map<string, Map<string, number>>();
  if (itemIds.length > 0) {
    let rawMarks: { test_item_id: string; student_id: string | null; invited_student_id: string | null; marks_awarded: number }[];
    try {
      rawMarks = await fetchAllRows((from, to) =>
        supabase
          .from("student_marks")
          .select("test_item_id, student_id, invited_student_id, marks_awarded")
          .in("test_item_id", itemIds)
          .order("id", { ascending: true })
          .range(from, to)
      );
    } catch (e) {
      return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
    }
    for (const m of rawMarks) {
      const subjectId =
        m.student_id ?? (m.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${m.invited_student_id}` : null);
      if (!subjectId) continue;
      let map = marksBySubject.get(subjectId);
      if (!map) {
        map = new Map();
        marksBySubject.set(subjectId, map);
      }
      map.set(m.test_item_id, m.marks_awarded);
    }
  }

  const absent = new Set<string>();
  const { data: absences } = await supabase
    .from("test_absences")
    .select("profile_id, invited_student_id")
    .eq("test_id", testId);
  for (const a of absences ?? []) {
    const subjectId = a.profile_id ?? (a.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${a.invited_student_id}` : null);
    if (subjectId) absent.add(subjectId);
  }

  // ---- Students with marks who are on no roster this test reaches ---------
  // Their class is whatever class they really belong to, so the general view
  // groups and averages them under it rather than under the test's own.
  if (includeMarkedOutsideRoster && marksBySubject.size > 0) {
    const known = new Set(students.map((s) => s.subjectId));
    const strangers = [...marksBySubject.keys()].filter((id) => !known.has(id));
    const profileIds = strangers.filter((id) => !id.startsWith(INVITED_SUBJECT_PREFIX));
    const invitedIds = strangers
      .filter((id) => id.startsWith(INVITED_SUBJECT_PREFIX))
      .map((id) => id.slice(INVITED_SUBJECT_PREFIX.length));

    const extraCourseIds = new Set<string>();
    const extras: { subjectId: string; name: string; courseId: string }[] = [];

    if (profileIds.length > 0) {
      const { data: rows } = await supabase
        .from("students")
        .select("profile_id, course_id, profiles:profile_id(display_name)")
        .in("profile_id", profileIds);
      const byProfile = new Map<string, { name: string; courseId: string }>();
      for (const r of rows ?? []) {
        const pid = r.profile_id as string | null;
        if (!pid || byProfile.has(pid)) continue;
        const prof = r.profiles as unknown;
        const displayName =
          prof && typeof prof === "object" && !Array.isArray(prof)
            ? (prof as { display_name: string | null }).display_name
            : Array.isArray(prof) && prof.length > 0
              ? (prof[0] as { display_name: string | null }).display_name
              : null;
        byProfile.set(pid, { name: displayName ?? "Unknown", courseId: r.course_id as string });
      }
      // A student since removed from every class has no students row left to
      // name them by, only their profile.
      const unenrolled = profileIds.filter((pid) => !byProfile.has(pid));
      const profileNames = new Map<string, string>();
      if (unenrolled.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", unenrolled);
        for (const p of profs ?? []) {
          if (p.display_name) profileNames.set(p.id as string, p.display_name as string);
        }
      }
      for (const pid of profileIds) {
        const hit = byProfile.get(pid);
        // No students row at all: keep them rather than drop the marks, under
        // a null class, which the view prints as "Other".
        extras.push({ subjectId: pid, name: hit?.name ?? profileNames.get(pid) ?? "Unknown", courseId: hit?.courseId ?? "" });
        if (hit?.courseId) extraCourseIds.add(hit.courseId);
      }
    }

    if (invitedIds.length > 0) {
      const { data: rows } = await supabase
        .from("invited_students")
        .select("id, full_name, course_id")
        .in("id", invitedIds);
      for (const r of rows ?? []) {
        const cid = (r.course_id as string | null) ?? "";
        extras.push({
          subjectId: `${INVITED_SUBJECT_PREFIX}${r.id as string}`,
          name: (r.full_name as string) ?? "Unknown",
          courseId: cid,
        });
        if (cid) extraCourseIds.add(cid);
      }
    }

    const unnamed = [...extraCourseIds].filter((id) => !(id in courseNames));
    if (unnamed.length > 0) {
      const { data: rows } = await supabase.from("courses").select("id, name").in("id", unnamed);
      for (const c of rows ?? []) courseNames[c.id as string] = (c.name as string) ?? "";
    }

    // The test's own classes stay first; a stranger's class sorts after them.
    for (const e of extras) {
      students.push(e);
      if (e.courseId && !sourceCourseIds.includes(e.courseId)) sourceCourseIds.push(e.courseId);
    }
  }

  const classIndex = new Map(sourceCourseIds.map((id, i) => [id, i]));
  const subjects: RosterSubject[] = students
    .map((s) => ({
      classOrder: classIndex.get(s.courseId) ?? 0,
      subject: {
        subjectId: s.subjectId,
        name: s.name,
        className: courseNames[s.courseId] ?? null,
        courseId: s.courseId,
        absent: absent.has(s.subjectId),
        marks: marksBySubject.get(s.subjectId) ?? new Map<string, number>(),
      },
    }))
    .sort(
      (a, b) =>
        a.classOrder - b.classOrder ||
        lastName(a.subject.name).localeCompare(lastName(b.subject.name)) ||
        a.subject.name.localeCompare(b.subject.name)
    )
    .map((x) => x.subject);

  return { ok: true, data: { subjects, classCount: new Set(students.map((s) => s.courseId)).size } };
}
