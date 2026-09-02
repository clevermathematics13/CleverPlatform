import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";

interface EvidenceBox {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * GET /api/tests/[id]/ai-grade/results/[resultId]/page-image
 *
 * Renders the FULL scanned page a result's evidence crop was taken from,
 * with that crop's region outlined in red, so a teacher can check the crop
 * against its surrounding context (e.g. is this really part (b), or did the
 * model crop the wrong line of a stacked a)/b)/c) list) without re-grading.
 * Reuses the same Railway CV service /page-image endpoint the NA-review
 * "follow the arrow" second pass already calls (see
 * app/api/na-review/response-crops/[cropId]/assess/route.ts) -- this is the
 * first place it's exposed directly to a teacher rather than fed straight
 * back into a model call.
 *
 * Not persisted anywhere: rendered fresh from the run's source PDF on every
 * request, since it's cheap and there's no other reason to store a second
 * copy of a page that's already sitting in the scan.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; resultId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { id: testId, resultId } = await params;

  const { data: result, error: resultErr } = await supabase
    .from("ai_grade_results")
    .select("id, run_id, evidence_box")
    .eq("id", resultId)
    .maybeSingle();
  if (resultErr) return NextResponse.json({ error: resultErr.message }, { status: 500 });
  if (!result) return NextResponse.json({ error: "Result not found" }, { status: 404 });

  const box = result.evidence_box as EvidenceBox | null;
  if (!box) {
    return NextResponse.json({ error: "This part has no located region to show in context" }, { status: 404 });
  }

  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, source_storage_path")
    .eq("id", result.run_id)
    .maybeSingle();
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  if (!run || run.test_id !== testId) {
    return NextResponse.json({ error: "This result does not belong to the specified assessment" }, { status: 400 });
  }
  if (!run.source_storage_path) {
    return NextResponse.json({ error: "No source scan on file for this run" }, { status: 404 });
  }

  const serviceUrl = process.env.GRAPH_LAB_CV_SERVICE_URL;
  if (!serviceUrl) {
    return NextResponse.json({ error: "Full-page view is not configured on this deployment" }, { status: 503 });
  }

  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(run.source_storage_path);
  if (dlErr || !pdfFile) {
    return NextResponse.json({ error: dlErr?.message ?? "Could not read the source scan" }, { status: 500 });
  }
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  let pageWidthPt: number;
  let pageHeightPt: number;
  try {
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
    const page = pdfDoc.getPages()[box.page - 1];
    if (!page) return NextResponse.json({ error: "Page out of range for this scan" }, { status: 422 });
    pageWidthPt = page.getWidth();
    pageHeightPt = page.getHeight();
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the source scan: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const serviceBase = serviceUrl.trim().replace(/\/$/, "");
  const target = `${/^https?:\/\//i.test(serviceBase) ? serviceBase : `https://${serviceBase}`}/page-image`;
  const cvSecret = process.env.CV_SERVICE_SECRET ?? "";

  try {
    const upstream = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(cvSecret ? { "X-CV-Secret": cvSecret } : {}),
      },
      body: JSON.stringify({
        studentPdfBase64: pdfBase64,
        pageIndex: box.page - 1,
        rotationHint: 0,
        highlightBox: {
          x0Pt: box.x0 * pageWidthPt,
          y0Pt: box.y0 * pageHeightPt,
          x1Pt: box.x1 * pageWidthPt,
          y1Pt: box.y1 * pageHeightPt,
        },
      }),
    });
    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => ({}))) as { error?: string };
      return NextResponse.json({ error: body.error ?? "Full-page render failed" }, { status: 502 });
    }
    const body = (await upstream.json()) as { imageBase64?: string };
    if (!body.imageBase64) {
      return NextResponse.json({ error: "Full-page render failed" }, { status: 502 });
    }
    return NextResponse.json({ imageBase64: body.imageBase64 });
  } catch (e) {
    return NextResponse.json(
      { error: `Full-page render failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}
