import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  let body: { questionIds?: unknown; imageType?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { questionIds, imageType } = body;

  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    return NextResponse.json(
      { error: "questionIds must be a non-empty array" },
      { status: 400 }
    );
  }
  if (imageType !== "question" && imageType !== "markscheme") {
    return NextResponse.json(
      { error: "imageType must be 'question' or 'markscheme'" },
      { status: 400 }
    );
  }

  // Fetch question metadata (code, section, curriculum) for all IDs
  const { data: questionRows, error: qError } = await supabase
    .from("ib_questions")
    .select("id, code, section, curriculum")
    .in("id", questionIds as string[]);

  if (qError) {
    return NextResponse.json({ error: qError.message }, { status: 500 });
  }

  // Fetch question_parts for all IDs in one query
  const { data: allParts } = await supabase
    .from("question_parts")
    .select("id, question_id, part_label, marks, subtopic_codes, command_term, sort_order")
    .in("question_id", questionIds as string[])
    .order("sort_order", { ascending: true });

  const partsByQuestion = new Map<string, typeof allParts>();
  for (const part of allParts ?? []) {
    const existing = partsByQuestion.get(part.question_id) ?? [];
    existing.push(part);
    partsByQuestion.set(part.question_id, existing);
  }

  const questionMap = new Map(
    (questionRows ?? []).map((q) => [q.id, q])
  );

  // Fetch all images for these questions in one query
  const { data: allImages, error: imgError } = await supabase
    .from("question_images")
    .select("id, question_id, image_type, storage_path, sort_order, alt_text")
    .in("question_id", questionIds as string[])
    .eq("image_type", imageType as string)
    .order("sort_order", { ascending: true });

  if (imgError) {
    return NextResponse.json({ error: imgError.message }, { status: 500 });
  }

  // Group images by question_id
  const imagesByQuestion = new Map<string, typeof allImages>();
  for (const img of allImages ?? []) {
    const existing = imagesByQuestion.get(img.question_id) ?? [];
    existing.push(img);
    imagesByQuestion.set(img.question_id, existing);
  }

  // Generate signed URLs for all images
  const questions = await Promise.all(
    (questionIds as string[]).map(async (qId) => {
      const meta = questionMap.get(qId);
      const images = imagesByQuestion.get(qId) ?? [];
      const withUrls = await Promise.all(
        images.map(async (img) => {
          const { data } = await supabase.storage
            .from("question-images")
            .createSignedUrl(img.storage_path, 3600);
          return {
            id: img.id,
            sort_order: img.sort_order,
            alt_text: img.alt_text,
            url: data?.signedUrl ?? null,
          };
        })
      );
      return {
        id: qId,
        code: meta?.code ?? qId,
        section: meta?.section ?? null,
        curriculum: meta?.curriculum ?? ["AA"],
        parts: (partsByQuestion.get(qId) ?? []).map((p) => ({
          id: p.id,
          part_label: p.part_label,
          marks: p.marks,
          subtopic_codes: p.subtopic_codes ?? [],
          command_term: p.command_term ?? null,
          sort_order: p.sort_order,
        })),
        images: withUrls,
      };
    })
  );

  return NextResponse.json({ questions });
}
