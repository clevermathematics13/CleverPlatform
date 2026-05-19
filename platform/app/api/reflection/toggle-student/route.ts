import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * POST /api/reflection/toggle-student
 * Toggles a student's hidden status. Data is preserved.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

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
