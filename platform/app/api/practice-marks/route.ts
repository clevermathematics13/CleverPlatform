import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { isVerdict } from "@/lib/practice-marking";

/**
 * Recording a teacher's read of one practice answer. Teachers only.
 *
 * PUT saves or revises a mark; DELETE takes it back, for a verdict clicked by
 * mistake. There is deliberately no score in either direction -- see the
 * migration for why practice marking has three states and no number.
 *
 * The mark is keyed on the ANSWER, so a teacher can only mark work that
 * exists. There is no way to leave a verdict against a student who has not
 * written anything, which is the right shape: silence is not an answer to
 * judge, it is a student to chase.
 */

/** Long enough for a sentence of feedback, short enough not to be an essay. */
const MAX_NOTE_CHARS = 2000;

export async function PUT(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = (await request.json()) as {
    answerId?: unknown;
    verdict?: unknown;
    note?: unknown;
  };

  const answerId = typeof body.answerId === "string" ? body.answerId : null;
  if (!answerId) {
    return NextResponse.json({ error: "answerId is required" }, { status: 400 });
  }
  if (!isVerdict(body.verdict)) {
    return NextResponse.json(
      { error: "verdict must be one of correct, almost, not_yet" },
      { status: 400 }
    );
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > MAX_NOTE_CHARS) {
    return NextResponse.json(
      { error: `A note cannot be longer than ${MAX_NOTE_CHARS} characters.` },
      { status: 413 }
    );
  }

  // Upsert on the answer, so clicking a different verdict revises the same row
  // rather than colliding with the unique constraint.
  const { data, error } = await supabase
    .from("practice_answer_marks")
    .upsert(
      {
        practice_answer_id: answerId,
        verdict: body.verdict,
        note: note || null,
        marked_by: user.id,
      },
      { onConflict: "practice_answer_id" }
    )
    .select("updated_at")
    .single();

  if (error) {
    // A foreign-key failure here means the answer was deleted while the screen
    // was open, which is a stale page rather than a server fault.
    const missing = error.code === "23503";
    return NextResponse.json(
      { error: missing ? "That answer no longer exists. Reload the page." : error.message },
      { status: missing ? 409 : 500 }
    );
  }

  return NextResponse.json({ ok: true, markUpdatedAt: data.updated_at });
}

export async function DELETE(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const answerId = request.nextUrl.searchParams.get("answerId");
  if (!answerId) {
    return NextResponse.json({ error: "answerId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("practice_answer_marks")
    .delete()
    .eq("practice_answer_id", answerId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
