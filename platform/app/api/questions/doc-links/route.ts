import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * PATCH /api/questions/doc-links
 * 
 * Updates both question and markscheme Google Doc IDs for a question.
 * 
 * Body: {
 *   questionId: string,
 *   googleDocId: string | null,
 *   googleMsId: string | null
 * }
 * 
 * Validates that:
 * - At least one field is provided
 * - The two doc IDs are not identical (would break extraction)
 */
export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const body = await request.json() as {
    questionId?: string;
    googleDocId?: string | null;
    googleMsId?: string | null;
  };
  const { questionId, googleDocId, googleMsId } = body;

  if (!questionId) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }

  // Validate that doc IDs are not identical (this breaks extraction)
  if (
    googleDocId &&
    googleMsId &&
    googleDocId.trim() === googleMsId.trim()
  ) {
    return NextResponse.json(
      {
        error:
          "Question doc and Markscheme doc cannot be the same file. This would break extraction.",
      },
      { status: 400 }
    );
  }

  // Build update object (only include fields that are provided)
  const updateData: Record<string, string | null> = {};
  if (googleDocId !== undefined) {
    updateData.google_doc_id = googleDocId ? googleDocId.trim() : null;
  }
  if (googleMsId !== undefined) {
    updateData.google_ms_id = googleMsId ? googleMsId.trim() : null;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "At least one doc ID must be provided" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("ib_questions")
    .update(updateData)
    .eq("id", questionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
