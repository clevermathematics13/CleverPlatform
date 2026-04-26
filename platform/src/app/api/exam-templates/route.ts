import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: templates, error } = await supabase
    .from("exam_templates")
    .select("id, curriculum, level, paper, slide_presentation_id, name_field_x, name_field_y, name_field_w, name_field_h")
    .order("curriculum")
    .order("level")
    .order("paper");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: templates ?? [] });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    curriculum?: unknown;
    level?: unknown;
    paper?: unknown;
    slide_presentation_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { curriculum, level, paper, slide_presentation_id } = body;

  if (
    typeof curriculum !== "string" ||
    !["AA", "AI"].includes(curriculum)
  ) {
    return NextResponse.json({ error: "curriculum must be AA or AI" }, { status: 400 });
  }
  if (typeof level !== "string" || !["HL", "SL"].includes(level)) {
    return NextResponse.json({ error: "level must be HL or SL" }, { status: 400 });
  }
  if (typeof paper !== "number" || ![1, 2, 3].includes(paper)) {
    return NextResponse.json({ error: "paper must be 1, 2, or 3" }, { status: 400 });
  }
  if (typeof slide_presentation_id !== "string" || !slide_presentation_id.trim()) {
    return NextResponse.json({ error: "slide_presentation_id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("exam_templates")
    .upsert(
      {
        curriculum,
        level,
        paper,
        slide_presentation_id: slide_presentation_id.trim(),
        // Reset name field coords when presentation ID changes
        name_field_x: null,
        name_field_y: null,
        name_field_w: null,
        name_field_h: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "curriculum,level,paper" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
