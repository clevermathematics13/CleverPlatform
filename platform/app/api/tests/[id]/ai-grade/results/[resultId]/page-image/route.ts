import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";
import { fractionBoxToPoints, type EvidenceBox } from "@/lib/evidence-crops";
import { cvServiceEndpoint, renderPageImage } from "@/lib/cv-crop-service";

export const maxDuration = 60;

/**
 * GET /api/tests/[id]/ai-grade/results/[resultId]/page-image[?page=N]
 *
 * Renders one full scanned page of the run this result came from, with the
 * result's evidence region outlined in red when that region is on the page
 * being rendered. A teacher uses it to check a crop against its surrounding
 * context (is this really part (b), or did the model crop the wrong line of a
 * stacked a)/b)/c) list?) and, via the box editor, to redraw the region when
 * it is wrong.
 *
 * `page` is 1-indexed to match ai_grade_results.evidence_box.page, and
 * defaults to that box's page. It is a parameter at all because a part with
 * NO box is exactly the case a teacher most needs to see the page for: the
 * model either could not localise the work or found none, and the only way to
 * fix that by hand is to look at a page and draw the region. This route used
 * to 404 when evidence_box was null, which locked those parts out of the one
 * repair path available to them.
 *
 * Reuses the same Railway CV service /page-image endpoint the NA-review
 * "follow the arrow" second pass already calls (see
 * app/api/na-review/response-crops/[cropId]/assess/route.ts).
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

  const requestedPageParam = request.nextUrl.searchParams.get("page");
  let requestedPage: number;
  if (requestedPageParam === null) {
    requestedPage = box?.page ?? 1;
  } else {
    requestedPage = Number(requestedPageParam);
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      return NextResponse.json({ error: "page must be a whole number of 1 or more" }, { status: 400 });
    }
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

  const target = cvServiceEndpoint("/page-image");
  if (!target) {
    return NextResponse.json({ error: "Full-page view is not configured on this deployment" }, { status: 503 });
  }

  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(run.source_storage_path);
  if (dlErr || !pdfFile) {
    return NextResponse.json({ error: dlErr?.message ?? "Could not read the source scan" }, { status: 500 });
  }
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  let pageCount: number;
  let widthPt: number;
  let heightPt: number;
  try {
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
    pageCount = pdfDoc.getPageCount();
    const page = pdfDoc.getPages()[requestedPage - 1];
    if (!page) {
      return NextResponse.json(
        { error: `Page ${requestedPage} is out of range for this ${pageCount}-page scan`, pageCount },
        { status: 422 }
      );
    }
    widthPt = page.getWidth();
    heightPt = page.getHeight();
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the source scan: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  // Outline the stored region only when it is on the page actually being
  // rendered -- a box from page 3 drawn onto page 4 would point at nothing
  // and read as a second, contradictory answer to "where is the work".
  const highlightBox =
    box && box.page === requestedPage ? fractionBoxToPoints(box, { widthPt, heightPt }) : null;

  const rendered = await renderPageImage({
    pdfBase64,
    pageIndex: requestedPage - 1,
    highlightBox,
  });
  if (!rendered.ok) return NextResponse.json({ error: rendered.error }, { status: 502 });

  return NextResponse.json({
    imageBase64: rendered.value.imageBase64,
    imageMediaType: rendered.value.imageMediaType,
    page: requestedPage,
    pageCount,
    // The editor draws in page fractions, so it never needs these -- they are
    // here so a caller can report what it is looking at without a second round
    // trip to the PDF.
    widthPt,
    heightPt,
  });
}
