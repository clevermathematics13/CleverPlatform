/**
 * The active paper layout and its expansion caps, for every route that writes
 * regions to it.
 *
 * These used to live inside app/api/tests/[id]/paper-layout/anchors/route.ts.
 * The propose route (regions estimated from the class's marker boxes) writes
 * regions too, and a second copy of "recompute every cap after any write" is
 * how the NA side ended up propagating a neighbour's measurement error into a
 * cap by hand -- so there is one copy, here.
 *
 * Server-only: talks to the database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeExpansionCaps, type AnchorRegion, type PageSizePt } from "./evidence-crops";

export interface ActiveLayoutRow {
  id: string;
  anchors_locked: boolean;
  page_count: number;
  reference_page_sizes: PageSizePt[];
}

interface AnchorGeometryRow {
  id: string;
  question_number: number;
  part_label: string | null;
  page_index: number;
  x0_pt: number;
  y0_pt: number;
  x1_pt: number;
  y1_pt: number;
}

/** The layout new grading runs would use once locked, or null when there is none. */
export async function loadActiveLayout(
  supabase: SupabaseClient,
  testId: string
): Promise<ActiveLayoutRow | null> {
  const { data } = await supabase
    .from("test_paper_layouts")
    .select("id, anchors_locked, page_count, reference_page_sizes")
    .eq("test_id", testId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as ActiveLayoutRow | null) ?? null;
}

/**
 * Rewrites every expand_max_* on the layout from the current region set.
 *
 * A region's growth cap is the top of the nearest region below it, so adding
 * or moving one changes its neighbour's cap too; every write recomputes the
 * whole layout rather than the one row. Returns an error message, or null.
 */
export async function refreshExpansionCaps(
  supabase: SupabaseClient,
  layout: ActiveLayoutRow
): Promise<string | null> {
  const { data, error } = await supabase
    .from("test_item_anchors")
    .select("id, question_number, part_label, page_index, x0_pt, y0_pt, x1_pt, y1_pt")
    .eq("layout_id", layout.id);
  if (error) return error.message;

  const rows = (data ?? []) as AnchorGeometryRow[];
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
