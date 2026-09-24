import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITED_SUBJECT_PREFIX } from "@/lib/grading-subject";
import { loadInvitedRoster, type RosterResolution } from "@/lib/na-scanning";

/**
 * A course's roster as GET /api/students returns it, loadable from anywhere
 * on the server. The route and the AI-grade page both call this -- the page
 * so its roster is in the first HTML rather than fetched after the page's
 * JavaScript starts -- and sharing it is what keeps the two from ever
 * listing different students. The route keeps its own auth, parameter
 * parsing and teacher-setting lookup; everything from there down is here,
 * moved verbatim.
 */

/** One roster entry, exactly as GET /api/students serves it. */
export interface CourseRosterRow {
  id: string;
  profile_id: string;
  profiles: { display_name: string; nickname: string | null };
  /** The real class course this student belongs to. */
  course_id: string;
  /** Display name of course_id (e.g. "9A"), when known. */
  course_name: string | null;
}

export interface CourseRosterOptions {
  /** The teacher's "show hidden students" setting (getShowHiddenStudents). */
  showHidden: boolean;
  /** Add imported roster entries that have never signed in (invited_students). */
  includeInvited: boolean;
  /**
   * Only meaningful with includeInvited: when courseId is one class of a
   * track (9G in Grade 9 Extended), pool its sibling classes (9A, 9C) as well.
   */
  includeTrackSiblings: boolean;
}

export type CourseRosterResult =
  | { ok: true; students: CourseRosterRow[] }
  | { ok: false; status: 500; error: string };

export async function loadCourseRoster(
  supabase: SupabaseClient,
  courseId: string,
  { showHidden, includeInvited, includeTrackSiblings }: CourseRosterOptions
): Promise<CourseRosterResult> {
  // Resolved first (when asked for) so the registered-student query below
  // can span the same pooled classes as the invited one; otherwise a student
  // could appear under one class in the students table and be dropped from
  // the pooled list purely because of which query they came from.
  let resolution: RosterResolution | null = null;
  if (includeInvited) {
    try {
      resolution = await loadInvitedRoster(supabase, courseId, { includeTrackSiblings });
    } catch {
      // Never fail the whole roster load over the invited-student add-on.
    }
  }
  const sourceCourseIds =
    includeTrackSiblings && resolution ? resolution.sourceCourseIds : [courseId];
  const courseNames = resolution?.sourceCourseNames ?? {};

  let query = supabase
    .from("students")
    .select("id, profile_id, course_id, profiles:profile_id(display_name, nickname)")
    .in("course_id", sourceCourseIds);
  if (!showHidden) query = query.eq("hidden", false);
  const { data: students, error } = await query.order("id");

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }

  const registered: CourseRosterRow[] = [];
  const seenProfileIds = new Set<string>();
  for (const s of students ?? []) {
    const pid = s.profile_id as string | null;
    if (!pid || seenProfileIds.has(pid)) continue;
    seenProfileIds.add(pid);
    const cid = s.course_id as string;
    registered.push({
      id: s.id as string,
      profile_id: pid,
      // Supabase types a to-one join as an array until the schema is regenerated.
      profiles: (Array.isArray(s.profiles) ? s.profiles[0] : s.profiles) as CourseRosterRow["profiles"],
      course_id: cid,
      course_name: courseNames[cid] ?? null,
    });
  }

  let invitedOnly: CourseRosterRow[] = [];
  if (resolution) {
    // Students imported (Google Classroom, or a manual invite) but who have
    // never logged in have no profiles row yet, so they never appear in the
    // students table above -- see auto_enroll_from_invitations. Represented
    // here with the composite subject id every AI-grade endpoint already
    // understands (see parseGradingSubject in lib/ai-grading.ts) so callers
    // of this route need no changes to consume them. A registered invitee
    // whose enrollment already appears in `students` above is skipped; one
    // whose enrollment row is missing (or hidden) is kept under their real
    // profile id so a signed-in student never vanishes from the roster.
    const seenInvitedProfiles = new Set<string>();
    invitedOnly = resolution.roster
      .filter((r) => {
        if (!r.profileId) return true;
        if (seenProfileIds.has(r.profileId) || seenInvitedProfiles.has(r.profileId)) return false;
        seenInvitedProfiles.add(r.profileId);
        return true;
      })
      .map((r) => {
        const subjectId = r.profileId ?? `${INVITED_SUBJECT_PREFIX}${r.invitedId}`;
        return {
          id: subjectId,
          profile_id: subjectId,
          profiles: { display_name: r.fullName, nickname: null },
          course_id: r.sourceCourseId,
          course_name: courseNames[r.sourceCourseId] ?? null,
        };
      });
  }

  return { ok: true, students: [...registered, ...invitedOnly] };
}
