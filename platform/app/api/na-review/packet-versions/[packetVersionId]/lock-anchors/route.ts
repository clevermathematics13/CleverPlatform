import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  extractGradableQuestions,
  groupAnchorsByBase,
  validateAnchorLock,
  buildRubricItemRows,
  type AnchorForLock,
} from "@/lib/na-anchor-locking";

const SCAN_BUCKET = "exam-scans";

/**
 * POST /api/na-review/packet-versions/[packetVersionId]/lock-anchors
 *
 * The gate na_packet_versions.anchors_locked was missing entirely: nothing
 * in the codebase had ever set it to true except a one-off SQL statement
 * run by hand for A.1 ("Sixty Times a Person"). That packet then shipped
 * and was graded for nine days carrying five real bugs before any of them
 * were found -- sub-part marks summing to more than the question's total,
 * a question (Q26(a), the plotting grid) with zero anchors at all, two
 * competing answer keys with no defined precedence, the assessor never
 * seeing the question text, and no master PDF retained. This route is the
 * fix: it is now the ONLY place anchors_locked is ever set, and it refuses
 * to set it unless every one of those problems is checked for first. See
 * lib/na-anchor-locking.ts for the validation logic and why the positional
 * mapping against nuanced_analyses.parts[] is trustworthy.
 *
 * Idempotent: a packet that's already locked returns alreadyLocked without
 * touching anything -- re-running this must never silently overwrite a
 * rubric item a teacher has since hand-edited.
 *
 * Body: { masterPdfBase64?: string } -- required only if
 * master_pdf_storage_path is still null for this packet version. Supplying
 * it here (rather than requiring a separate upload step first) is what
 * actually prevents the "no master PDF" bug: locking anchors and losing
 * the ability to ever retain the master become the same atomic gate,
 * instead of two steps a future session can forget to do in order.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packetVersionId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetVersionId } = await params;

  const body = await request.json().catch(() => ({}));
  const masterPdfBase64 = typeof body.masterPdfBase64 === "string" ? body.masterPdfBase64 : null;

  const { data: packetVersion, error: pvErr } = await supabase
    .from("na_packet_versions")
    .select("id, nuanced_analysis_id, master_pdf_storage_path, anchors_locked")
    .eq("id", packetVersionId)
    .maybeSingle();

  if (pvErr) return NextResponse.json({ error: pvErr.message }, { status: 500 });
  if (!packetVersion) return NextResponse.json({ error: "Packet version not found" }, { status: 404 });

  if (packetVersion.anchors_locked) {
    return NextResponse.json({ ok: true, alreadyLocked: true });
  }

  const { data: nuancedAnalysis, error: naErr } = await supabase
    .from("nuanced_analyses")
    .select("id, parts")
    .eq("id", packetVersion.nuanced_analysis_id)
    .maybeSingle();

  if (naErr) return NextResponse.json({ error: naErr.message }, { status: 500 });
  if (!nuancedAnalysis) {
    return NextResponse.json({ error: "This packet version's nuanced analysis was not found" }, { status: 404 });
  }

  const { data: anchorRows, error: anchorsErr } = await supabase
    .from("na_anchors")
    .select("id, qid, base_qid, sort_order, marks_available, command_term")
    .eq("packet_version_id", packetVersionId)
    .order("sort_order");

  if (anchorsErr) return NextResponse.json({ error: anchorsErr.message }, { status: 500 });
  if (!anchorRows || anchorRows.length === 0) {
    return NextResponse.json(
      { error: "This packet version has zero anchors. Nothing to lock." },
      { status: 422 }
    );
  }

  const anchors: AnchorForLock[] = anchorRows.map((a) => ({
    id: a.id,
    qid: a.qid,
    baseQid: a.base_qid,
    sortOrder: a.sort_order,
    marksAvailable: a.marks_available === null ? null : Number(a.marks_available),
    commandTerm: a.command_term,
  }));

  const anchorGroups = groupAnchorsByBase(anchors);
  const gradableQuestions = extractGradableQuestions(nuancedAnalysis.parts);
  const validation = validateAnchorLock(anchorGroups, gradableQuestions);

  // (a) mark-split check and (b) coverage check -- FAIL the lock, name the
  // exact questions and numbers, before anything is written.
  if (validation.coverageProblems.length > 0 || validation.markSplitMismatches.length > 0) {
    return NextResponse.json(
      {
        error: "Anchor validation failed -- anchors were NOT locked.",
        markSplitMismatches: validation.markSplitMismatches.map((m) => ({
          baseQid: m.baseQid,
          anchorsSum: m.anchorSum,
          shouldBe: m.authoritativeMarks,
          detail: `${m.baseQid}: anchors sum to ${m.anchorSum}, but parts[] question #${m.partsOrdinal} is worth ${m.authoritativeMarks}.`,
        })),
        coverageProblems: validation.coverageProblems.map((p) =>
          p.kind === "missing_anchor"
            ? {
                kind: p.kind,
                detail: `parts[] question #${p.partsOrdinal} ("${p.promptSnippet}...") has no anchor at all.`,
              }
            : {
                kind: p.kind,
                baseQid: p.baseQid,
                detail: `Anchor base "${p.baseQid}" has no corresponding gradable question in parts[] at its position.`,
              }
        ),
      },
      { status: 422 }
    );
  }

  // (c) master PDF retention -- refuse to lock a packet that will end up
  // with no way to ever re-derive anchor geometry, exactly the hole A.1
  // fell into.
  let masterPdfStoragePath = packetVersion.master_pdf_storage_path as string | null;
  if (!masterPdfStoragePath) {
    if (!masterPdfBase64) {
      return NextResponse.json(
        {
          error:
            "master_pdf_storage_path is null for this packet version and no masterPdfBase64 was supplied. " +
            "Pass the master PDF (base64) in the request body so it can be retained before anchors are locked.",
        },
        { status: 422 }
      );
    }
    const path = `na-masters/${packetVersionId}/master.pdf`;
    const buffer = Buffer.from(masterPdfBase64, "base64");
    const { error: uploadErr } = await supabase.storage
      .from(SCAN_BUCKET)
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (uploadErr) {
      return NextResponse.json(
        { error: `Failed to upload master PDF: ${uploadErr.message}` },
        { status: 500 }
      );
    }
    masterPdfStoragePath = path;
  }

  // (d) na_rubric_items populated DIRECTLY here, one row per anchor,
  // sourced from parts[].questions[] (the single authoritative source --
  // never teacher_companion.answerSketches, a terser duplicate that
  // caused a real mismark). Upsert rather than insert: re-running this
  // route on a packet that already has rubric items (e.g. after adding a
  // missed anchor) must update them in place, not duplicate or fail.
  const rubricRows = buildRubricItemRows(validation.pairs).map((row) => ({
    nuanced_analysis_id: packetVersion.nuanced_analysis_id,
    ...row,
  }));

  const { data: upsertedRubricItems, error: rubricErr } = await supabase
    .from("na_rubric_items")
    .upsert(rubricRows, { onConflict: "nuanced_analysis_id,qid" })
    .select("id, qid");

  if (rubricErr) return NextResponse.json({ error: rubricErr.message }, { status: 500 });

  const rubricIdByQid = new Map((upsertedRubricItems ?? []).map((r) => [r.qid, r.id]));
  for (const anchor of anchorRows) {
    const rubricItemId = rubricIdByQid.get(anchor.qid);
    if (!rubricItemId) continue;
    const { error: linkErr } = await supabase
      .from("na_anchors")
      .update({ rubric_item_id: rubricItemId })
      .eq("id", anchor.id);
    if (linkErr) {
      return NextResponse.json(
        { error: `Rubric items were written, but linking anchor ${anchor.qid} failed: ${linkErr.message}` },
        { status: 500 }
      );
    }
  }

  const { error: lockErr } = await supabase
    .from("na_packet_versions")
    .update({ anchors_locked: true, master_pdf_storage_path: masterPdfStoragePath })
    .eq("id", packetVersionId);

  if (lockErr) return NextResponse.json({ error: lockErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    anchorsLocked: true,
    rubricItemsWritten: rubricRows.length,
    masterPdfStoragePath,
  });
}
