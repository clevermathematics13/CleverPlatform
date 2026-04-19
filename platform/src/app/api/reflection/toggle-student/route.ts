import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/reflection/toggle-student
 * Toggles a student's hidden status. Data is preserved.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { studentProfileId, hidden } = body as {
    studentProfileId: string;
    hidden: boolean;
  };

  if (!studentProfileId || typeof hidden !== "boolean") {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("students")
    .update({ hidden })
    .eq("profile_id", studentProfileId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update student" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, hidden });
}
