import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ─── Auth helper ─────────────────────────────────────────────────────────────
async function requireTeacher() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "teacher") return { supabase, user: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { supabase, user, error: null };
}

// ─── GET /api/exams — list saved exams for current teacher ───────────────────
export async function GET() {
  const { supabase, user, error } = await requireTeacher();
  if (error) return error;

  const { data, error: dbError } = await supabase
    .from("saved_exams")
    .select("id, name, curriculum, level, paper, course_id, exam_date, questions, created_at, updated_at")
    .eq("teacher_id", user!.id)
    .order("updated_at", { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ exams: data ?? [] });
}

// ─── POST /api/exams — create a new saved exam ───────────────────────────────
export async function POST(request: NextRequest) {
  const { supabase, user, error } = await requireTeacher();
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, curriculum, level, paper, course_id, exam_date, questions } = body;

  if (typeof name !== "string" || !name.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!["AA", "AI"].includes(curriculum as string)) return NextResponse.json({ error: "Invalid curriculum" }, { status: 400 });
  if (!["HL", "SL"].includes(level as string)) return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  if (![1, 2, 3].includes(paper as number)) return NextResponse.json({ error: "Invalid paper" }, { status: 400 });
  if (!Array.isArray(questions)) return NextResponse.json({ error: "questions must be array" }, { status: 400 });

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
      questions,
    })
    .select("id")
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

// ─── PATCH /api/exams — update an existing saved exam ───────────────────────
export async function PATCH(request: NextRequest) {
  const { supabase, user, error } = await requireTeacher();
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { id, name, curriculum, level, paper, course_id, exam_date, questions } = body;
  if (typeof id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (["AA", "AI"].includes(curriculum as string)) updates.curriculum = curriculum;
  if (["HL", "SL"].includes(level as string)) updates.level = level;
  if ([1, 2, 3].includes(paper as number)) updates.paper = paper;
  if (course_id !== undefined) updates.course_id = course_id ?? null;
  if (exam_date !== undefined) updates.exam_date = exam_date ?? null;
  if (Array.isArray(questions)) updates.questions = questions;

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
  const { supabase, user, error } = await requireTeacher();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error: dbError } = await supabase
    .from("saved_exams")
    .delete()
    .eq("id", id)
    .eq("teacher_id", user!.id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
