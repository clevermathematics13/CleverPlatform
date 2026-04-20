import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const questionId = request.nextUrl.searchParams.get("questionId");
  if (!questionId) {
    return NextResponse.json(
      { error: "questionId is required" },
      { status: 400 }
    );
  }

  // Get image records
  const { data: images, error } = await supabase
    .from("question_images")
    .select("id, image_type, storage_path, sort_order, alt_text")
    .eq("question_id", questionId)
    .order("image_type")
    .order("sort_order");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Generate signed URLs for each image
  const withUrls = await Promise.all(
    (images ?? []).map(async (img) => {
      const { data } = await supabase.storage
        .from("question-images")
        .createSignedUrl(img.storage_path, 3600); // 1 hour

      return {
        ...img,
        url: data?.signedUrl ?? null,
      };
    })
  );

  return NextResponse.json({ images: withUrls });
}
