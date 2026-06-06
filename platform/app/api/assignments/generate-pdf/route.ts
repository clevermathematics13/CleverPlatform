import { getApiTeacher } from "@/lib/auth";
import { NextResponse } from "next/server";
import { DocumentOrchestratorService } from "@/lib/document-orchestrator";
import puppeteer from "puppeteer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;

    const raw = await req.json();

    const orchestrated = DocumentOrchestratorService.render(raw);
    if (!orchestrated.success) {
      return NextResponse.json({ error: orchestrated.error }, { status: 422 });
    }

    const { html } = orchestrated;
    const safeFilename = ((raw as { title?: string }).title ?? "assignment")
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    const pageMarginsMm =
      (raw as { formatting?: { pageMarginsMm?: number } }).formatting?.pageMarginsMm ?? 16;

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });

      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: "load" as const,
        timeout: 30000,
      });

      const pdf = await page.pdf({
        format: "A4",
        margin: { top: `${pageMarginsMm}mm`, right: `${pageMarginsMm}mm`, bottom: `${pageMarginsMm}mm`, left: `${pageMarginsMm}mm` },
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
      });

      await browser.close();
      browser = undefined;

      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeFilename}.pdf"`,
          "Content-Length": String(pdf.length),
        },
      });
    } finally {
      if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "PDF generation error" }, { status: 500 });
  }
}
