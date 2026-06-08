import { getApiTeacher } from "@/lib/auth";
import { NextResponse } from "next/server";
import { generateMarkSchemeHtml, type MarkSchemeRequest } from "@/lib/document-orchestrator";
import { FormattingRequirementsSchema } from "@/lib/template-schema";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar";

export async function POST(req: Request) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as MarkSchemeRequest;

    const fmtResult = FormattingRequirementsSchema.safeParse(body.formatting);
    if (!fmtResult.success) {
      return NextResponse.json({ error: "Invalid formatting" }, { status: 422 });
    }

    if (!Array.isArray(body.sections) || body.sections.length === 0) {
      return NextResponse.json({ error: "No sections provided" }, { status: 422 });
    }

    const html = generateMarkSchemeHtml({ ...body, formatting: fmtResult.data });
    const safeFilename = `${(body.title || "assignment").replace(/[^a-z0-9]/gi, "_")}_mark_scheme`;

    const isVercel = Boolean(process.env.VERCEL);

    let browser;
    try {
      if (isVercel) {
        const executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
        browser = await puppeteer.launch({
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath,
          headless: chromium.headless,
        });
      } else {
        browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
          executablePath: process.env.CHROME_EXECUTABLE_PATH,
        });
      }
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" as const, timeout: 30000 });
      const pdf = await page.pdf({
        format: "A4",
        margin: { top: `${fmtResult.data.pageMarginsMm}mm`, right: `${fmtResult.data.pageMarginsMm}mm`, bottom: `${fmtResult.data.pageMarginsMm}mm`, left: `${fmtResult.data.pageMarginsMm}mm` },
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mark scheme generation error" },
      { status: 500 }
    );
  }
}
