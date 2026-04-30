import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function requireTeacherClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "teacher") return { supabase, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { supabase, error: null };
}

// DELETE /api/questions/images/[id]
// Permanently deletes the image from storage and unlinks it from the question
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, error } = await requireTeacherClient();
  if (error) return error;

  const { id } = await params;

  // Fetch the image record to get the storage path
  const { data: img, error: fetchErr } = await supabase
    .from("question_images")
    .select("id, storage_path")
    .eq("id", id)
    .single();

  if (fetchErr || !img) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Delete from storage
  const { error: storageErr } = await supabase.storage
    .from("question-images")
    .remove([img.storage_path]);

  if (storageErr) {
    return NextResponse.json({ error: `Storage delete failed: ${storageErr.message}` }, { status: 500 });
  }

  // Delete from database
  const { error: dbErr } = await supabase
    .from("question_images")
    .delete()
    .eq("id", id);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// PATCH /api/questions/images/[id]
// Updates the sort_order of a single image record
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, error } = await requireTeacherClient();
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const sortOrder = body.sortOrder;

  if (sortOrder === undefined || typeof sortOrder !== "number") {
    return NextResponse.json({ error: "sortOrder (number) is required" }, { status: 400 });
  }

  const { error: dbErr } = await supabase
    .from("question_images")
    .update({ sort_order: sortOrder })
    .eq("id", id);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
