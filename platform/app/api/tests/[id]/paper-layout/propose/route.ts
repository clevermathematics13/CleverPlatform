import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { assembleMarkScheme } from "@/lib/ai-grading";
import { latestRunPerSubject } from "@/lib/ai-grade-review";
import { fractionBoxToPoints, type EvidenceBox } from "@/lib/evidence-crops";
import { fetchAllRows } from "@/lib/na-scanning";
import {
  MARKER_CONSENSUS_SOURCE,
  proposeLayoutFromObservations,
  type ConsensusObservation,
} from "@/lib/paper-layout-consensus";
import { loadActiveLayout, refreshExpansionCaps } from "@/lib/paper-layout-server";

export const maxDuration = 60;

/**
 * POST /api/tests/[id]/paper-layout/propose
 *
 * Fills the active, UNLOCKED layout with one region per part, estimated from
 * the class's marker boxes (lib/paper-layout-consensus.ts): the newest
 * complete run per student, every part's box (the marker's own where the row
 * has it, else the stored one), median top per part, bottom at the next
 * part's top on the same page. Anchor-cut rows are left out of the
 * observations -- a region that came from a layout is not evidence for one.
 *
 * NEVER OVERWRITES A REGION IT DID NOT PROPOSE. A region a teacher drew
 * ('manual_draw') or one read out of a generated paper ('generated') stays
 * and is reported as kept; only source 'marker_consensus' rows are replaced,
 * and a stale one for a part no longer proposed is removed. The layout stays
 * unlocked: nothing here cuts a crop until the teacher has looked and locked.
 *
 * Every write ends by recomputing expand_max_* across the whole layout, the
 * same as the anchors route, because a region's growth cap is its neighbour's
 * top.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const layout = await loadActiveLayout(supabase, testId);
  if (!layout) {
    return NextResponse.json(
      { error: "This assessment has no paper layout yet. Choose a reference scan first." },
      { status: 404 }
    );
  }
  if (layout.anchors_locked) {
    return NextResponse.json(
      { error: "This layout is locked. Unlock it before proposing regions." },
      { status: 409 }
    );
  }

  // The part list the grader works from, in paper order: sortOrder is the
  // index, exactly what the editor writes when a region is drawn by hand.
  let unitsByKey: Map<string, { questionNumber: number; partLabel: string | null; sortOrder: number }>;
  try {
    const { units } = await assembleMarkScheme(supabase, testId);
    unitsByKey = new Map(
      units.map((u, i) => [
        `${u.questionNumber}|${u.partLabel || ""}`,
        { questionNumber: u.questionNumber, partLabel: u.partLabel || null, sortOrder: i },
      ])
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // -- The class: newest complete run per student ---------------------------
  let runs: { id: string; student_id: string | null; invited_student_id: string | null; created_at: string }[];
  try {
    runs = latestRunPerSubject(
      await fetchAllRows<{ id: string; student_id: string | null; invited_student_id: string | null; created_at: string }>(
        (from, to) =>
          supabase
            .from("ai_grade_runs")
            .select("id, student_id, invited_student_id, created_at")
            .eq("test_id", testId)
            .eq("status", "complete")
            .not("source_storage_path", "is", null)
            .order("created_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to)
      )
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (runs.length === 0) {
    return NextResponse.json(
      { error: "No graded scans on this assessment yet. Mark at least one student first." },
      { status: 422 }
    );
  }

  // -- Their boxes ------------------------------------------------------------
  interface ResultRow {
    run_id: string;
    test_item_id: string;
    evidence_box: unknown;
    evidence_box_source: string | null;
    evidence_box_reported: unknown;
  }
  const results: ResultRow[] = [];
  try {
    const runIds = runs.map((r) => r.id);
    for (let i = 0; i < runIds.length; i += 100) {
      const chunk = runIds.slice(i, i + 100);
      results.push(
        ...(await fetchAllRows<ResultRow>((from, to) =>
          supabase
            .from("ai_grade_results")
            .select("run_id, test_item_id, evidence_box, evidence_box_source, evidence_box_reported")
            .in("run_id", chunk)
            .order("id", { ascending: true })
            .range(from, to)
        ))
      );
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const { data: items, error: itemsErr } = await supabase
    .from("test_items")
    .select("id, question_number, part_label")
    .eq("test_id", testId);
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));

  const asBox = (value: unknown): EvidenceBox | null => {
    if (!value || typeof value !== "object") return null;
    const b = value as Record<string, unknown>;
    const nums = [b.page, b.x0, b.y0, b.x1, b.y1];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { page: b.page as number, x0: b.x0 as number, y0: b.y0 as number, x1: b.x1 as number, y1: b.y1 as number };
  };

  const observations: ConsensusObservation[] = [];
  for (const r of results) {
    if (r.evidence_box_source === "anchor") continue;
    const item = itemById.get(r.test_item_id);
    if (!item) continue;
    const unit = unitsByKey.get(`${item.question_number}|${(item.part_label as string | null) || ""}`);
    if (!unit) continue;
    const reported = asBox(r.evidence_box_reported);
    const box = reported ?? asBox(r.evidence_box);
    if (!box) continue;
    observations.push({
      questionNumber: unit.questionNumber,
      partLabel: unit.partLabel,
      sortOrder: unit.sortOrder,
      box,
      kind: reported ? "reported" : "stored",
    });
  }

  const proposal = proposeLayoutFromObservations(observations, layout.page_count);
  const warnings = [...proposal.warnings];

  // -- Write, keeping every region that is not ours ---------------------------
  const { data: existingRows, error: existingErr } = await supabase
    .from("test_item_anchors")
    .select("id, question_number, part_label, source")
    .eq("layout_id", layout.id);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  const existingByKey = new Map(
    (existingRows ?? []).map((a) => [`${a.question_number}|${(a.part_label as string | null) ?? ""}`, a])
  );

  let proposed = 0;
  let kept = 0;
  let skipped = 0;
  const proposedKeys = new Set<string>();
  for (const region of proposal.regions) {
    const key = `${region.questionNumber}|${region.partLabel ?? ""}`;
    const label = `Q${region.questionNumber}${region.partLabel ? `(${region.partLabel})` : ""}`;
    const existing = existingByKey.get(key);
    if (existing && existing.source !== MARKER_CONSENSUS_SOURCE) {
      kept++;
      proposedKeys.add(key);
      warnings.push(`${label}: kept the region already drawn for it.`);
      continue;
    }
    const pageSize = layout.reference_page_sizes?.[region.pageIndex];
    if (!pageSize) {
      skipped++;
      warnings.push(`${label}: the layout has no recorded size for page ${region.pageIndex + 1}, so its region was not written.`);
      continue;
    }
    const points = fractionBoxToPoints(
      { page: region.pageIndex + 1, x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 },
      pageSize
    );
    const geometry = {
      page_index: region.pageIndex,
      x0_pt: points.x0Pt,
      y0_pt: points.y0Pt,
      x1_pt: points.x1Pt,
      y1_pt: points.y1Pt,
      sort_order: region.sortOrder,
      source: MARKER_CONSENSUS_SOURCE,
      updated_at: new Date().toISOString(),
    };
    // Lookup then write, as the anchors route does: uniqueness is an
    // expression index PostgREST's upsert cannot name.
    const write = existing
      ? await supabase.from("test_item_anchors").update(geometry).eq("id", existing.id)
      : await supabase.from("test_item_anchors").insert({
          layout_id: layout.id,
          question_number: region.questionNumber,
          part_label: region.partLabel,
          ...geometry,
        });
    if (write.error) return NextResponse.json({ error: write.error.message }, { status: 500 });
    proposed++;
    proposedKeys.add(key);
  }

  // A proposal of ours for a part no longer proposed is stale.
  for (const [key, row] of existingByKey) {
    if (row.source !== MARKER_CONSENSUS_SOURCE || proposedKeys.has(key)) continue;
    const { error: delErr } = await supabase.from("test_item_anchors").delete().eq("id", row.id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const capsErr = await refreshExpansionCaps(supabase, layout);
  if (capsErr) return NextResponse.json({ error: capsErr }, { status: 500 });

  return NextResponse.json({
    ok: true,
    proposed,
    kept,
    skipped,
    students: runs.length,
    observations: observations.length,
    warnings,
  });
}
