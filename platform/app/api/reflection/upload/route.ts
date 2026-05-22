import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { clearPdfUpload } from "@/lib/exam-service";

/**
 * DELETE /api/reflection/upload
 * Clears the PDF upload for a student+test.
 * Students can clear their own; teachers can clear any.
 */
export async function DELETE(request: NextRequest) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const { studentId, testId } = await request.json();

  if (!studentId || !testId) {
    return NextResponse.json(
      { error: "Missing studentId or testId" },
      { status: 400 }
    );
  }

  // Students may only clear their own upload
  if (profile.role === "student" && studentId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await clearPdfUpload(studentId, testId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to clear upload" },
      { status: 500 }
    );
  }
}
