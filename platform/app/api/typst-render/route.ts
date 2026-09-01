/**
 * /api/typst-render — POST
 * -----------------------------------------------------------------------------
 * Accepts an ActivityPayload JSON, validates the TemplateAst, compiles to PDF
 * via TypstRenderService, and streams the buffer back.
 *
 * Request body: ActivityPayload (see lib/typst-render.service.ts), plus an
 * optional top-level `persist` object:
 *
 *   persist: { nuancedAnalysisId: string; versionLabel: string }
 *
 * With `persist`, a successful render ALSO becomes a scan-ready packet
 * version in one atomic step: the master PDF is stored, an
 * na_packet_versions row is created, and one na_anchors row per question is
 * inserted straight from the compiler's own <na-anchor> metadata
 * (anchor_source 'typst_metadata'). This is the generation-time answer to
 * every geometry incident in docs/HANDOFF.md §5: nothing is measured off
 * paper after the fact, the master is never lost (A.1's never-stored master
 * blocked re-derivation for weeks), and each anchor spans the WHOLE question
 * block so inline annotations can never fall outside a crop. The response is
 * then JSON (version id, storage path, page/anchor counts) instead of the
 * PDF stream — the caller downloads the stored master from Storage.
 *
 * This route is intentionally separate from /api/pdf so the two rendering
 * paths (KaTeX → Puppeteer, and Typst native compiler) can co-exist during
 * transition.
 * -----------------------------------------------------------------------------
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { NA_SCAN_BUCKET } from "@/lib/na-scanning";
import {
  TypstRenderService,
  type ActivityPayload,
} from "@/lib/typst-render.service";

export const runtime = "nodejs";
// Compilation is fast (native addon), but keep headroom consistent with the
// other document-generation routes in this codebase.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Only authenticated teachers may render packets — this route previously had
  // no auth check at all, unlike every sibling generation/render route.
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const payload = body as ActivityPayload & {
    persist?: { nuancedAnalysisId?: string; versionLabel?: string };
  };

  if (!payload?.template || !payload?.content) {
    return NextResponse.json(
      { error: "Request must include both template and content fields." },
      { status: 422 }
    );
  }

  const persist = payload.persist;
  if (persist && (!persist.nuancedAnalysisId || !persist.versionLabel?.trim())) {
    return NextResponse.json(
      { error: "persist requires both nuancedAnalysisId and versionLabel." },
      { status: 422 }
    );
  }
  // The footer stamp is the printed version identity scanned pages carry --
  // when persisting, it must match the version row being created.
  if (persist) {
    payload.metadata = { ...payload.metadata, versionLabel: persist.versionLabel };
  }

  const result = await TypstRenderService.render(payload);

  if (!result.success) {
    // Log the compiler's own message server-side, not just the generic
    // headline. Previously only `error` ("Typst compilation failed.")
    // reached the teacher and NOTHING was logged here, so a failed export
    // left no way at all to find out which construct in the packet broke
    // the compile - the one piece of information needed to fix it.
    console.error(
      "[api/typst-render] render failed:",
      result.error,
      "| detail:",
      result.detail ?? "(none)",
    );
    return NextResponse.json(
      { error: result.error, detail: result.detail ?? null },
      { status: 422 }
    );
  }

  if (persist) {
    // A packet version without emitted anchors or a page count would be
    // right back in detect-geometry-from-paper territory -- refuse rather
    // than persist a half-usable version.
    if (!result.anchors?.length || !result.pageCount) {
      return NextResponse.json(
        {
          error:
            "Anchor emission did not produce usable geometry; the version was NOT created. Check server logs for the <na-anchor> query failure.",
        },
        { status: 500 }
      );
    }

    const { supabase, user } = auth;
    const slug = persist.versionLabel!.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const masterPath = `na-masters/${persist.nuancedAnalysisId}/${slug}-${Date.now()}.pdf`;

    const { error: upErr } = await supabase.storage
      .from(NA_SCAN_BUCKET)
      .upload(masterPath, result.pdfBuffer, { contentType: "application/pdf" });
    if (upErr) {
      return NextResponse.json(
        { error: `Could not store the master PDF: ${upErr.message}` },
        { status: 500 }
      );
    }

    const { data: version, error: verErr } = await supabase
      .from("na_packet_versions")
      .insert({
        nuanced_analysis_id: persist.nuancedAnalysisId,
        version_label: persist.versionLabel!.trim(),
        page_count: result.pageCount,
        master_pdf_storage_path: masterPath,
        anchor_source: "typst_metadata",
        anchors_locked: true,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (verErr || !version) {
      return NextResponse.json(
        { error: `Could not create the packet version: ${verErr?.message}` },
        { status: 500 }
      );
    }

    // Rubric fields come straight from the payload's own questions, in the
    // same flattened order the anchors were emitted in. question_answer is
    // populated when the draft carried answers; the review UI's rubric
    // editing covers the rest -- geometry, the part that used to be
    // detected off paper, is exact from the compiler.
    const questions = payload.content.sections.flatMap((s) => s.questions);
    const byQid = new Map(questions.map((q) => [`Q${q.globalNumber}`, q]));
    const anchorRows = result.anchors.map((a) => {
      const q = byQid.get(a.qid);
      return {
        packet_version_id: version.id,
        qid: a.qid,
        base_qid: a.qid,
        page_index: a.pageIndex,
        x0_pt: a.x0Pt,
        y0_pt: a.y0Pt,
        x1_pt: a.x1Pt,
        y1_pt: a.y1Pt,
        expand_max_x1_pt: a.expandMaxX1Pt,
        expand_max_y1_pt: a.expandMaxY1Pt,
        source: "typst_metadata",
        sort_order: a.sortOrder,
        marks_available: q?.marks ?? null,
        question_marks: q?.marks ?? null,
        question_text: q?.prompt ?? null,
        question_answer: q?.answer ?? null,
      };
    });
    const { error: anchorErr } = await supabase.from("na_anchors").insert(anchorRows);
    if (anchorErr) {
      return NextResponse.json(
        {
          error: `Packet version ${version.id} was created but anchors failed to insert: ${anchorErr.message}. Delete the version row and retry.`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      packetVersionId: version.id,
      masterPdfStoragePath: masterPath,
      pageCount: result.pageCount,
      anchorCount: anchorRows.length,
    });
  }

  // NextResponse body must be BodyInit — convert Node.js Buffer to Uint8Array.
  const pdfBytes = new Uint8Array(result.pdfBuffer);

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="nuanced-analysis.pdf"`,
      "Content-Length": String(pdfBytes.byteLength),
    },
  });
}
