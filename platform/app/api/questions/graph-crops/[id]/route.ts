import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ChoiceAssociationInput {
  partId?: string | null;
  choiceKey: string;
  isCorrect: boolean;
  rationale?: string | null;
}

interface GraphCropUpdateRequest {
  partId?: string | null;
  cropBbox?: Record<string, unknown> | null;
  graphSpec?: Record<string, unknown> | null;
  graphMeta?: Record<string, unknown> | null;
  extractor?: string;
  notes?: string | null;
  choiceAssociations?: ChoiceAssociationInput[];
  replaceAssociations?: boolean;
}

async function requireTeacherClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "teacher") {
    return {
      supabase,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { supabase, error: null };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, error } = await requireTeacherClient();
  if (error) return error;

  const { id } = await params;

  let body: GraphCropUpdateRequest;
  try {
    body = (await request.json()) as GraphCropUpdateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: crop } = await supabase
    .from("graph_image_crops")
    .select("id, question_id")
    .eq("id", id)
    .single();

  if (!crop) {
    return NextResponse.json({ error: "Graph crop not found" }, { status: 404 });
  }

  if (body.partId) {
    const { data: partRow } = await supabase
      .from("question_parts")
      .select("id, question_id")
      .eq("id", body.partId)
      .single();

    if (!partRow || partRow.question_id !== crop.question_id) {
      return NextResponse.json(
        { error: "partId must belong to the same question as this graph crop" },
        { status: 400 }
      );
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (body.partId !== undefined) updatePayload.part_id = body.partId;
  if (body.cropBbox !== undefined) updatePayload.crop_bbox = body.cropBbox;
  if (body.graphSpec !== undefined) updatePayload.graph_spec = body.graphSpec;
  if (body.graphMeta !== undefined) updatePayload.graph_meta = body.graphMeta;
  if (body.extractor !== undefined) updatePayload.extractor = body.extractor;
  if (body.notes !== undefined) updatePayload.notes = body.notes;

  if (Object.keys(updatePayload).length > 0) {
    const { error: updateErr } = await supabase
      .from("graph_image_crops")
      .update(updatePayload)
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  const hasAssociations = Array.isArray(body.choiceAssociations);
  const replaceAssociations = body.replaceAssociations !== false;

  if (hasAssociations) {
    if (replaceAssociations) {
      const { error: delErr } = await supabase
        .from("graph_crop_choice_associations")
        .delete()
        .eq("graph_crop_id", id);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }

    const validAssociations = (body.choiceAssociations ?? []).filter(
      (a) => a && typeof a.choiceKey === "string" && typeof a.isCorrect === "boolean"
    );

    if (validAssociations.length > 0) {
      const rows = validAssociations.map((a) => ({
        graph_crop_id: id,
        part_id: a.partId ?? body.partId ?? null,
        choice_key: a.choiceKey,
        is_correct: a.isCorrect,
        rationale: a.rationale ?? null,
      }));

      const { error: assocErr } = await supabase
        .from("graph_crop_choice_associations")
        .upsert(rows, { onConflict: "graph_crop_id,choice_key" });

      if (assocErr) {
        return NextResponse.json({ error: assocErr.message }, { status: 500 });
      }
    }
  }

  const { data: updatedCrop, error: cropErr } = await supabase
    .from("graph_image_crops")
    .select(
      "id, question_id, question_image_id, part_id, storage_path, crop_bbox, graph_spec, graph_meta, extractor, notes, created_by, created_at"
    )
    .eq("id", id)
    .single();

  if (cropErr || !updatedCrop) {
    return NextResponse.json({ error: cropErr?.message ?? "Graph crop not found" }, { status: 404 });
  }

  const { data: signed } = await supabase.storage
    .from("graph-crops")
    .createSignedUrl(updatedCrop.storage_path, 3600);

  const { data: associations } = await supabase
    .from("graph_crop_choice_associations")
    .select("id, graph_crop_id, part_id, choice_key, is_correct, rationale, created_at")
    .eq("graph_crop_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    crop: {
      ...updatedCrop,
      url: signed?.signedUrl ?? null,
    },
    associations: associations ?? [],
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, error } = await requireTeacherClient();
  if (error) return error;

  const { id } = await params;

  const { data: crop, error: fetchErr } = await supabase
    .from("graph_image_crops")
    .select("id, storage_path")
    .eq("id", id)
    .single();

  if (fetchErr || !crop) {
    return NextResponse.json({ error: "Graph crop not found" }, { status: 404 });
  }

  const { error: storageErr } = await supabase.storage
    .from("graph-crops")
    .remove([crop.storage_path]);

  if (storageErr) {
    return NextResponse.json({ error: `Storage delete failed: ${storageErr.message}` }, { status: 500 });
  }

  const { error: dbErr } = await supabase
    .from("graph_image_crops")
    .delete()
    .eq("id", id);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
