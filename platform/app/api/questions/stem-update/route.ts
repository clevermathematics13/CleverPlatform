import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/questions/stem-update
// Body: { questionId: string, field: QuestionField, value: string }
// Updates question-level LaTeX fields (stem and parts draft) on ib_questions.
type QuestionField =
  | "stem_latex"
  | "stem_markscheme_latex"
  | "parts_draft_latex"
  | "parts_draft_markscheme_latex";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    questionId: string;
    field: QuestionField;
    value: string;
  };

  const { questionId, field, value } = body;

  if (!questionId || !field || value === undefined) {
    return NextResponse.json(
      { error: "questionId, field, and value are required" },
      { status: 400 }
    );
  }

  const validFields: QuestionField[] = [
    "stem_latex",
    "stem_markscheme_latex",
    "parts_draft_latex",
    "parts_draft_markscheme_latex",
  ];
  if (!validFields.includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const { error } = await supabase
    .from("ib_questions")
    .update({ [field]: value })
    .eq("id", questionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
