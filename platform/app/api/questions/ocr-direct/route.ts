import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export const maxDuration = 120;

/**
 * POST /api/questions/ocr-direct
 *
 * Check if images exist for a question/mark-scheme, then proceed to OCR.
 * This bypasses the extract-images step and works with already-stored images.
 *
 * Body: { questionId: string, imageType: "question" | "markscheme" }
 * Response: { hasImages: boolean, imageCount: number, field: string }
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const body = (await request.json()) as {
    questionId: string;
    imageType: "question" | "markscheme";
  };
  const { questionId, imageType } = body;

  if (!questionId || !imageType)
    return NextResponse.json(
      { error: "questionId and imageType are required" },
      { status: 400 }
    );

  if (!["question", "markscheme"].includes(imageType))
    return NextResponse.json(
      { error: 'imageType must be "question" or "markscheme"' },
      { status: 400 }
    );

  // Check if images exist
  const { data: images, error: imgErr } = await supabase
    .from("question_images")
    .select("id")
    .eq("question_id", questionId)
    .eq("image_type", imageType);

  if (imgErr) {
    return NextResponse.json(
      { error: "Database query failed", detail: imgErr.message },
      { status: 500 }
    );
  }

  const hasImages = (images?.length ?? 0) > 0;

  return NextResponse.json({
    questionId,
    imageType,
    hasImages,
    imageCount: images?.length ?? 0,
  });
}
