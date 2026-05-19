import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiTeacher } from "@/lib/auth";

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
    .select("id, part_id, image_type, storage_path, sort_order, alt_text")
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
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const imageId = request.nextUrl.searchParams.get("imageId");
  const questionId = request.nextUrl.searchParams.get("questionId");

  // Bulk delete: remove ALL images for a question
  if (questionId && !imageId) {
    const { data: imgs, error: fetchErr } = await supabase
      .from("question_images")
      .select("id, storage_path")
      .eq("question_id", questionId);

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

    const paths = (imgs ?? []).map((i) => i.storage_path).filter(Boolean);
    if (paths.length > 0) {
      const { error: storageErr } = await supabase.storage
        .from("question-images")
        .remove(paths);
      if (storageErr) return NextResponse.json({ error: storageErr.message }, { status: 500 });
    }

    const { error: dbErr } = await supabase
      .from("question_images")
      .delete()
      .eq("question_id", questionId);

    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: (imgs ?? []).length });
  }

  if (!imageId) {
    return NextResponse.json({ error: "imageId or questionId is required" }, { status: 400 });
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
