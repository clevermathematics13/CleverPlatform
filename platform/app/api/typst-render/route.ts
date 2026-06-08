/**
 * /api/typst-render — POST
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepts an ActivityPayload JSON, validates the TemplateAst, compiles to PDF
 * via TypstRenderService, and streams the buffer back.
 *
 * Request body: ActivityPayload (see lib/typst-render.service.ts)
 * Response: application/pdf | application/json (on error)
 *
 * This route is intentionally separate from /api/pdf so the two rendering
 * paths (KaTeX → Puppeteer, and Typst WASM) can co-exist during transition.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import {
  TypstRenderService,
  type ActivityPayload,
} from "@/lib/typst-render.service";

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const payload = body as ActivityPayload;

  if (!payload?.template || !payload?.content) {
    return NextResponse.json(
      { error: "Request must include both template and content fields." },
      { status: 422 }
    );
  }

  const result = await TypstRenderService.render(payload);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, detail: result.detail ?? null },
      { status: 422 }
    );
  }

  return new NextResponse(result.pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="nuanced-analysis.pdf"`,
      "Content-Length": String(result.pdfBuffer.length),
    },
  });
}
