import { getApiTeacher } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TemplateData = {
  templateName: string;
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  documentKind: string;
  formattingRequirements: Record<string, unknown>;
  assignmentInput: Record<string, unknown>;
};

export async function GET(req: Request, context: { params: { action: string } }) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, profile } = auth;
    const action = context.params.action;

    if (action === "list") {
      const { searchParams } = new URL(req.url);
      const gradeLevel = searchParams.get("grade") ?? "Grade 9";

      const { data, error } = await supabase
        .from("assignment_templates")
        .select("*")
        .eq("user_id", profile.id)
        .eq("grade_level", gradeLevel)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return NextResponse.json({ templates: data }, { status: 200 });
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
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
        { error: "Missing required fields" },
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

    // Verify ownership
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

    // Verify ownership
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
