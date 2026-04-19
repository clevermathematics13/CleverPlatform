import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClassReflectionData } from "@/lib/exam-service";

/**
 * GET /api/reflection/class-data?testId=...
 * Returns class-wide reflection data for teacher dashboard.
 */
export async function GET(request: NextRequest) {
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

  const testId = request.nextUrl.searchParams.get("testId");
  if (!testId) {
    return NextResponse.json(
      { error: "Missing testId parameter" },
      { status: 400 }
    );
  }

  const data = await getClassReflectionData(testId);
  return NextResponse.json(data);
}
