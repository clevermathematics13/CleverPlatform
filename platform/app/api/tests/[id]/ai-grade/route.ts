import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import {
  asMarkSchemeDb,
  AI_GRADING_MODEL,
  AI_GRADING_SYSTEM_PROMPT,
  buildGradingBrief,
  parseAiGradeResponse,
  reconcileItem,
  resolveTestMarkSchemes,
} from "@/lib/ai-grading";

export const maxDuration = 300;

const SCAN_BUCKET = "corrections";

/**
 * GET /api/tests/[id]/ai-grade
 *   Preflight: mark-scheme coverage for the test, plus each student's scan
 *   status and the most recent grading run.
 *
 * POST /api/tests/[id]/ai-grade
 *   multipart/form-data: studentId, file (the scanned script)
 *   or application/json: { studentId } to reuse an already-uploaded scan.
 *   Grades the scan and stages suggestions in ai_grade_results.
 *   Never writes to student_marks — see ./accept.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;
  const focusStudentId = request.nextUrl.searchParams.get("studentId");

  const { data: test } = await supabase
    .from("tests")
    .select("id, name, course_id, total_marks")
    .eq("id", testId)
    .maybeSingle();

  if (!test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  const { items, coverage } = await resolveTestMarkSchemes(asMarkSchemeDb(supabase), testId);

  // Roster for the test's course
  const { data: roster } = await supabase
    .from("students")
    .select("profile_id, hidden, profiles(display_name)")
    .eq("course_id", test.course_id as string);

  const studentIds = (roster ?? []).map((r) => r.profile_id as string);

  const { data: uploads } = studentIds.length
    ? await supabase
        .from("pdf_uploads")
        .select("student_id, file_name, uploaded_at")
        .eq("test_id", testId)
        .in("student_id", studentIds)
    : { data: [] };

  const { data: runs } = studentIds.length
    ? await supabase
        .from("ai_grade_runs")
        .select("id, student_id, status, created_at, completed_at, error")
        .eq("test_id", testId)
        .in("student_id", studentIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const uploadMap = new Map((uploads ?? []).map((u) => [u.student_id, u]));
  const latestRun = new Map<string, Record<string, unknown>>();
  for (const r of runs ?? []) {
    if (!latestRun.has(r.student_id as string)) {
      latestRun.set(r.student_id as string, r as Record<string, unknown>);
    }
  }

  const students = (roster ?? [])
    .filter((r) => !r.hidden)
    .map((r) => {
      const profile = r.profiles as unknown as { display_name: string } | null;
      const upload = uploadMap.get(r.profile_id as string);
      return {
        student_id: r.profile_id as string,
        display_name: profile?.display_name ?? "Unknown",
        has_scan: !!upload,
        scan_name: upload?.file_name ?? null,
        latest_run: latestRun.get(r.profile_id as string) ?? null,
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  // When a student is focused, attach their latest run's staged suggestions
  // alongside any mark already recorded, so the UI can show both side by side.
  let results: unknown[] = [];
  let focusedRunId: string | null = null;

  if (focusStudentId) {
    const run = latestRun.get(focusStudentId) as { id?: string } | undefined;
    focusedRunId = run?.id ?? null;
    if (focusedRunId) {
      const { data: rows } = await supabase
        .from("ai_grade_results")
        .select(
          "test_item_id, suggested_marks, max_marks, confidence, markscheme_source, work_found, reasoning, evidence, mark_breakdown, accepted"
        )
        .eq("run_id", focusedRunId);
      results = rows ?? [];
    }

    const { data: current } = await supabase
      .from("student_marks")
      .select("test_item_id, marks_awarded")
      .eq("student_id", focusStudentId)
      .in(
        "test_item_id",
        items.map((i) => i.test_item_id)
      );

    const currentMap = new Map(
      (current ?? []).map((m) => [m.test_item_id as string, m.marks_awarded as number])
    );
    results = (results as Record<string, unknown>[]).map((r) => ({
      ...r,
      current_marks: currentMap.get(r.test_item_id as string) ?? null,
    }));
  }

  return NextResponse.json({
    test: { id: test.id, name: test.name, total_marks: test.total_marks },
    coverage,
    focusedRunId,
    results,
    items: items.map((i) => ({
      test_item_id: i.test_item_id,
      question_number: i.question_number,
      part_label: i.part_label,
      max_marks: i.max_marks,
      ib_question_code: i.ib_question_code,
      markscheme_source: i.markscheme_source,
      unsegmented: i.unsegmented,
    })),
    students,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: testId } = await params;

  // ── Parse input: multipart (new scan) or JSON (reuse stored scan) ─────────
  let studentId = "";
  let uploadedFile: File | null = null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    studentId = String(form.get("studentId") ?? "");
    const f = form.get("file");
    if (f && typeof f !== "string") uploadedFile = f as File;
  } else {
    try {
      const body = (await request.json()) as { studentId?: string };
      studentId = String(body.studentId ?? "");
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
  }

  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  // ── Resolve mark schemes ──────────────────────────────────────────────────
  const { items, coverage } = await resolveTestMarkSchemes(asMarkSchemeDb(supabase), testId);
  const gradable = items.filter((i) => i.markscheme_source !== "none");

  if (gradable.length === 0) {
    return NextResponse.json(
      {
        error:
          "No question in this test has a mark scheme in the PPQ bank. Add mark schemes before grading.",
        coverage,
      },
      { status: 422 }
    );
  }

  // ── Obtain the scan ───────────────────────────────────────────────────────
  let pdfBase64 = "";
  let storagePath = "";

  if (uploadedFile) {
    if (uploadedFile.type && uploadedFile.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Scan must be a PDF. Combine photos into a single PDF first." },
        { status: 400 }
      );
    }
    const bytes = Buffer.from(await uploadedFile.arrayBuffer());
    pdfBase64 = bytes.toString("base64");
    storagePath = `ai-grading/${testId}/${studentId}/${uploadedFile.name}`;
    // Store the teacher-supplied scan under its own prefix so it never
    // collides with the student-facing corrections upload flow.
    await supabase.storage
      .from(SCAN_BUCKET)
      .upload(storagePath, bytes, { upsert: true, contentType: "application/pdf" });
  } else {
    const { data: existing } = await supabase
      .from("pdf_uploads")
      .select("storage_path")
      .eq("student_id", studentId)
      .eq("test_id", testId)
      .maybeSingle();

    if (!existing?.storage_path) {
      return NextResponse.json(
        { error: "No scan found for this student. Upload a PDF of their work." },
        { status: 404 }
      );
    }
    storagePath = existing.storage_path as string;
    const { data: blob, error: dlError } = await supabase.storage
      .from(SCAN_BUCKET)
      .download(storagePath);

    if (dlError || !blob) {
      return NextResponse.json(
        { error: "Could not download the stored scan." },
        { status: 500 }
      );
    }
    pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  }

  // ── Open the run ──────────────────────────────────────────────────────────
  const { data: run, error: runError } = await supabase
    .from("ai_grade_runs")
    .insert({
      test_id: testId,
      student_id: studentId,
      created_by: user.id,
      status: "running",
      model: AI_GRADING_MODEL,
      source_storage_path: storagePath,
      coverage,
    })
    .select("id")
    .single();

  if (runError || !run) {
    return NextResponse.json(
      { error: runError?.message ?? "Could not create grading run" },
      { status: 500 }
    );
  }

  const runId = run.id as string;

  const fail = async (message: string, status = 500) => {
    await supabase
      .from("ai_grade_runs")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", runId);
    return NextResponse.json({ error: message, runId }, { status });
  };

  // ── Grade ─────────────────────────────────────────────────────────────────
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: AI_GRADING_MODEL,
      max_tokens: 16000,
      system: AI_GRADING_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            { type: "text", text: buildGradingBrief(gradable) },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";

    const parsed = parseAiGradeResponse(raw);
    if (!parsed.ok) {
      return await fail(`Model response failed validation: ${parsed.error}`, 502);
    }

    const resolvedById = new Map(gradable.map((i) => [i.test_item_id, i]));
    const rows = [];

    for (const modelItem of parsed.data.items) {
      const resolved = resolvedById.get(modelItem.test_item_id);
      // Ignore hallucinated ids that were not in the brief.
      if (!resolved) continue;

      const { suggested_marks, confidence } = reconcileItem(modelItem, resolved);

      rows.push({
        run_id: runId,
        test_item_id: resolved.test_item_id,
        suggested_marks,
        max_marks: resolved.max_marks,
        confidence,
        markscheme_source: resolved.markscheme_source,
        work_found: modelItem.work_found,
        reasoning: modelItem.reasoning,
        evidence: modelItem.evidence,
        mark_breakdown: modelItem.mark_breakdown,
      });
    }

    if (rows.length === 0) {
      return await fail("The model returned no items matching this test.", 502);
    }

    const { error: insertError } = await supabase.from("ai_grade_results").insert(rows);
    if (insertError) return await fail(insertError.message);

    await supabase
      .from("ai_grade_runs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", runId);

    const missing = gradable.length - rows.length;

    return NextResponse.json({
      runId,
      graded: rows.length,
      skipped_no_markscheme: items.length - gradable.length,
      missing_from_response: missing,
      coverage,
    });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "Grading failed");
  }
}
