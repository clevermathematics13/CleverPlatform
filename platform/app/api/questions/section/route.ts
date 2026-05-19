import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  let body: { questionId?: unknown; section?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { questionId, section } = body;

  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }
  if (section !== "A" && section !== "B" && section !== null) {
    return NextResponse.json(
      { error: "section must be 'A', 'B', or null" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("ib_questions")
    .update({ section: section ?? null })
    .eq("id", questionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
