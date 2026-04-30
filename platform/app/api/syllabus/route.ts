import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function requireTeacher(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return profile?.role === "teacher" ? user : null;
}

// GET /api/syllabus?courseId=...
// Returns all AAHL subtopics with covered status for the given course.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await requireTeacher(supabase);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const courseId = request.nextUrl.searchParams.get("courseId");
  if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });

  // Fetch all subtopics
  const { data: subtopics, error: subError } = await supabase
    .from("subtopics")
    .select("code, descriptor, section, parent_code")
    .order("code");

  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 });

  // Fetch existing coverage for this course
  const { data: coverage, error: covError } = await supabase
    .from("syllabus_coverage")
    .select("subtopic_code, covered")
    .eq("course_id", courseId);

  if (covError) return NextResponse.json({ error: covError.message }, { status: 500 });

  const covMap: Record<string, boolean> = {};
  for (const row of coverage ?? []) {
    covMap[row.subtopic_code] = row.covered;
  }

  const result = (subtopics ?? []).map((s) => ({
    code: s.code,
    descriptor: s.descriptor,
    section: s.section,
    parent_code: s.parent_code ?? null,
    covered: covMap[s.code] ?? false,
  }));

  return NextResponse.json({ subtopics: result });
}

// PATCH /api/syllabus
// Body: { courseId: string, subtopicCode: string, covered: boolean }
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const user = await requireTeacher(supabase);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { courseId, subtopicCode, covered } = body as {
    courseId: string;
    subtopicCode: string;
    covered: boolean;
  };

  if (!courseId || !subtopicCode || typeof covered !== "boolean") {
    return NextResponse.json({ error: "courseId, subtopicCode, and covered are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("syllabus_coverage")
    .upsert(
      {
        course_id: courseId,
        subtopic_code: subtopicCode,
        covered,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "course_id,subtopic_code" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
