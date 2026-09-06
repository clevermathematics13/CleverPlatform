import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher, type ApiAuthOk } from "@/lib/auth";
import { SCAN_BUCKET, assembleMarkScheme, unitLabel } from "@/lib/ai-grading";
import type { PageSizePt } from "@/lib/evidence-crops";

export const maxDuration = 60;

/**
 * The paper layout a test's evidence regions are drawn on.
 *
 * GET    -> the active layout (if any), its regions, the parts they should
 *           cover, and the scans available to use as a reference
 * POST   -> create a layout from one student's scan, replacing any active one
 * PATCH  -> lock or unlock the active layout
 *
 * WHY A REFERENCE SCAN RATHER THAN A BLANK MASTER: there is no blank paper
 * anywhere in this system. tests.paper_url is a free-text URL nobody fetches,
 * test_items carry no geometry, and /api/assignments/generate-pdf streams the
 * blank student paper to the browser without storing it. So the reference is
 * one representative student's already-uploaded scan -- the same substitution
 * the NA side sanctioned in
 * na-review/packet-scans/[packetScanId]/inspect-fillrects/route.ts. The column
 * reference_kind already allows 'master_upload' for the day a real master
 * exists.
 */

interface LayoutRow {
  id: string;
  test_id: string;
  label: string;
  reference_storage_path: string | null;
  reference_kind: string | null;
  reference_run_id: string | null;
  page_count: number;
  reference_page_sizes: PageSizePt[];
  anchors_locked: boolean;
  is_active: boolean;
  created_at: string;
}

async function loadParts(supabase: ApiAuthOk["supabase"], testId: string) {
  // assembleMarkScheme is the same part list the grader itself works from, so
  // the regions a teacher draws cannot drift out of step with the units that
  // get graded.
  const { units } = await assembleMarkScheme(supabase, testId);
  return units.map((u) => ({
    testItemId: u.testItemId,
    questionNumber: u.questionNumber,
    partLabel: u.partLabel,
    label: unitLabel(u),
    maxMarks: u.maxMarks,
  }));
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const { data: layout, error: layoutErr } = await supabase
    .from("test_paper_layouts")
    .select(
      "id, test_id, label, reference_storage_path, reference_kind, reference_run_id, page_count, reference_page_sizes, anchors_locked, is_active, created_at"
    )
    .eq("test_id", testId)
    .eq("is_active", true)
    .maybeSingle();
  if (layoutErr) return NextResponse.json({ error: layoutErr.message }, { status: 500 });

  let anchors: unknown[] = [];
  if (layout) {
    const { data, error } = await supabase
      .from("test_item_anchors")
      .select(
        "id, layout_id, question_number, part_label, page_index, x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt, sort_order, source"
      )
      .eq("layout_id", (layout as LayoutRow).id)
      .order("sort_order", { ascending: true, nullsFirst: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    anchors = data ?? [];
  }

  let parts;
  try {
    parts = await loadParts(supabase, testId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Candidate references: any complete run on this test that still has its
  // source scan. Newest first, one per student.
  const { data: runs } = await supabase
    .from("ai_grade_runs")
    .select("id, student_id, invited_student_id, source_storage_path, created_at")
    .eq("test_id", testId)
    .eq("status", "complete")
    .not("source_storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);

  return NextResponse.json({ layout: layout ?? null, anchors, parts, referenceCandidates: runs ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: testId } = await params;

  let body: { runId?: unknown; label?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.runId !== "string" || !body.runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "Paper layout";

  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, source_storage_path")
    .eq("id", body.runId)
    .maybeSingle();
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  if (!run || run.test_id !== testId) {
    return NextResponse.json({ error: "That scan does not belong to this assessment" }, { status: 400 });
  }
  if (!run.source_storage_path) {
    return NextResponse.json({ error: "That run has no scan on file" }, { status: 404 });
  }

  // Read the reference's real page geometry rather than assuming it. This is
  // the record that makes a differently sized or rescaled student scan
  // detectable later instead of silently mis-cropped -- the gap na_anchors
  // leaves open by storing points with no page box.
  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(run.source_storage_path);
  if (dlErr || !pdfFile) {
    return NextResponse.json({ error: dlErr?.message ?? "Could not read that scan" }, { status: 500 });
  }
  let pageCount: number;
  const pageSizes: PageSizePt[] = [];
  try {
    const pdfDoc = await PDFDocument.load(Buffer.from(await pdfFile.arrayBuffer()));
    pageCount = pdfDoc.getPageCount();
    for (const page of pdfDoc.getPages()) {
      pageSizes.push({ widthPt: page.getWidth(), heightPt: page.getHeight() });
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read that scan: ${e instanceof Error ? e.message : String(e)}` },
      { status: 422 }
    );
  }

  // Only one layout per test may be active (partial unique index), so stand
  // the previous one down first. It is kept, not deleted: runs graded under it
  // were cropped with its geometry.
  const { error: deactivateErr } = await supabase
    .from("test_paper_layouts")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("test_id", testId)
    .eq("is_active", true);
  if (deactivateErr) return NextResponse.json({ error: deactivateErr.message }, { status: 500 });

  const { data: created, error: insertErr } = await supabase
    .from("test_paper_layouts")
    .insert({
      test_id: testId,
      label,
      reference_storage_path: run.source_storage_path,
      reference_kind: "student_scan",
      reference_run_id: run.id,
      page_count: pageCount,
      reference_page_sizes: pageSizes,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (insertErr || !created) {
    return NextResponse.json({ error: insertErr?.message ?? "Could not create the layout" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, layoutId: created.id, pageCount });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  let body: { anchorsLocked?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.anchorsLocked !== "boolean") {
    return NextResponse.json({ error: "anchorsLocked must be true or false" }, { status: 400 });
  }

  const { error } = await supabase
    .from("test_paper_layouts")
    .update({ anchors_locked: body.anchorsLocked, updated_at: new Date().toISOString() })
    .eq("test_id", testId)
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, anchorsLocked: body.anchorsLocked });
}
