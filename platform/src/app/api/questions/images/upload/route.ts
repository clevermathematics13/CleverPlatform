import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/questions/images/upload
// Accepts a base64-encoded image, uploads to storage, inserts a question_images row.
// Body: { questionId: string, imageType: "question"|"markscheme", data: string (base64), mimeType: string }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { questionId, imageType, data: base64, mimeType } = body as {
    questionId: string;
    imageType: "question" | "markscheme";
    data: string;
    mimeType: string;
  };

  if (!questionId || !imageType || !base64) {
    return NextResponse.json({ error: "questionId, imageType and data are required" }, { status: 400 });
  }
  if (!["question", "markscheme"].includes(imageType)) {
    return NextResponse.json({ error: "Invalid imageType" }, { status: 400 });
  }

  // Look up the question code for a readable storage path
  const { data: question } = await supabase
    .from("ib_questions")
    .select("code")
    .eq("id", questionId)
    .single();

  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  // Get current max sort_order for this question+type to append at the end
  const { data: existingImages } = await supabase
    .from("question_images")
    .select("sort_order")
    .eq("question_id", questionId)
    .eq("image_type", imageType)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSortOrder = existingImages && existingImages.length > 0
    ? (existingImages[0].sort_order ?? 0) + 1
    : 0;

  // Determine file extension from mimeType
  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extMap[mimeType] ?? "png";

  // Build a unique storage path
  const uuid = crypto.randomUUID();
  const storagePath = `${question.code}/${imageType}/upload-${uuid}.${ext}`;

  // Decode base64 to buffer
  const buffer = Buffer.from(base64, "base64");

  // Upload to storage
  const { error: uploadErr } = await supabase.storage
    .from("question-images")
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  // Insert DB row
  const { data: newRow, error: dbErr } = await supabase
    .from("question_images")
    .insert({
      question_id: questionId,
      image_type: imageType,
      storage_path: storagePath,
      sort_order: nextSortOrder,
    })
    .select("id, image_type, storage_path, sort_order, alt_text")
    .single();

  if (dbErr || !newRow) {
    // Best-effort cleanup of storage on DB failure
    await supabase.storage.from("question-images").remove([storagePath]);
    return NextResponse.json({ error: dbErr?.message ?? "DB insert failed" }, { status: 500 });
  }

  // Generate a signed URL for the response
  const { data: signed } = await supabase.storage
    .from("question-images")
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json({
    image: {
      ...newRow,
      url: signed?.signedUrl ?? null,
    },
  });
}
