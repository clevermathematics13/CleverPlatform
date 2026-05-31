import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { upload_id: string; student_id: string; test_id: string };
  const { upload_id, student_id, test_id } = body;
  if (!upload_id || !student_id || !test_id)
    return NextResponse.json({ error: "upload_id, student_id and test_id are required" }, { status: 400 });
  await supabase.from("correction_checks").upsert({ pdf_upload_id: upload_id, student_id, test_id, status: "pending" }, { onConflict: "pdf_upload_id" });
  fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-correction`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ upload_id }),
  }).catch(err => console.error("[trigger-correction] failed:", err));
  return NextResponse.json({ ok: true });
}