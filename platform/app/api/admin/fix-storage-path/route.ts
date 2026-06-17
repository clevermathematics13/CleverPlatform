import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/admin/fix-storage-path
 * One-shot: copies question/02.png → question/01.png for 13M.1.AHL.TZ1.H_8,
 * updates the DB row to match, then deletes old storage file.
 * Safe to call multiple times (idempotent via upsert).
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey
  );

  const BUCKET = "question-images";
  const OLD = "13M.1.AHL.TZ1.H_8/question/02.png";
  const NEW = "13M.1.AHL.TZ1.H_8/question/01.png";
  const QUESTION_ID = "dfa918a0-9132-452a-bf09-1a5abc8b0240";

  // 1. Download old file
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(OLD);
  if (dlErr || !blob) {
    return NextResponse.json({ error: "Download failed", detail: dlErr?.message }, { status: 500 });
  }

  // 2. Upload to new path
  const buf = await blob.arrayBuffer();
  const { error: ulErr } = await admin.storage
    .from(BUCKET)
    .upload(NEW, buf, { contentType: "image/png", upsert: true });
  if (ulErr) {
    return NextResponse.json({ error: "Upload failed", detail: ulErr.message }, { status: 500 });
  }

  // 3. Update DB row
  const { error: dbErr } = await admin
    .from("question_images")
    .update({ storage_path: NEW })
    .eq("question_id", QUESTION_ID)
    .eq("image_type", "question");
  if (dbErr) {
    return NextResponse.json({ error: "DB update failed", detail: dbErr.message }, { status: 500 });
  }

  // 4. Delete old storage file
  await admin.storage.from(BUCKET).remove([OLD]);

  return NextResponse.json({ ok: true, renamed: `${OLD} → ${NEW}` });
}
