import { requireTeacher } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { AssignmentPdfRequest } from "@/lib/assignments";
import { generateAssignmentHtml } from "@/lib/assignments";
import puppeteer from "puppeteer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    await requireTeacher();
    const body = (await req.json()) as AssignmentPdfRequest;

    const html = generateAssignmentHtml(body);
    const safeFilename = (body.title || "assignment")
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

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
      await page.setContent(html, {
        waitUntil: "domcontentloaded" as const,
        timeout: 30000,
      });

      const pdf = await page.pdf({
        format: "A4",
        margin: {
          top: `${body.formatting?.pageMarginsMm ?? 16}mm`,
          right: `${body.formatting?.pageMarginsMm ?? 16}mm`,
          bottom: `${body.formatting?.pageMarginsMm ?? 16}mm`,
          left: `${body.formatting?.pageMarginsMm ?? 16}mm`,
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
    const message =
      err instanceof Error ? err.message : "PDF generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}