import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/questions/latex-verify
// Body: { questionId: string, verified: boolean }
// Sets latex_verified on all question_parts for the given question.
export async function PATCH(request: NextRequest) {
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

  const body = await request.json() as { questionId: string; verified: boolean };
  const { questionId, verified } = body;

  if (!questionId || typeof verified !== "boolean") {
    return NextResponse.json(
      { error: "questionId and verified (boolean) are required" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("question_parts")
    .update({ latex_verified: verified })
    .eq("question_id", questionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
