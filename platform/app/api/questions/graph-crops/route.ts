import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ChoiceAssociationInput {
  partId?: string | null;
  choiceKey: string;
  isCorrect: boolean;
  rationale?: string | null;
}

interface GraphCropCreateRequest {
  questionImageId: string;
  data: string;
  mimeType: string;
  partId?: string | null;
  cropBbox?: Record<string, unknown> | null;
  graphSpec?: Record<string, unknown> | null;
  graphMeta?: Record<string, unknown> | null;
  extractor?: string;
  notes?: string | null;
  choiceAssociations?: ChoiceAssociationInput[];
}

async function requireUserRole() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      user: null,
      role: null,
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return {
    supabase,
    user,
    role: profile?.role ?? null,
    error: null,
  };
}

function extensionForType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

export async function GET(request: NextRequest) {
  const auth = await requireUserRole();
  if (auth.error) return auth.error;

  const questionId = request.nextUrl.searchParams.get("questionId");
  const partId = request.nextUrl.searchParams.get("partId");
  const includeAssociations = request.nextUrl.searchParams.get("includeAssociations") === "true";

  if (!questionId) {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }

  let query = auth.supabase
    .from("graph_image_crops")
    .select(
      "id, question_id, question_image_id, part_id, storage_path, crop_bbox, graph_spec, graph_meta, extractor, notes, created_by, created_at"
    )
    .eq("question_id", questionId)
    .order("created_at", { ascending: false });

  if (partId) {
    query = query.eq("part_id", partId);
  }

  const { data: crops, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const withUrls = await Promise.all(
    (crops ?? []).map(async (crop) => {
      const { data: signed } = await auth.supabase.storage
        .from("graph-crops")
        .createSignedUrl(crop.storage_path, 3600);

      return {
        ...crop,
        url: signed?.signedUrl ?? null,
      };
    })
  );

  let associationsByCrop: Record<string, unknown[]> = {};
  if (includeAssociations && withUrls.length > 0) {
    const cropIds = withUrls.map((c) => c.id);
    const { data: associations } = await auth.supabase
      .from("graph_crop_choice_associations")
      .select("id, graph_crop_id, part_id, choice_key, is_correct, rationale, created_at")
      .in("graph_crop_id", cropIds)
      .order("created_at", { ascending: true });

    for (const assoc of associations ?? []) {
      const key = assoc.graph_crop_id;
      if (!associationsByCrop[key]) associationsByCrop[key] = [];
      associationsByCrop[key].push(assoc);
    }
  }

  return NextResponse.json({
    crops: withUrls,
    associationsByCrop,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireUserRole();
  if (auth.error) return auth.error;
  if (auth.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: GraphCropCreateRequest;
  try {
    body = (await request.json()) as GraphCropCreateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    questionImageId,
    data: base64,
    mimeType,
    partId,
    cropBbox,
    graphSpec,
    graphMeta,
    extractor,
    notes,
    choiceAssociations,
  } = body;

  if (!questionImageId || !base64 || !mimeType) {
    return NextResponse.json(
      { error: "questionImageId, data, and mimeType are required" },
      { status: 400 }
    );
  }

  const { data: sourceImage, error: sourceErr } = await auth.supabase
    .from("question_images")
    .select("id, question_id")
    .eq("id", questionImageId)
    .single();

  if (sourceErr || !sourceImage) {
    return NextResponse.json({ error: "Source question image not found" }, { status: 404 });
  }

  if (partId) {
    const { data: partRow } = await auth.supabase
      .from("question_parts")
      .select("id, question_id")
      .eq("id", partId)
      .single();

    if (!partRow || partRow.question_id !== sourceImage.question_id) {
      return NextResponse.json(
        { error: "partId must belong to the same question as questionImageId" },
        { status: 400 }
      );
    }
  }

  const { data: question } = await auth.supabase
    .from("ib_questions")
    .select("code")
    .eq("id", sourceImage.question_id)
    .single();

  if (!question) {
    return NextResponse.json({ error: "Question not found for source image" }, { status: 404 });
  }

  const ext = extensionForType(mimeType);
  const uuid = crypto.randomUUID();
  const storagePath = `${question.code}/graph-crops/${questionImageId}/${Date.now()}-${uuid}.${ext}`;

  const buffer = Buffer.from(base64, "base64");

  const { error: uploadErr } = await auth.supabase.storage
    .from("graph-crops")
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const { data: insertedCrop, error: cropErr } = await auth.supabase
    .from("graph_image_crops")
    .insert({
      question_id: sourceImage.question_id,
      question_image_id: sourceImage.id,
      part_id: partId ?? null,
      storage_path: storagePath,
      crop_bbox: cropBbox ?? null,
      graph_spec: graphSpec ?? null,
      graph_meta: graphMeta ?? null,
      extractor: extractor?.trim() || "manual",
      notes: notes ?? null,
      created_by: auth.user?.id ?? null,
    })
    .select(
      "id, question_id, question_image_id, part_id, storage_path, crop_bbox, graph_spec, graph_meta, extractor, notes, created_by, created_at"
    )
    .single();

  if (cropErr || !insertedCrop) {
    await auth.supabase.storage.from("graph-crops").remove([storagePath]);
    return NextResponse.json({ error: cropErr?.message ?? "Failed to save graph crop" }, { status: 500 });
  }

  const validAssociations = (choiceAssociations ?? []).filter(
    (a) => a && typeof a.choiceKey === "string" && typeof a.isCorrect === "boolean"
  );

  if (validAssociations.length > 0) {
    const rows = validAssociations.map((a) => ({
      graph_crop_id: insertedCrop.id,
      part_id: a.partId ?? partId ?? null,
      choice_key: a.choiceKey,
      is_correct: a.isCorrect,
      rationale: a.rationale ?? null,
    }));

    const { error: assocErr } = await auth.supabase
      .from("graph_crop_choice_associations")
      .upsert(rows, { onConflict: "graph_crop_id,choice_key" });

    if (assocErr) {
      await auth.supabase.from("graph_image_crops").delete().eq("id", insertedCrop.id);
      await auth.supabase.storage.from("graph-crops").remove([storagePath]);
      return NextResponse.json({ error: assocErr.message }, { status: 500 });
    }
  }

  const { data: signed } = await auth.supabase.storage
    .from("graph-crops")
    .createSignedUrl(storagePath, 3600);

  const { data: associations } = await auth.supabase
    .from("graph_crop_choice_associations")
    .select("id, graph_crop_id, part_id, choice_key, is_correct, rationale, created_at")
    .eq("graph_crop_id", insertedCrop.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    crop: {
      ...insertedCrop,
      url: signed?.signedUrl ?? null,
    },
    associations: associations ?? [],
  });
}
