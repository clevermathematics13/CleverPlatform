import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";
import type { PageSizePt } from "@/lib/evidence-crops";
import { renderPageImage } from "@/lib/cv-crop-service";

export const maxDuration = 60;

/**
 * GET /api/tests/[id]/paper-layout/page-image?page=N[&questionNumber=&partLabel=]
 *
 * Renders one page of the layout's reference PDF for the region authoring UI,
 * with that part's already-saved region outlined in red when there is one.
 *
 * Separate from the per-result page-image route next door because the source
 * differs: that one renders the page a particular STUDENT's crop came from,
 * this one renders the shared reference every student's regions are measured
 * against. Both go through renderPageImage, so the downscaling that keeps a
 * 300 DPI page inside a JSON response is applied once, in one place.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "page must be a whole number of 1 or more" }, { status: 400 });
  }

  const { data: layout, error: layoutErr } = await supabase
    .from("test_paper_layouts")
    .select("id, reference_storage_path, page_count, reference_page_sizes")
    .eq("test_id", testId)
    .eq("is_active", true)
    .maybeSingle();
  if (layoutErr) return NextResponse.json({ error: layoutErr.message }, { status: 500 });
  if (!layout) return NextResponse.json({ error: "This assessment has no paper layout yet" }, { status: 404 });
  if (!layout.reference_storage_path) {
    return NextResponse.json({ error: "This layout has no reference paper on file" }, { status: 404 });
  }
  if (page > (layout.page_count as number)) {
    return NextResponse.json(
      { error: `Page ${page} is out of range for this ${layout.page_count}-page paper` },
      { status: 422 }
    );
  }

  // Outline the region already saved for the part being edited, when it is on
  // this page -- the same "is my box where I think it is" check the per-result
  // view gives, before anything is cropped from it.
  const questionNumberParam = request.nextUrl.searchParams.get("questionNumber");
  let highlightBox: { x0Pt: number; y0Pt: number; x1Pt: number; y1Pt: number } | null = null;
  if (questionNumberParam !== null) {
    const questionNumber = Number(questionNumberParam);
    const partLabelParam = request.nextUrl.searchParams.get("partLabel");
    const partLabel = partLabelParam && partLabelParam.trim() ? partLabelParam.trim() : null;
    if (Number.isInteger(questionNumber)) {
      let q = supabase
        .from("test_item_anchors")
        .select("page_index, x0_pt, y0_pt, x1_pt, y1_pt")
        .eq("layout_id", layout.id)
        .eq("question_number", questionNumber)
        .eq("page_index", page - 1);
      q = partLabel === null ? q.is("part_label", null) : q.eq("part_label", partLabel);
      const { data: anchor } = await q.maybeSingle();
      if (anchor) {
        highlightBox = {
          x0Pt: Number(anchor.x0_pt),
          y0Pt: Number(anchor.y0_pt),
          x1Pt: Number(anchor.x1_pt),
          y1Pt: Number(anchor.y1_pt),
        };
      }
    }
  }

  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .download(layout.reference_storage_path as string);
  if (dlErr || !pdfFile) {
    return NextResponse.json({ error: dlErr?.message ?? "Could not read the reference paper" }, { status: 500 });
  }
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  const rendered = await renderPageImage({ pdfBase64, pageIndex: page - 1, highlightBox });
  if (!rendered.ok) return NextResponse.json({ error: rendered.error }, { status: 502 });

  const sizes = (layout.reference_page_sizes ?? []) as PageSizePt[];
  return NextResponse.json({
    imageBase64: rendered.value.imageBase64,
    imageMediaType: rendered.value.imageMediaType,
    page,
    pageCount: layout.page_count,
    pageSize: sizes[page - 1] ?? null,
  });
}
