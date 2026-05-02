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

export async function DELETE(request: NextRequest) {
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
  if (profile?.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const imageId = request.nextUrl.searchParams.get("imageId");
  if (!imageId) {
    return NextResponse.json({ error: "imageId is required" }, { status: 400 });
  }

  // Fetch the record so we know the storage_path
  const { data: img, error: fetchErr } = await supabase
    .from("question_images")
    .select("id, storage_path")
    .eq("id", imageId)
    .single();

  if (fetchErr || !img) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Delete from storage
  const { error: storageErr } = await supabase.storage
    .from("question-images")
    .remove([img.storage_path]);

  if (storageErr) {
    return NextResponse.json({ error: storageErr.message }, { status: 500 });
  }

  // Delete the database record
  const { error: dbErr } = await supabase
    .from("question_images")
    .delete()
    .eq("id", imageId);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
