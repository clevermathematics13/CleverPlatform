import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";

/**
 * POST /api/students/aliases
 * Body: { studentId: string, alias: string }
 *
 * Records an alternative spelling of a student's name -- typically the way
 * it was misread off a scanned cover page ("Galo Mafiol" for Galo Masias)
 * -- in invited_students.name_aliases, so the AI grader's roster matcher
 * recognises it next time (see matchSegmentsToRoster in lib/ai-grading.ts).
 *
 * studentId is the opaque subject id the grader uses everywhere: either
 * "invited-<invited_students.id>" or a profiles.id (parseGradingSubject).
 * A registered student may hold an invited_students row per class they
 * were ever invited to; the alias goes on every visible one, since the
 * matcher pools rosters across sibling classes.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  let body: { studentId?: unknown; alias?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const alias = typeof body.alias === "string" ? body.alias.replace(/\s+/g, " ").trim() : "";
  if (!studentId || !alias) {
    return NextResponse.json({ error: "studentId and alias are required" }, { status: 400 });
  }
  if (alias.length > 120) {
    return NextResponse.json({ error: "alias is too long" }, { status: 400 });
  }

  const subject = parseGradingSubject(studentId);
  let query = supabase.from("invited_students").select("id, full_name, name_aliases").eq("hidden", false);
  query = subject.kind === "invited" ? query.eq("id", subject.id) : query.eq("profile_id", subject.id);
  const { data: rows, error: loadErr } = await query;
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "No roster entry found for this student" }, { status: 404 });
  }

  const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
  let aliases: string[] = [];
  for (const row of rows) {
    const existing = ((row.name_aliases as string[] | null) ?? []).filter(Boolean);
    const fullName = (row.full_name as string | null) ?? "";
    // Nothing to record if the alias IS the roster name or is already known.
    if (sameName(alias, fullName) || existing.some((a) => sameName(a, alias))) {
      aliases = existing;
      continue;
    }
    aliases = [...existing, alias];
    const { error: updateErr } = await supabase
      .from("invited_students")
      .update({ name_aliases: aliases })
      .eq("id", row.id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, aliases });
}
