import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/** Derive the notes flag: set 'no_datetime' when neither date nor time is provided. */
function computeNotes(examDate: unknown, examTime: unknown): string | null {
  const hasDate = typeof examDate === "string" && examDate.trim() !== "";
  const hasTime = typeof examTime === "string" && examTime.trim() !== "";
  return !hasDate && !hasTime ? "no_datetime" : null;
}

// ─── GET /api/exams — list saved exams for current teacher ───────────────────
export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data, error: dbError } = await supabase
    .from("saved_exams")
    .select("id, name, curriculum, level, paper, course_id, exam_date, exam_time, notes, questions, created_at, updated_at")
    .eq("teacher_id", user!.id)
    .order("updated_at", { ascending: false });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const exams = data ?? [];

  // Re-hydrate marks from live question_parts so stale stored values don't show wrong minutes
  const allIds = [...new Set(
    exams.flatMap((e) => ((e.questions as { id: string }[]) ?? []).map((q) => q.id))
  )];

  if (allIds.length > 0) {
    const { data: partsData } = await supabase
      .from("question_parts")
      .select("question_id, marks, subtopic_codes, part_label, sort_order")
      .in("question_id", allIds)
      .order("sort_order", { ascending: true });

    function filterPriorLearning(codes: string[]): string[] {
      let result = codes;
      if (result.length > 1 && result.includes("1.0")) result = result.filter((c) => c !== "1.0");
      if (result.includes("2.1") && result.some((c) => c !== "2.1" && c !== "1.0")) result = result.filter((c) => c !== "2.1");
      return result;
    }

    const liveMarks: Record<string, number> = {};
    const liveSubtopics: Record<string, Set<string>> = {};
    const livePartSubtopics: Record<string, { partLabel: string; codes: string[] }[]> = {};
    for (const p of (partsData ?? [])) {
      liveMarks[p.question_id] = (liveMarks[p.question_id] ?? 0) + (p.marks ?? 0);
      if (!liveSubtopics[p.question_id]) liveSubtopics[p.question_id] = new Set();
      const filtered = filterPriorLearning(p.subtopic_codes ?? []);
      for (const code of filtered) liveSubtopics[p.question_id].add(code);
      if (filtered.length > 0) {
        if (!livePartSubtopics[p.question_id]) livePartSubtopics[p.question_id] = [];
        livePartSubtopics[p.question_id].push({ partLabel: p.part_label ?? "", codes: filtered });
      }
    }

    for (const exam of exams) {
      // Guard: questions must be a JSON array — older rows or bugs may store non-array
      const rawQuestions = Array.isArray(exam.questions) ? exam.questions : [];
      exam.questions = (rawQuestions as { id: string; marks: number; subtopicCodes?: string[]; partSubtopics?: { partLabel: string; codes: string[] }[] }[]).map((q) => ({
        ...q,
        marks: liveMarks[q.id] ?? q.marks,
        subtopicCodes: liveSubtopics[q.id] ? [...liveSubtopics[q.id]] : (Array.isArray(q.subtopicCodes) ? q.subtopicCodes : []),
        partSubtopics: livePartSubtopics[q.id] ?? (Array.isArray(q.partSubtopics) ? q.partSubtopics : []),
      }));
    }
  }

  return NextResponse.json({ exams });
}

// ─── POST /api/exams — create a new saved exam ───────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, curriculum, level, paper, course_id, exam_date, exam_time, questions } = body;

  if (typeof name !== "string" || !name.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!["AA", "AI"].includes(curriculum as string)) return NextResponse.json({ error: "Invalid curriculum" }, { status: 400 });
  if (!["HL", "SL"].includes(level as string)) return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  if (![1, 2, 3].includes(paper as number)) return NextResponse.json({ error: "Invalid paper" }, { status: 400 });
  if (!Array.isArray(questions)) return NextResponse.json({ error: "questions must be array" }, { status: 400 });

  const notes = computeNotes(exam_date, exam_time);

  const { data, error: dbError } = await supabase
    .from("saved_exams")
    .insert({
      teacher_id: user!.id,
      name: name.trim(),
      curriculum,
      level,
      paper,
      course_id: course_id ?? null,
      exam_date: exam_date ?? null,
      exam_time: exam_time ?? null,
      notes,
      questions,
    })
    .select("id")
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ id: data.id, notes }, { status: 201 });
}

// ─── PATCH /api/exams — update an existing saved exam ───────────────────────
export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { id, name, curriculum, level, paper, course_id, exam_date, exam_time, questions } = body;
  if (typeof id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (["AA", "AI"].includes(curriculum as string)) updates.curriculum = curriculum;
  if (["HL", "SL"].includes(level as string)) updates.level = level;
  if ([1, 2, 3].includes(paper as number)) updates.paper = paper;
  if (course_id !== undefined) updates.course_id = course_id ?? null;
  if (exam_date !== undefined) updates.exam_date = exam_date ?? null;
  if (exam_time !== undefined) updates.exam_time = exam_time ?? null;
  if (Array.isArray(questions)) updates.questions = questions;

  // Recompute notes whenever date or time fields are touched
  if (exam_date !== undefined || exam_time !== undefined) {
    const effectiveDate = exam_date !== undefined ? exam_date : body.exam_date;
    const effectiveTime = exam_time !== undefined ? exam_time : body.exam_time;
    updates.notes = computeNotes(effectiveDate, effectiveTime);
  }

  const { error: dbError } = await supabase
    .from("saved_exams")
    .update(updates)
    .eq("id", id)
    .eq("teacher_id", user!.id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// ─── DELETE /api/exams — delete a saved exam ─────────────────────────────────
export async function DELETE(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data: savedExam, error: examError } = await supabase
    .from("saved_exams")
    .select("id, teacher_id, name, curriculum, level, paper, course_id, exam_date, exam_time, notes, questions, created_at, updated_at")
    .eq("id", id)
    .eq("teacher_id", user!.id)
    .single();

  if (examError || !savedExam) {
    return NextResponse.json({ error: examError?.message ?? "Saved exam not found" }, { status: 404 });
  }

  const { error: archiveError } = await supabase
    .from("archived_saved_exams")
    .insert({
      teacher_id: savedExam.teacher_id,
      original_saved_exam_id: savedExam.id,
      archived_by: user.id,
      exam_name: savedExam.name,
      curriculum: savedExam.curriculum,
      level: savedExam.level,
      paper: savedExam.paper,
      course_id: savedExam.course_id,
      exam_date: savedExam.exam_date,
      exam_time: savedExam.exam_time,
      archived_payload: savedExam,
      questions: Array.isArray(savedExam.questions) ? savedExam.questions : [],
    });

  if (archiveError) {
    return NextResponse.json({ error: archiveError.message }, { status: 500 });
  }

  const { error: dbError } = await supabase
    .from("saved_exams")
    .delete()
    .eq("id", id)
    .eq("teacher_id", user!.id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
