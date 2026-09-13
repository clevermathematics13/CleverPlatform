import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// Teacher-only throughout this tree. A student never posts here; their page
// reads through lib/practice-set-service.ts and writes nothing.

/** POST /api/practice-sets -- create an empty set, unreleased. */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const body = (await request.json()) as {
    courseId?: unknown;
    name?: unknown;
    description?: unknown;
  };

  const courseId = typeof body.courseId === "string" ? body.courseId : null;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!courseId || !name) {
    return NextResponse.json({ error: "courseId and name are required" }, { status: 400 });
  }

  // Created unreleased, always. A set is assembled over several sittings and
  // half of one appearing in front of a class is the failure to avoid; the
  // teacher releases it deliberately when it is ready.
  const { data, error } = await supabase
    .from("practice_sets")
    .insert({
      course_id: courseId,
      name,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
