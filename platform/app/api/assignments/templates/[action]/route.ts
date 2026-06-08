import { getApiTeacher } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TemplateData = {
  templateName: string;
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  documentKind: string;
  formattingRequirements: Record<string, unknown>;
  assignmentInput: Record<string, unknown>;
  draftContent?: Record<string, unknown> | null;
};

type SavedTemplate = {
  id: string;
  template_name: string;
  grade_level: string;
  document_kind: string;
  formatting_requirements: Record<string, unknown>;
  assignment_input: Record<string, unknown>;
  draft_content?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

// Next.js 15+: params is a Promise — must be awaited before use
export async function GET(
  req: Request,
  context: { params: Promise<{ action: string }> }
) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, profile } = auth;

    const { action } = await context.params;

    if (action === "list") {
      const { searchParams } = new URL(req.url);
      const gradeParam = searchParams.get("grade");

      let query = supabase
        .from("assignment_templates")
        .select("*")
        .eq("user_id", profile.id);

      // If grade is "all" or not provided, fetch from all grades
      // Otherwise filter to specific grade
      if (gradeParam && gradeParam !== "all") {
        query = query.eq("grade_level", gradeParam);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;

      const templates = (data ?? []).map((row: SavedTemplate) => ({
        id: row.id,
        template_name: row.template_name,
        grade_level: row.grade_level,
        document_kind: row.document_kind,
        formatting_requirements: row.formatting_requirements,
        assignment_input: row.assignment_input,
        draft_content: row.draft_content ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      return NextResponse.json({ templates }, { status: 200 });
    }

    if (action === "get") {
      const { searchParams } = new URL(req.url);
      const templateId = searchParams.get("id");

      if (!templateId) {
        return NextResponse.json({ error: "Missing template id" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("assignment_templates")
        .select("*")
        .eq("id", templateId)
        .eq("user_id", profile.id)
        .single();

      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "Template not found" }, { status: 404 });
      }

      return NextResponse.json({ template: data }, { status: 200 });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template fetch error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, profile } = auth;
    const body = (await req.json()) as TemplateData;

    const { templateName, gradeLevel, documentKind, formattingRequirements, assignmentInput } = body;

    if (!templateName || !gradeLevel || !documentKind) {
      return NextResponse.json(
        { error: "Missing required fields: templateName, gradeLevel, documentKind" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("assignment_templates")
      .insert({
        user_id: profile.id,
        template_name: templateName,
        grade_level: gradeLevel,
        document_kind: documentKind,
        formatting_requirements: formattingRequirements,
        assignment_input: assignmentInput,
        draft_content: body.draftContent ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ template: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template save error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, profile } = auth;
    const body = (await req.json()) as TemplateData & { id: string };

    const { id, templateName, gradeLevel, documentKind, formattingRequirements, assignmentInput } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing template id" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("assignment_templates")
      .select("user_id")
      .eq("id", id)
      .single();

    if (!existing || existing.user_id !== profile.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("assignment_templates")
      .update({
        template_name: templateName,
        grade_level: gradeLevel,
        document_kind: documentKind,
        formatting_requirements: formattingRequirements,
        assignment_input: assignmentInput,
        draft_content: body.draftContent ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ template: data }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template update error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, profile } = auth;
    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get("id");

    if (!templateId) {
      return NextResponse.json({ error: "Missing template id" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("assignment_templates")
      .select("user_id")
      .eq("id", templateId)
      .single();

    if (!existing || existing.user_id !== profile.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await supabase
      .from("assignment_templates")
      .delete()
      .eq("id", templateId);

    if (error) throw error;

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template delete error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
