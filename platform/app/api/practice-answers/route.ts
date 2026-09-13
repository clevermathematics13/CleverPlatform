import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";

/**
 * Where a student's practice answer is saved. Students only.
 *
 * The role check here is not belt-and-braces over the RLS -- it is the thing
 * that produces a sensible 403 instead of a confusing empty write. The RLS is
 * still the boundary: `practice_answers` grants teachers SELECT and nothing
 * more, so even if this route were wrong, a teacher previewing a student's
 * page with ?viewAs= could not write into that student's record.
 *
 * A student can only ever write their OWN row: profile_id is taken from the
 * authenticated session and never from the request body. There is deliberately
 * no way to name whose answer is being saved.
 */

/** An answer longer than this is not an answer; it is a paste or a loop. */
const MAX_ANSWER_CHARS = 8000;

export async function PUT(request: NextRequest) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  if (profile.role !== "student") {
    return NextResponse.json(
      { error: "Only a student can save an answer to their own practice set." },
      { status: 403 }
    );
  }

  const body = (await request.json()) as {
    itemId?: unknown;
    partLabel?: unknown;
    answerLatex?: unknown;
  };

  const itemId = typeof body.itemId === "string" ? body.itemId : null;
  // An absent label is the whole-question slot, which is stored as the empty
  // string -- see answerSlots() and the migration's note on why it is not null.
  const partLabel = typeof body.partLabel === "string" ? body.partLabel : "";
  const answerLatex = typeof body.answerLatex === "string" ? body.answerLatex : null;

  if (!itemId || answerLatex === null) {
    return NextResponse.json({ error: "itemId and answerLatex are required" }, { status: 400 });
  }
  if (answerLatex.length > MAX_ANSWER_CHARS) {
    return NextResponse.json(
      { error: `An answer cannot be longer than ${MAX_ANSWER_CHARS} characters.` },
      { status: 413 }
    );
  }

  // Upsert on the natural key, so the first save inserts and every later one
  // revises the same row. Without the conflict target this would violate the
  // unique constraint on the second keystroke of every answer.
  const { error } = await supabase.from("practice_answers").upsert(
    {
      practice_set_item_id: itemId,
      profile_id: user.id,
      part_label: partLabel,
      answer_latex: answerLatex,
    },
    { onConflict: "practice_set_item_id,profile_id,part_label" }
  );

  if (error) {
    // RLS refuses a write against an item whose set is not released, or one
    // belonging to a course the student is not on. That is a 403, not a 500.
    const denied = error.code === "42501" || /row-level security/i.test(error.message);
    return NextResponse.json(
      { error: denied ? "You cannot save an answer to this question." : error.message },
      { status: denied ? 403 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
