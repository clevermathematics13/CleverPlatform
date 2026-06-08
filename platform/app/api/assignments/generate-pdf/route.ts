import { getApiTeacher } from "@/lib/auth";
import { NextResponse } from "next/server";
import { DocumentOrchestratorService } from "@/lib/document-orchestrator";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sparticuz Chromium binary URL for Vercel serverless.
// We pin to a known-good release so the fetch is deterministic.
const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar";

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

    // Detect Vercel environment; fall back to system Chromium locally
    const isVercel = Boolean(process.env.VERCEL);

    let browser;
    try {
      if (isVercel) {
        // Sparticuz provides a Lambda-compatible Chromium binary
        const executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
        browser = await puppeteer.launch({
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath,
          headless: chromium.headless,
        });
      } else {
        // Local dev: use system Chrome / installed Chromium
        browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
          executablePath: process.env.CHROME_EXECUTABLE_PATH,
        });
      }

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
