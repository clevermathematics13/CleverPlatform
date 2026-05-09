import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/questions/doc-link
// Body: { questionId: string, field: "google_doc_id" | "google_ms_id", value: string | null }
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "teacher") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json() as { questionId?: string; field?: string; value?: string | null };
  const { questionId, field, value } = body;

  if (!questionId) return NextResponse.json({ error: "questionId required" }, { status: 400 });
  if (field !== "google_doc_id" && field !== "google_ms_id")
    return NextResponse.json({ error: "field must be google_doc_id or google_ms_id" }, { status: 400 });

  const { error } = await supabase
    .from("ib_questions")
    .update({ [field]: value ?? null })
    .eq("id", questionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
