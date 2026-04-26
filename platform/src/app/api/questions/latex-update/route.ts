import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/questions/latex-update
// Body: { partId: string, field: "content_latex"|"markscheme_latex", value: string }
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

  const body = await request.json() as {
    partId: string;
    field: "content_latex" | "markscheme_latex";
    value: string;
  };

  const { partId, field, value } = body;

  if (!partId || !field || value === undefined) {
    return NextResponse.json(
      { error: "partId, field, and value are required" },
      { status: 400 }
    );
  }
  if (!["content_latex", "markscheme_latex"].includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const { error } = await supabase
    .from("question_parts")
    .update({ [field]: value })
    .eq("id", partId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
