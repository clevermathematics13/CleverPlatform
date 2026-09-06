import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher, type ApiAuthOk } from "@/lib/auth";
import {
  computeExpansionCaps,
  fractionBoxToPoints,
  normalizeFractionBox,
  type AnchorRegion,
  type PageSizePt,
} from "@/lib/evidence-crops";

export const maxDuration = 60;

/**
 * PUT    -> save one part's region on the active layout (upsert)
 * DELETE -> remove one part's region
 *
 * Regions arrive as fractions of a reference page, the same shape the box
 * editor emits, and are stored as absolute points to match na_anchors and the
 * CV service's AnchorIn. The conversion uses the layout's recorded
 * reference_page_sizes rather than re-reading the PDF: those sizes are what
 * every later crop will be scaled against, so measuring against anything else
 * would put the stored geometry and its own frame of reference out of step.
 *
 * Every write recomputes expand_max_* across the whole layout. A region's
 * growth cap is the top of the nearest region below it, so adding or moving
 * one changes its neighbour's cap too -- doing it per-row is how the NA side
 * ended up propagating a neighbour's measurement error into a cap by hand.
 */

interface LayoutRow {
  id: string;
  anchors_locked: boolean;
  page_count: number;
  reference_page_sizes: PageSizePt[];
}

interface AnchorRow {
  id: string;
  question_number: number;
  part_label: string | null;
  page_index: number;
  x0_pt: number;
  y0_pt: number;
  x1_pt: number;
  y1_pt: number;
}

async function loadActiveLayout(supabase: ApiAuthOk["supabase"], testId: string) {
  const { data } = await supabase
    .from("test_paper_layouts")
    .select("id, anchors_locked, page_count, reference_page_sizes")
    .eq("test_id", testId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as LayoutRow | null) ?? null;
}

/** Rewrites every expand_max_* on the layout from the current region set. */
async function refreshExpansionCaps(
  supabase: ApiAuthOk["supabase"],
  layout: LayoutRow
): Promise<string | null> {
  const { data, error } = await supabase
    .from("test_item_anchors")
    .select("id, question_number, part_label, page_index, x0_pt, y0_pt, x1_pt, y1_pt")
    .eq("layout_id", layout.id);
  if (error) return error.message;

  const rows = (data ?? []) as AnchorRow[];
  const regions: AnchorRegion[] = rows.map((r) => ({
    pageIndex: r.page_index,
    x0Pt: Number(r.x0_pt),
    y0Pt: Number(r.y0_pt),
    x1Pt: Number(r.x1_pt),
    y1Pt: Number(r.y1_pt),
  }));
  const caps = computeExpansionCaps(regions, layout.reference_page_sizes ?? []);

  for (let i = 0; i < rows.length; i++) {
    const { error: updateErr } = await supabase
      .from("test_item_anchors")
      .update({
        expand_max_x1_pt: caps[i].expandMaxX1Pt,
        expand_max_y1_pt: caps[i].expandMaxY1Pt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rows[i].id);
    if (updateErr) return updateErr.message;
  }
  return null;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionNumber = body.questionNumber;
  if (typeof questionNumber !== "number" || !Number.isInteger(questionNumber)) {
    return NextResponse.json({ error: "questionNumber must be a whole number" }, { status: 400 });
  }
  const partLabel =
    typeof body.partLabel === "string" && body.partLabel.trim() ? body.partLabel.trim() : null;
  const sortOrder = typeof body.sortOrder === "number" ? body.sortOrder : null;

  // `page` here is 1-indexed like everywhere the box editor is used; it is
  // converted to the 0-indexed page_index the CV service wants on the way in.
  const normalized = normalizeFractionBox(body);
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const box = normalized.box;

  const layout = await loadActiveLayout(supabase, testId);
  if (!layout) {
    return NextResponse.json({ error: "This assessment has no paper layout yet" }, { status: 404 });
  }
  if (layout.anchors_locked) {
    return NextResponse.json(
      { error: "This layout is locked. Unlock it before changing regions." },
      { status: 409 }
    );
  }
  if (box.page > layout.page_count) {
    return NextResponse.json(
      { error: `Page ${box.page} is out of range for this ${layout.page_count}-page paper` },
      { status: 422 }
    );
  }

  const pageSize = layout.reference_page_sizes?.[box.page - 1];
  if (!pageSize) {
    return NextResponse.json({ error: "This layout has no recorded size for that page" }, { status: 422 });
  }
  const points = fractionBoxToPoints(box, pageSize);

  // Deliberately a lookup then an insert-or-update rather than .upsert().
  // Uniqueness here is enforced by an EXPRESSION index -- (layout_id,
  // question_number, coalesce(part_label, '')) -- because NULLs are distinct
  // in Postgres and a plain constraint would let a part-less question
  // duplicate. PostgREST's onConflict takes column names and cannot name an
  // expression index, so an upsert would have no usable conflict target.
  const geometry = {
    page_index: box.page - 1,
    x0_pt: points.x0Pt,
    y0_pt: points.y0Pt,
    x1_pt: points.x1Pt,
    y1_pt: points.y1Pt,
    sort_order: sortOrder,
    source: "manual_draw",
    updated_at: new Date().toISOString(),
  };

  let existingQuery = supabase
    .from("test_item_anchors")
    .select("id")
    .eq("layout_id", layout.id)
    .eq("question_number", questionNumber);
  existingQuery =
    partLabel === null ? existingQuery.is("part_label", null) : existingQuery.eq("part_label", partLabel);
  const { data: existing, error: existingErr } = await existingQuery.maybeSingle();
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

  const write = existing
    ? await supabase.from("test_item_anchors").update(geometry).eq("id", existing.id)
    : await supabase
        .from("test_item_anchors")
        .insert({ layout_id: layout.id, question_number: questionNumber, part_label: partLabel, ...geometry });
  if (write.error) return NextResponse.json({ error: write.error.message }, { status: 500 });

  const capsErr = await refreshExpansionCaps(supabase, layout);
  if (capsErr) return NextResponse.json({ error: capsErr }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const questionNumber = Number(request.nextUrl.searchParams.get("questionNumber"));
  if (!Number.isInteger(questionNumber)) {
    return NextResponse.json({ error: "questionNumber is required" }, { status: 400 });
  }
  const partLabelParam = request.nextUrl.searchParams.get("partLabel");
  const partLabel = partLabelParam && partLabelParam.trim() ? partLabelParam.trim() : null;

  const layout = await loadActiveLayout(supabase, testId);
  if (!layout) return NextResponse.json({ error: "This assessment has no paper layout yet" }, { status: 404 });
  if (layout.anchors_locked) {
    return NextResponse.json(
      { error: "This layout is locked. Unlock it before changing regions." },
      { status: 409 }
    );
  }

  let query = supabase
    .from("test_item_anchors")
    .delete()
    .eq("layout_id", layout.id)
    .eq("question_number", questionNumber);
  query = partLabel === null ? query.is("part_label", null) : query.eq("part_label", partLabel);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const capsErr = await refreshExpansionCaps(supabase, layout);
  if (capsErr) return NextResponse.json({ error: capsErr }, { status: 500 });

  return NextResponse.json({ ok: true });
}
