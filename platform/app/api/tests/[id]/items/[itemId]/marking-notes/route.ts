import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * PUT /api/tests/[id]/items/[itemId]/marking-notes
 * Body: { notes: string | null }
 *
 * Saves the teacher's marking notes for one part of one paper
 * (test_items.marking_notes). The AI marker reads them after the part's mark
 * scheme on every mark started after the save -- a re-mark, the overnight
 * queue, the eval script -- so a ruling made while reviewing one student
 * settles the same judgement call for every other student on the paper.
 * A mark already queued overnight was built before the save and does not
 * pick the note up; the next one does.
 *
 * Blank means "no notes", not an empty string, so the prompt block is omitted
 * rather than printed empty.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId, itemId } = await params;

  let body: { notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.notes !== null && body.notes !== undefined && typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
  }
  const notes = typeof body.notes === "string" && body.notes.trim() !== "" ? body.notes.trim() : null;
  if (notes && notes.length > 4000) {
    return NextResponse.json({ error: "notes must be 4000 characters or fewer" }, { status: 400 });
  }

  const { data: item, error: itemErr } = await supabase
    .from("test_items")
    .select("id, test_id")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });
  if (!item || item.test_id !== testId) {
    return NextResponse.json({ error: "This part does not belong to the specified assessment" }, { status: 404 });
  }

  const { error: updateErr } = await supabase
    .from("test_items")
    .update({ marking_notes: notes })
    .eq("id", itemId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ itemId, marking_notes: notes });
}
