import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { loadInvitedRoster } from "@/lib/na-scanning";

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

  const showHidden = await getShowHiddenStudents(supabase, profile.id);

  let query = supabase
    .from("students")
    .select("id, profile_id, profiles:profile_id(display_name, nickname)")
    .eq("course_id", courseId);
  if (!showHidden) query = query.eq("hidden", false);
  const { data: students, error } = await query.order("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let invitedOnly: { id: string; profile_id: string; profiles: { display_name: string; nickname: string | null } }[] = [];
  if (includeInvited) {
    // Students imported (Google Classroom, or a manual invite) but who have
    // never logged in have no profiles row yet, so they never appear in the
    // students table above -- see auto_enroll_from_invitations. Represented
    // here with the composite subject id every AI-grade endpoint already
    // understands (see parseGradingSubject in lib/ai-grading.ts) so callers
    // of this route need no changes to consume them. A registered invitee
    // is skipped: their real enrollment already appears in `students` above.
    try {
      const { roster } = await loadInvitedRoster(supabase, courseId);
      invitedOnly = roster
        .filter((r) => !r.profileId)
        .map((r) => ({
          id: `${INVITED_SUBJECT_PREFIX}${r.invitedId}`,
          profile_id: `${INVITED_SUBJECT_PREFIX}${r.invitedId}`,
          profiles: { display_name: r.fullName, nickname: null },
        }));
    } catch {
      // Never fail the whole roster load over the invited-student add-on.
    }
  }

  return NextResponse.json({ students: [...(students ?? []), ...invitedOnly] });
}
