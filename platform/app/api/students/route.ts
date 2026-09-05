import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { loadInvitedRoster, type RosterResolution } from "@/lib/na-scanning";

interface RosterRow {
  id: string;
  profile_id: string;
  profiles: { display_name: string; nickname: string | null };
  /** The real class course this student belongs to. */
  course_id: string;
  /** Display name of course_id (e.g. "9A"), when known. */
  course_name: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const courseId = request.nextUrl.searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }
  // Opt-in only: this route's other consumer (test-preview-client.tsx) needs
  // the plain, profile-only roster, and every existing caller's response
  // shape must stay exactly as it was.
  const includeInvited = request.nextUrl.searchParams.get("includeInvited") === "true";
  // Opt-in, and only meaningful with includeInvited: when courseId is one
  // class of a track (9G in Grade 9 Extended), pool its sibling classes
  // (9A, 9C) as well. The AI grader asks for this because a scanned pile
  // for a Grade 9 test mixes every class in the track.
  const includeTrackSiblings =
    includeInvited && request.nextUrl.searchParams.get("includeTrackSiblings") === "true";

  const showHidden = await getShowHiddenStudents(supabase, profile.id);

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const registered: RosterRow[] = [];
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
      profiles: (Array.isArray(s.profiles) ? s.profiles[0] : s.profiles) as RosterRow["profiles"],
      course_id: cid,
      course_name: courseNames[cid] ?? null,
    });
  }

  let invitedOnly: RosterRow[] = [];
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

  return NextResponse.json({ students: [...registered, ...invitedOnly] });
}
