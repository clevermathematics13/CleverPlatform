/**
 * The one place that talks to the Railway CV service (platform/cv-service).
 *
 * Three routes needed the same six lines of endpoint plumbing -- resolve
 * GRAPH_LAB_CV_SERVICE_URL, tolerate a value with or without a scheme, strip a
 * trailing slash, attach X-CV-Secret, bound the request with an
 * AbortController -- and two of them needed the same /crop call on top. Having
 * each spell it out separately is how two callers end up disagreeing about,
 * say, the timeout or whether the secret header is sent.
 *
 * The service has no database access: every caller passes the PDF and the
 * regions in the request body (see cv-service/main.py's CropRequest), which is
 * why the same endpoint serves both the grading run's model-located boxes and
 * a teacher's redrawn one with no server-side change.
 *
 * Server-only: it reads process.env and calls out over the network. The pure
 * geometry that decides WHAT to crop lives in lib/evidence-crops.ts and stays
 * importable from anywhere.
 */

/** Matches cv-service/main.py's AnchorIn. Points, page index 0-based. */
export interface CropRegion {
  qid: string;
  pageIndex: number;
  x0Pt: number;
  y0Pt: number;
  x1Pt: number;
  y1Pt: number;
  /** Caps adaptive right/bottom growth. Omit to let it run to the page edge. */
  expandMaxX1Pt?: number;
  expandMaxY1Pt?: number;
}

export interface CvCrop {
  qid: string;
  imageBase64?: string;
}

export type CvResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 45000;

/**
 * Absolute URL for one CV service path, or null when the service is not
 * configured for this deployment (the normal case locally, where every caller
 * degrades to "no crop" rather than failing).
 */
export function cvServiceEndpoint(path: string): string | null {
  const raw = process.env.GRAPH_LAB_CV_SERVICE_URL;
  if (!raw) return null;
  const base = raw.trim().replace(/\/$/, "");
  const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  return `${withScheme}${path.startsWith("/") ? path : `/${path}`}`;
}

function cvHeaders(): Record<string, string> {
  const secret = process.env.CV_SERVICE_SECRET ?? "";
  return {
    "Content-Type": "application/json",
    ...(secret ? { "X-CV-Secret": secret } : {}),
  };
}

/**
 * Crop one or more regions out of a student's scan.
 *
 * Never throws. Callers differ in what they do with a failure -- the grading
 * run swallows it and carries on, because a crop is a nice-to-have alongside a
 * suggested mark and is not worth failing a whole run over, while the teacher's
 * redraw surfaces it, because a silent no-op there looks like a broken button.
 * Returning a result rather than throwing lets both read the same call.
 */
export async function cropRegions(args: {
  pdfBase64: string;
  expectedPageCount: number;
  regions: CropRegion[];
  rotationHint?: number;
  timeoutMs?: number;
}): Promise<CvResult<CvCrop[]>> {
  const target = cvServiceEndpoint("/crop");
  if (!target) return { ok: false, error: "Cropping is not configured on this deployment" };
  if (args.regions.length === 0) return { ok: true, value: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: cvHeaders(),
      body: JSON.stringify({
        studentPdfBase64: args.pdfBase64,
        expectedPageCount: args.expectedPageCount,
        rotationHint: args.rotationHint ?? 0,
        anchors: args.regions,
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Crop service returned status ${upstream.status}` };
    }
    const data = (await upstream.json()) as { crops?: CvCrop[] };
    return { ok: true, value: data.crops ?? [] };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Cropping timed out" : `Crop failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The CV service renders pages at CROP_DPI (300) as lossless PNG and returns
 * them base64-encoded inside a JSON body. On a real scanned A4 page that is
 * 2480x3508px of photocopier noise: measured across seven of one class's
 * scans, the worst page is 7.85MB of PNG, or 10.5MB once base64'd -- past what
 * a serverless function can return, so that page simply failed.
 *
 * Downscaling here rather than in the CV service keeps this inside the Next.js
 * app; a `dpi` parameter there would need a Railway redeploy to take effect.
 * The same worst-case page comes out at 0.26MB, and the red highlight stays
 * crisp -- 2000px of height is still more than double what any viewer
 * displays, so drawing precision is bounded by the screen, not by this.
 */
export const PAGE_VIEW_MAX_HEIGHT_PX = 2000;
export const PAGE_VIEW_JPEG_QUALITY = 85;

export interface RenderedPage {
  imageBase64: string;
  imageMediaType: string;
}

/**
 * Render one page of a PDF, optionally with a region outlined in red, and
 * downscale it to something a JSON response can carry.
 *
 * Never throws, same contract as cropRegions.
 */
export async function renderPageImage(args: {
  pdfBase64: string;
  /** 0-indexed, matching the CV service's PageImageRequest. */
  pageIndex: number;
  highlightBox?: { x0Pt: number; y0Pt: number; x1Pt: number; y1Pt: number } | null;
  rotationHint?: number;
  timeoutMs?: number;
}): Promise<CvResult<RenderedPage>> {
  const target = cvServiceEndpoint("/page-image");
  if (!target) return { ok: false, error: "Full-page view is not configured on this deployment" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let pngBase64: string;
  try {
    const upstream = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: cvHeaders(),
      body: JSON.stringify({
        studentPdfBase64: args.pdfBase64,
        pageIndex: args.pageIndex,
        rotationHint: args.rotationHint ?? 0,
        ...(args.highlightBox ? { highlightBox: args.highlightBox } : {}),
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Page render returned status ${upstream.status}` };
    }
    const body = (await upstream.json()) as { imageBase64?: string };
    if (!body.imageBase64) return { ok: false, error: "Page render returned no image" };
    pngBase64 = body.imageBase64;
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? "Page render timed out"
        : `Page render failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timeout);
  }

  // Sharp is imported lazily and its absence falls back to the original PNG,
  // matching lib/graph-raster-snap.ts. That fallback is the behaviour that
  // shipped before downscaling existed, so a missing binary degrades to the
  // old status quo rather than introducing a new failure.
  try {
    const sharp = (await import("sharp")).default;
    const resized = await sharp(Buffer.from(pngBase64, "base64"))
      .resize({ height: PAGE_VIEW_MAX_HEIGHT_PX, withoutEnlargement: true })
      .jpeg({ quality: PAGE_VIEW_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { ok: true, value: { imageBase64: resized.toString("base64"), imageMediaType: "image/jpeg" } };
  } catch {
    return { ok: true, value: { imageBase64: pngBase64, imageMediaType: "image/png" } };
  }
}
