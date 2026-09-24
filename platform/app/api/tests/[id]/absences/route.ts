import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";
import { loadTestAbsences } from "@/lib/ai-grade-overview";

/**
 * Absences for one test (table test_absences).
 *
 *   GET    /api/tests/[id]/absences            -> { absences: [{ studentId, note, created_at }] }
 *   POST   /api/tests/[id]/absences { studentId, note? }   records one
 *   DELETE /api/tests/[id]/absences { studentId }          clears one
 *
 * studentId is the grader's opaque subject id: a profiles.id, or
 * "invited-<invited_students.id>" for a student who has not registered
 * (parseGradingSubject). Recording an absence writes no marks; it only
 * tells the AI grader's roster and the gradebook to show "Absent" instead
 * of an empty row that looks like "not graded yet".
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  // Shared with the AI-grade page, which loads absences on the server so its
  // roster is in the first HTML (lib/ai-grade-overview.ts).
  const result = await loadTestAbsences(supabase, testId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ absences: result.absences });
}

async function readSubject(request: NextRequest): Promise<{ studentId: string; note: string | null } | null> {
  let body: { studentId?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId) return null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  return { studentId, note };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;
  const { id: testId } = await params;

  const input = await readSubject(request);
  if (!input) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  const subject = parseGradingSubject(input.studentId);

  // Idempotent: a second "mark absent" for the same student is a no-op,
  // not an error (the unique indexes would reject the duplicate row).
  const { data: existing } = await supabase
    .from("test_absences")
    .select("id")
    .eq("test_id", testId)
    .eq(subject.kind === "invited" ? "invited_student_id" : "profile_id", subject.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, studentId: input.studentId });

  const { error } = await supabase.from("test_absences").insert({
    test_id: testId,
    profile_id: subject.kind === "profile" ? subject.id : null,
    invited_student_id: subject.kind === "invited" ? subject.id : null,
    note: input.note,
    created_by: profile.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, studentId: input.studentId });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const input = await readSubject(request);
  if (!input) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  const subject = parseGradingSubject(input.studentId);

  const { error } = await supabase
    .from("test_absences")
    .delete()
    .eq("test_id", testId)
    .eq(subject.kind === "invited" ? "invited_student_id" : "profile_id", subject.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, studentId: input.studentId });
}
