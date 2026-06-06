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

    // Phase 1 — validate + Phase 4 — server-side KaTeX render
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
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      const page = await browser.newPage();

      // KaTeX CSS is loaded via @import in the <style> block;
      // networkidle0 ensures the font has loaded before PDF capture.
      await page.setContent(html, {
        waitUntil: "networkidle0" as const,
        timeout: 30000,
      });

      const pdf = await page.pdf({
        format: "A4",
        margin: {
          top: `${pageMarginsMm}mm`,
          right: `${pageMarginsMm}mm`,
          bottom: `${pageMarginsMm}mm`,
          left: `${pageMarginsMm}mm`,
        },
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
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
