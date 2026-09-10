import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  convertNuancedAnalysisToDraft,
  countQuestions,
  type NuancedAnalysisRow,
} from "@/lib/nuanced-analysis-bridge";
import type { AssignmentInput, FormattingRequirements } from "@/lib/assignments";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/assignments/from-nuanced-analysis
// Body: { nuancedAnalysisId: string }
//
// Converts a Claude-generated nuanced_analyses row into an assignment_templates
// row (AssignmentDraft shape) so it can be opened in the existing Assignment
// Studio editor at /dashboard/assignments/editor/[id] and exported to a real
// PDF via the already-working document-orchestrator.ts + Puppeteer pipeline.
export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  try {
    const { nuancedAnalysisId } = (await req.json()) as { nuancedAnalysisId?: string };
    if (!nuancedAnalysisId) {
      return NextResponse.json({ error: "Missing nuancedAnalysisId" }, { status: 400 });
    }

    const { data: row, error: fetchError } = await supabase
      .from("nuanced_analyses")
      .select(
        "id, slug, title, subtitle, course, syllabus_topics, prerequisites, materials, vocabulary, atl_statement, tok_provocations, parts, teacher_companion",
      )
      .eq("id", nuancedAnalysisId)
      .single<NuancedAnalysisRow>();

    if (fetchError || !row) {
      return NextResponse.json({ error: "Nuanced analysis packet not found." }, { status: 404 });
    }

    const draft = convertNuancedAnalysisToDraft(row);
    if (draft.sections.length === 0) {
      return NextResponse.json(
        { error: "This packet has no parts to convert — nothing to build a template from." },
        { status: 422 },
      );
    }

    const formattingRequirements: FormattingRequirements = {
      schoolName: "CleverPlatform Mathematics",
      teacherName: "",
      includeNameLine: true,
      includeDateLine: true,
      includeMarksColumn: true,
      includeAnswerKey: true,
      fontSize: 11,
      lineSpacing: "relaxed",
      pageMarginsMm: 16,
      numberingStyle: "numeric",
      answerStyle: "boxes",
      answerBoxLines: 4,
    };

    // gradeLevel has no source in nuanced_analyses (IB course context is
    // "26AH"/"27AH", not a US grade band) — defaults to Grade 12 and is
    // editable in the Assignment Studio editor afterward.
    const assignmentInput: AssignmentInput = {
      gradeLevel: "Grade 12",
      documentKind: "investigation",
      title: row.title,
      topic:
        row.syllabus_topics && row.syllabus_topics.length > 0
          ? row.syllabus_topics.join(", ")
          : row.title,
      learningGoals: row.atl_statement ?? "",
      contextNotes: row.subtitle ?? "",
      questionCount: Math.max(1, Math.min(50, countQuestions(row))),
      challengeMix: "balanced",
      includeRealWorldContext: true,
      tone: "exam-style",
    };

    const templateName = row.title.length > 120 ? `${row.title.slice(0, 117)}...` : row.title;

    // Reuse this teacher's existing working copy rather than inserting a
    // second one on every click of "Open". The lookup is on the
    // nuanced_analysis_id foreign key, backed by a partial unique index on
    // (user_id, nuanced_analysis_id) -- exact, where the earlier match on
    // template_name was only a good guess.
    const { data: existing, error: existingError } = await supabase
      .from("assignment_templates")
      .select("id")
      .eq("user_id", profile.id)
      .eq("nuanced_analysis_id", nuancedAnalysisId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      // Refresh the copy's CONTENT from the packet, and only its content:
      // formatting_requirements is the teacher's own export setup and stays
      // put. The packet is the source of truth now that the editor saves
      // back to it, so a reused row that kept its own stale draft_content
      // would be showing an older version of the very thing it edits.
      const { error: refreshError } = await supabase
        .from("assignment_templates")
        .update({ draft_content: draft, template_name: templateName })
        .eq("id", existing.id);

      if (refreshError) throw refreshError;

      return NextResponse.json(
        { success: true, templateId: existing.id, reused: true },
        { status: 200 },
      );
    }

    const { data: template, error: insertError } = await supabase
      .from("assignment_templates")
      .insert({
        user_id: profile.id,
        template_name: templateName,
        grade_level: assignmentInput.gradeLevel,
        document_kind: assignmentInput.documentKind,
        formatting_requirements: formattingRequirements,
        assignment_input: assignmentInput,
        draft_content: draft,
        nuanced_analysis_id: nuancedAnalysisId,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json(
      { success: true, templateId: template.id, reused: false },
      { status: 201 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to convert packet to Assignment Studio template.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
