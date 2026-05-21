import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiTeacher } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  let body: { questionId?: unknown; notes?: unknown };
  try {
    body = (await request.json()) as { questionId?: unknown; notes?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { questionId, notes } = body;
  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }
  if (typeof notes !== "string" && notes !== null) {
    return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
  }

  const { error } = await supabase
    .from("ib_questions")
    .update({ teacher_notes: notes || null })
    .eq("id", questionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
