import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * GET /api/saved-exams
 * Lists the teacher's ExamBuilder saved exams (public.saved_exams) for the
 * "Import from PPQ Bank" picker on the Tests page. Read-only summary — the
 * full per-question breakdown is fetched separately at import time by
 * POST /api/tests/import-from-saved-exam, which is the only place this data
 * actually turns into a tests/test_items row.
 */
export async function GET(_request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("saved_exams")
    .select("id, name, curriculum, level, paper, course_id, exam_date, questions")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // saved_exams.course_id has no declared foreign key to courses (checked
  // directly against the schema), so PostgREST's embedded-resource select
  // (courses(name)) isn't available here — resolve names with a second,
  // explicit lookup instead.
  const courseIds = [...new Set((data ?? []).map((r) => r.course_id).filter((id): id is string => !!id))];
  const courseNameById = new Map<string, string>();
  if (courseIds.length > 0) {
    const { data: courseRows } = await supabase.from("courses").select("id, name").in("id", courseIds);
    for (const c of courseRows ?? []) courseNameById.set(c.id as string, c.name as string);
  }

  const savedExams = (data ?? []).map((row) => {
    const questions = Array.isArray(row.questions) ? (row.questions as unknown[]) : [];
    const totalMarks = questions.reduce((sum: number, q) => {
      const marks = Number((q as { marks?: unknown }).marks);
      return sum + (Number.isFinite(marks) ? marks : 0);
    }, 0);

    return {
      id: row.id as string,
      name: row.name as string,
      curriculum: row.curriculum as string,
      level: row.level as string,
      paper: row.paper as number,
      course_id: row.course_id as string | null,
      course_name: row.course_id ? courseNameById.get(row.course_id as string) ?? null : null,
      exam_date: row.exam_date as string | null,
      question_count: questions.length,
      total_marks: totalMarks,
    };
  });

  return NextResponse.json({ savedExams });
}
