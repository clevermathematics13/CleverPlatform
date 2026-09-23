import { afterEach, describe, expect, it, vi } from "vitest";
import { cropRegions, describeCvServiceFailure, renderPageImage } from "./cv-crop-service";

/**
 * Railway's own reply when nothing is running behind a domain, captured from
 * GRAPH_LAB_CV_SERVICE_URL on 23 Sep 2026: every path, /health included,
 * answered with it. The box editor showed it as "Page render returned status
 * 404", which read as though one page of one scan were missing.
 */
const RAILWAY_APP_NOT_FOUND = {
  status: "error",
  code: 404,
  message: "Application not found",
  request_id: "gR0a0dnlQO-Ma2nW0-QtfA",
};

describe("describeCvServiceFailure", () => {
  it("names Railway having nothing running at the address", () => {
    expect(
      describeCvServiceFailure("Page render", { status: 404, body: RAILWAY_APP_NOT_FOUND, railwayFallback: true })
    ).toBe("Crop service offline (Railway: Application not found)");
  });

  it("still says offline when Railway's reply carries no message", () => {
    expect(describeCvServiceFailure("Crop service", { status: 502, body: null, railwayFallback: true })).toBe(
      "Crop service offline (Railway: status 502)"
    );
  });

  it("passes the service's own error through untouched", () => {
    expect(
      describeCvServiceFailure("Page render", {
        status: 422,
        body: { error: "pageIndex 9 out of range for 8-page PDF" },
        railwayFallback: false,
      })
    ).toBe("pageIndex 9 out of range for 8-page PDF");
  });

  it("says what FastAPI itself answered, e.g. for a route the deployed service predates", () => {
    expect(
      describeCvServiceFailure("Page render", { status: 404, body: { detail: "Not Found" }, railwayFallback: false })
    ).toBe("Page render returned status 404: Not Found");
  });

  it("keeps the bare status when the reply says nothing it can print", () => {
    expect(describeCvServiceFailure("Crop service", { status: 500, body: null, railwayFallback: false })).toBe(
      "Crop service returned status 500"
    );
    // A FastAPI validation failure's detail is a list of objects, not words.
    expect(
      describeCvServiceFailure("Crop service", {
        status: 422,
        body: { detail: [{ loc: ["body", "pageIndex"], msg: "Field required" }] },
        railwayFallback: false,
      })
    ).toBe("Crop service returned status 422");
  });
});

// The function above is handed the header as a boolean; these pin that the
// real callers actually read it off the reply, which is what tells Railway's
// edge apart from a 404 the service sent itself.
describe("the callers read Railway's fallback header", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubReply(body: unknown, status: number, headers: Record<string, string> = {}) {
    vi.stubEnv("GRAPH_LAB_CV_SERVICE_URL", "https://cv.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json", ...headers },
          })
      )
    );
  }

  it("renderPageImage, behind the box editor", async () => {
    stubReply(RAILWAY_APP_NOT_FOUND, 404, { "x-railway-fallback": "true" });
    await expect(renderPageImage({ pdfBase64: "JVBERi0xLjQK", pageIndex: 7 })).resolves.toEqual({
      ok: false,
      error: "Crop service offline (Railway: Application not found)",
    });
  });

  it("cropRegions, behind Save region, Fix crops and every marking run", async () => {
    stubReply(RAILWAY_APP_NOT_FOUND, 404, { "x-railway-fallback": "true" });
    await expect(
      cropRegions({
        pdfBase64: "JVBERi0xLjQK",
        expectedPageCount: 12,
        regions: [{ qid: "item-1", pageIndex: 7, x0Pt: 40, y0Pt: 300, x1Pt: 560, y1Pt: 420 }],
      })
    ).resolves.toEqual({ ok: false, error: "Crop service offline (Railway: Application not found)" });
  });

  it("does not call the service offline for a 404 it sent itself", async () => {
    stubReply({ detail: "Not Found" }, 404);
    await expect(renderPageImage({ pdfBase64: "JVBERi0xLjQK", pageIndex: 7 })).resolves.toEqual({
      ok: false,
      error: "Page render returned status 404: Not Found",
    });
  });
});
