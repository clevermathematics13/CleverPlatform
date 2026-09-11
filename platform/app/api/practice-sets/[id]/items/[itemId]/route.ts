import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { isPracticeTier } from "@/lib/practice-sets";

/**
 * PATCH /api/practice-sets/[id]/items/[itemId]
 *
 * Approve a generated question, or edit it. Approval is the gate that lets a
 * generated question reach a student at all, so it is deliberately an
 * explicit act with a name attached: approved_by records who read it.
 *
 * Editing clears the approval. A teacher who changes the wording of a
 * question has changed what the class will be asked, and the previous
 * approval was for the previous text -- re-reading it is the point.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: setId, itemId } = await ctx.params;

  const body = (await request.json()) as {
    approved?: unknown;
    questionLatex?: unknown;
    answerLatex?: unknown;
    tier?: unknown;
    marks?: unknown;
    teacherNote?: unknown;
  };

  const patch: Record<string, unknown> = {};
  let edited = false;

  if (typeof body.questionLatex === "string" && body.questionLatex.trim()) {
    patch.question_latex = body.questionLatex;
    edited = true;
  }
  if (typeof body.answerLatex === "string") {
    patch.answer_latex = body.answerLatex.trim() || null;
    edited = true;
  }
  if (typeof body.tier === "string" && isPracticeTier(body.tier)) patch.tier = body.tier;
  if (typeof body.marks === "number" && Number.isInteger(body.marks) && body.marks > 0) {
    patch.marks = body.marks;
  }
  if (typeof body.teacherNote === "string") {
    patch.teacher_note = body.teacherNote.trim() || null;
  }

  if (edited) {
    patch.approved_at = null;
    patch.approved_by = null;
  } else if (typeof body.approved === "boolean") {
    patch.approved_at = body.approved ? new Date().toISOString() : null;
    patch.approved_by = body.approved ? user.id : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { error } = await supabase
    .from("practice_set_items")
    .update(patch)
    .eq("id", itemId)
    .eq("practice_set_id", setId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, approvalCleared: edited });
}

/** DELETE /api/practice-sets/[id]/items/[itemId] */
export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { id: setId, itemId } = await ctx.params;

  const { error } = await auth.supabase
    .from("practice_set_items")
    .delete()
    .eq("id", itemId)
    .eq("practice_set_id", setId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
