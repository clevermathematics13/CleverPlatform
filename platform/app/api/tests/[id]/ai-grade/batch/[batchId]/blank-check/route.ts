import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";
import { applyBlankPages, detectBlankPages } from "@/lib/blank-pages";

export const maxDuration = 120;

/**
 * POST /api/tests/[id]/ai-grade/batch/[batchId]/blank-check
 * Body: { pages?: number[] }   -- defaults to the batch's unassigned pages
 *
 * Checks each requested page of an already-segmented batch for being blank
 * (lib/blank-pages.ts) and records the confirmed ones on the batch row:
 * they join blank_pages and leave unassigned_pages, so the review UI stops
 * asking for a row they will never need. New uploads get this check inside
 * segmentation itself; this route exists for batches segmented before that
 * was true, and for a teacher who edits page ranges and wants a re-check.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId, batchId } = await params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on this deployment" }, { status: 500 });
  }

  let body: { pages?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means "the unassigned pages".
  }

  const { data: batch, error: batchErr } = await supabase
    .from("ai_grade_batches")
    .select("id, test_id, status, source_storage_path, page_count, unassigned_pages, blank_pages")
    .eq("id", batchId)
    .maybeSingle();
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (batch.test_id !== testId) {
    return NextResponse.json({ error: "This batch does not belong to the specified assessment" }, { status: 400 });
  }

  const pageCount = batch.page_count ?? 0;
  const alreadyBlank = new Set((batch.blank_pages as number[] | null) ?? []);
  const unassigned = ((batch.unassigned_pages as number[] | null) ?? []).filter((p) => !alreadyBlank.has(p));
  const requested = Array.isArray(body.pages)
    ? body.pages.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= pageCount)
    : unassigned;
  const pages = [...new Set(requested)].filter((p) => !alreadyBlank.has(p)).sort((a, b) => a - b);

  if (pages.length === 0) {
    return NextResponse.json({ checked: [], blankPages: [...alreadyBlank].sort((a, b) => a - b), unassignedPages: unassigned });
  }
  if (pages.length > 20) {
    return NextResponse.json({ error: "At most 20 pages can be checked in one request" }, { status: 400 });
  }

  const { data: sourceFile, error: dlErr } = await supabase.storage.from(SCAN_BUCKET).download(batch.source_storage_path);
  if (dlErr || !sourceFile) {
    return NextResponse.json({ error: `Could not read the batch scan: ${dlErr?.message ?? "not found"}` }, { status: 500 });
  }
  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(Buffer.from(await sourceFile.arrayBuffer()), { updateMetadata: false });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not open the batch PDF: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const checked = await detectBlankPages({ anthropic, supabase, sourceDoc, pages, batchId: batch.id });
  const confirmed = checked.filter((c) => c.blank).map((c) => c.page);

  const next = applyBlankPages(
    {
      blankPages: [...alreadyBlank],
      unassignedPages: (batch.unassigned_pages as number[] | null) ?? [],
    },
    confirmed
  );

  if (confirmed.length > 0) {
    const { error: updateErr } = await supabase
      .from("ai_grade_batches")
      .update({ blank_pages: next.blankPages, unassigned_pages: next.unassignedPages })
      .eq("id", batch.id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ checked, blankPages: next.blankPages, unassignedPages: next.unassignedPages });
}
