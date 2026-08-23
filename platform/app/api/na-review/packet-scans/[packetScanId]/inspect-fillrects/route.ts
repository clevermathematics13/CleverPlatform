import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { NA_SCAN_BUCKET } from "@/lib/na-scanning";

/**
 * GET /api/na-review/packet-scans/[packetScanId]/inspect-fillrects?page=21
 *
 * Debug/authoring tool, not part of the scan pipeline proper. Lists every
 * filled-rectangle-shaped drawing PyMuPDF can find on one page of a
 * student's split PDF, with its bounding box in PDF points -- i.e. it
 * re-runs the same detection method the original 39 A.1 anchors came
 * from (na_packet_versions.anchor_source = 'auto_fillrect'), but scoped
 * to one page, for a human to read off the coordinates of a box the
 * original automated pass missed.
 *
 * WHY THIS EXISTS: A.1's Q26(a) ("Plot all the possible combinations as
 * points on a grid") never got an anchor. The grid is very likely drawn
 * as STROKED lines (a ruled grid) rather than a single FILLED rectangle,
 * which is exactly the kind of shape auto_fillrect would miss -- this
 * route surfaces that distinction directly (each candidate reports
 * whether it has a fill color, a stroke color, both, or neither) rather
 * than guessing.
 *
 * WHY IT RUNS ON A STUDENT'S SPLIT PDF, NOT THE MASTER: this packet
 * version's master_pdf_storage_path is null -- no master was retained
 * after the original anchor-extraction pass. A split PDF's pages are
 * pixel-for-pixel identical to the master's (splitting only cuts the
 * document into per-student ranges, it doesn't touch page content), so
 * any student's split PDF is a valid stand-in for reading geometry off.
 *
 * This is intentionally read-only and manual: it returns candidates for
 * a human to pick from and enter via a real na_anchors insert, not an
 * automatic anchor-creation endpoint. Placing an anchor is a real
 * decision (which box, how much bleed) that deserves a person looking at
 * the rendered page image alongside these numbers, not a blind pick of
 * "whichever rectangle is biggest".
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packetScanId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetScanId } = await params;

  const pageParam = request.nextUrl.searchParams.get("page");
  if (!pageParam || Number.isNaN(Number(pageParam))) {
    return NextResponse.json(
      { error: "Query param 'page' is required (1-indexed page number as printed on the document)." },
      { status: 400 }
    );
  }
  const pageNumber1Indexed = Number(pageParam);

  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, split_storage_path")
    .eq("id", packetScanId)
    .maybeSingle();
  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });
  if (!scan) return NextResponse.json({ error: "Packet scan not found" }, { status: 404 });
  if (!scan.split_storage_path) {
    return NextResponse.json({ error: "This packet scan has no split PDF yet." }, { status: 400 });
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from(NA_SCAN_BUCKET)
    .download(scan.split_storage_path);
  if (dlErr || !file) {
    return NextResponse.json(
      { error: `Could not read the split PDF: ${dlErr?.message ?? "not found"}` },
      { status: 404 }
    );
  }
  const pdfBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const serviceBase = (process.env.GRAPH_LAB_CV_SERVICE_URL ?? "").trim().replace(/\/$/, "");
  if (!serviceBase) {
    return NextResponse.json({ error: "GRAPH_LAB_CV_SERVICE_URL is not configured." }, { status: 503 });
  }
  const target = `${/^https?:\/\//i.test(serviceBase) ? serviceBase : `https://${serviceBase}`}/inspect-fillrects`;
  const cvSecret = process.env.CV_SERVICE_SECRET ?? "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(cvSecret ? { "X-CV-Secret": cvSecret } : {}) },
      body: JSON.stringify({ studentPdfBase64: pdfBase64, pageIndex: pageNumber1Indexed - 1 }),
      signal: controller.signal,
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      let errMsg = `CV service returned HTTP ${upstream.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.error) errMsg = parsed.error;
      } catch {
        /* not JSON, use generic message */
      }
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }
    return NextResponse.json(JSON.parse(raw));
  } catch (e) {
    return NextResponse.json(
      { error: `Inspection request failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
