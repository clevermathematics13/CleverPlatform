import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { loadCourseRoster } from "@/lib/course-roster";

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

  // The roster itself is built in lib/course-roster.ts, which the AI-grade
  // page also calls to render its roster on the server.
  const roster = await loadCourseRoster(supabase, courseId, {
    showHidden,
    includeInvited,
    includeTrackSiblings,
  });
  if (!roster.ok) {
    return NextResponse.json({ error: roster.error }, { status: roster.status });
  }
  return NextResponse.json({ students: roster.students });
}
