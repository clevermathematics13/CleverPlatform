import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getClassReflectionData } from "@/lib/exam-service";

/**
 * GET /api/reflection/class-data?testId=...
 * Returns class-wide reflection data for teacher dashboard.
 */
export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

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
