import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * PATCH /api/practice-sets/[id]
 *
 * Rename, re-describe, release or withhold. Both release gates are timestamps
 * so the record says when, and both are settable in either direction -- a set
 * put in front of a class by mistake has to be retractable in one click.
 *
 * Releasing mark schemes is the consequential one. It is accepted here, but
 * note what it does and does not do: it flips practice_sets.markscheme_released_at,
 * and nothing in the student-facing service reads answer content yet. The
 * order of operations for actually shipping answers is written at the top of
 * lib/practice-set-service.ts.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await ctx.params;

  const body = (await request.json()) as {
    name?: unknown;
    description?: unknown;
    released?: unknown;
    markschemeReleased?: unknown;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description.trim() || null;
  if (typeof body.released === "boolean") {
    patch.released_at = body.released ? new Date().toISOString() : null;
  }
  if (typeof body.markschemeReleased === "boolean") {
    patch.markscheme_released_at = body.markschemeReleased ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { error } = await supabase.from("practice_sets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/practice-sets/[id] -- removes the set and, by cascade, its items. */
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const { error } = await auth.supabase.from("practice_sets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
