import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * POST /api/tests/import-from-saved-exam
 * Body: { savedExamId: string, name?: string, testDate?: string | null, force?: boolean }
 *
 * Bridges public.saved_exams (ExamBuilder's output — an ordered JSON array of
 * {code, marks, section, partSubtopics[]}) into public.tests / test_items,
 * the tables the rest of the platform (Gradebook, Reflection, AI grading)
 * actually reads. This bridge did not exist before: a saved exam had no path
 * into a real test short of manually re-typing every question number and
 * mark, with no field to attach the IB question code at all — so no
 * PPQ-Bank-authored exam could ever be AI-graded.
 *
 * Per test_items row, ib_question_code and part_label come straight from the
 * saved exam. max_marks is resolved from public.question_parts (the bank's
 * own authoritative per-part mark allocation) rather than trusting the saved
 * exam's per-QUESTION total split evenly — a question stored in ExamBuilder
 * as "7 marks" is not necessarily two 3.5-mark parts, and question_parts
 * already has the real 2/3/2 (or whatever) breakdown. Falls back to an even
 * split, flagged in the response, only when a part genuinely isn't found in
 * the bank (e.g. the question was added to saved_exams before extraction).
 *
 * question_number is assigned by array position (ExamBuilder's own question
 * order), 1-indexed, since saved_exams does not store one explicitly.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: { savedExamId?: unknown; name?: unknown; testDate?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const savedExamId = typeof body.savedExamId === "string" ? body.savedExamId.trim() : "";
  if (!savedExamId) {
    return NextResponse.json({ error: "savedExamId is required" }, { status: 400 });
  }
  const force = body.force === true;

  // -- Load the saved exam ----------------------------------------------------
  const { data: savedExam, error: seErr } = await supabase
    .from("saved_exams")
    .select("id, name, curriculum, level, paper, course_id, exam_date, questions")
    .eq("id", savedExamId)
    .maybeSingle();

  if (seErr) return NextResponse.json({ error: seErr.message }, { status: 500 });
  if (!savedExam) return NextResponse.json({ error: "Saved exam not found" }, { status: 404 });
  if (!savedExam.course_id) {
    return NextResponse.json(
      { error: "This saved exam has no class assigned — set one in ExamBuilder before importing." },
      { status: 422 }
    );
  }

  const rawQuestions = Array.isArray(savedExam.questions) ? (savedExam.questions as unknown[]) : [];
  if (rawQuestions.length === 0) {
    return NextResponse.json({ error: "This saved exam has no questions." }, { status: 422 });
  }

  interface SavedQuestion {
    code: string;
    marks: number;
    partSubtopics: { partLabel: string; codes: string[] }[];
  }

  const questions: SavedQuestion[] = rawQuestions.map((q) => {
    const r = q as Record<string, unknown>;
    const marks = Number(r.marks);
    const parts = Array.isArray(r.partSubtopics) ? (r.partSubtopics as unknown[]) : [];
    return {
      code: typeof r.code === "string" ? r.code : "",
      marks: Number.isFinite(marks) ? marks : 0,
      partSubtopics: parts.map((p) => {
        const pr = p as Record<string, unknown>;
        return { partLabel: typeof pr.partLabel === "string" ? pr.partLabel : "" };
      }) as { partLabel: string; codes: string[] }[],
    };
  });

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : savedExam.name;
  const testDate =
    typeof body.testDate === "string" && body.testDate ? body.testDate : (savedExam.exam_date as string | null);

  // -- Guard against an accidental duplicate import ----------------------------
  if (!force) {
    const { data: existing } = await supabase
      .from("tests")
      .select("id")
      .eq("name", name)
      .eq("course_id", savedExam.course_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          error: `A test named "${name}" already exists for this class.`,
          existingTestId: existing.id,
          needsConfirmation: true,
        },
        { status: 409 }
      );
    }
  }

  // -- Resolve real per-part marks from the question bank ----------------------
  const codes = [...new Set(questions.map((q) => q.code).filter(Boolean))];

  const { data: questionRows, error: qErr } = await supabase
    .from("ib_questions")
    .select("id, code")
    .in("code", codes);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  const questionIdByCode = new Map((questionRows ?? []).map((q) => [q.code as string, q.id as string]));
  const questionIds = [...questionIdByCode.values()];

  const { data: partRows, error: pErr } = questionIds.length
    ? await supabase.from("question_parts").select("question_id, part_label, marks").in("question_id", questionIds)
    : { data: [], error: null };
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const partsByQuestionId = new Map<string, { part_label: string | null; marks: number | null }[]>();
  for (const p of partRows ?? []) {
    const list = partsByQuestionId.get(p.question_id as string) ?? [];
    list.push({ part_label: p.part_label as string | null, marks: p.marks as number | null });
    partsByQuestionId.set(p.question_id as string, list);
  }
  const normaliseLabel = (l: string | null | undefined) => (l ?? "").trim().toLowerCase();

  const warnings: string[] = [];
  const items: {
    question_number: number;
    part_label: string;
    max_marks: number;
    ib_question_code: string;
    sort_order: number;
  }[] = [];

  questions.forEach((q, qIdx) => {
    const questionNumber = qIdx + 1;
    const questionId = questionIdByCode.get(q.code);
    const bankParts = questionId ? partsByQuestionId.get(questionId) ?? [] : [];

    if (!questionId) {
      warnings.push(`Q${questionNumber} (${q.code}): not found in the question bank — skipped.`);
      return;
    }

    const partLabels = q.partSubtopics.length > 0 ? q.partSubtopics.map((p) => p.partLabel) : [""];

    // Try to resolve each part's real mark allocation from the bank.
    const resolved = partLabels.map((label) => {
      const match = bankParts.find((bp) => normaliseLabel(bp.part_label) === normaliseLabel(label));
      return { label, marks: match?.marks ?? null };
    });

    const allResolved = resolved.every((r) => r.marks !== null);

    if (allResolved) {
      resolved.forEach((r, pIdx) => {
        items.push({
          question_number: questionNumber,
          part_label: r.label,
          max_marks: r.marks as number,
          ib_question_code: q.code,
          sort_order: items.length,
        });
        void pIdx;
      });
    } else {
      // Fall back to an even split of the saved exam's question-level total —
      // flagged so the teacher knows to double-check mark boundaries here.
      const share = partLabels.length > 0 ? q.marks / partLabels.length : q.marks;
      warnings.push(
        `Q${questionNumber} (${q.code}): per-part marks not found in the bank — split ${q.marks} evenly across ${partLabels.length} part(s). Check this test's mark allocation.`
      );
      partLabels.forEach((label) => {
        items.push({
          question_number: questionNumber,
          part_label: label,
          max_marks: Math.round(share),
          ib_question_code: q.code,
          sort_order: items.length,
        });
      });
    }
  });

  if (items.length === 0) {
    return NextResponse.json(
      { error: "None of this exam's questions could be resolved into test items.", warnings },
      { status: 422 }
    );
  }

  const totalMarks = items.reduce((s, i) => s + i.max_marks, 0);

  // -- Create the test ----------------------------------------------------------
  const { data: test, error: testErr } = await supabase
    .from("tests")
    .insert({
      name,
      course_id: savedExam.course_id,
      teacher_id: user.id,
      test_date: testDate,
      total_marks: totalMarks,
    })
    .select("id")
    .single();

  if (testErr || !test) {
    return NextResponse.json({ error: testErr?.message ?? "Failed to create test" }, { status: 500 });
  }

  const { error: itemsErr } = await supabase.from("test_items").insert(
    items.map((i) => ({
      test_id: test.id,
      question_number: i.question_number,
      part_label: i.part_label,
      max_marks: i.max_marks,
      ib_question_code: i.ib_question_code,
      sort_order: i.sort_order,
    }))
  );

  if (itemsErr) {
    // Clean up the test if items failed, mirroring POST /api/tests's own behaviour.
    await supabase.from("tests").delete().eq("id", test.id);
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  return NextResponse.json({
    id: test.id,
    itemCount: items.length,
    totalMarks,
    warnings,
  });
}
