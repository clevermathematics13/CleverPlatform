import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import { getApiTeacher } from "@/lib/auth";
import {
  buildRenderDocument,
  cleanCorrectedLatex,
  formatDiscrepanciesForPrompt,
  parseComparisonResponse,
  LATEX_VISUAL_CHECK_SYSTEM,
  LATEX_VISUAL_CORRECTION_SYSTEM,
  RENDER_ROOT_ID,
  RENDER_WIDTH_PX,
  type Discrepancy,
} from "@/lib/latex-visual-check";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/questions/visual-check
// Body: {
//   partId, field?: "content_latex" | "markscheme_latex",
//   renderedHtml: string,      // innerHTML captured from the live LatexRenderer
//   styleHrefs?: string[],     // the page's stylesheet URLs
//   currentLatex?: string,     // what produced renderedHtml (defaults to stored)
// }
//
// Screenshots the supplied markup and asks Claude to compare it against the
// question's source scans. One comparison per call; when differences are found
// it also proposes corrected LaTeX.
//
// The markup is captured in the browser rather than rendered here on purpose:
// LatexRenderer is a client component, so server code receives a client
// reference it cannot invoke. Capturing the live DOM is also higher fidelity,
// since it is exactly what the teacher sees. The caller re-renders a proposed
// correction and calls again to verify it, which is how multi-pass checking
// works without the server needing to render React at all.
//
// Nothing is written to the database. Corrections come back as proposals.

// Same pinned Chromium build the PDF routes use, so serverless behaviour and
// font rendering stay consistent across the two pipelines.
const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar";

const SIGNED_URL_TTL_SECONDS = 300;

type LatexField = "content_latex" | "markscheme_latex";

type SourceImage = { data: string; mediaType: "image/png" | "image/jpeg" };

function mediaTypeForPath(path: string): "image/png" | "image/jpeg" {
  return /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
}

/** Anthropic image block from base64 data. */
function imageBlock(img: SourceImage): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.data },
  };
}

/** Pull the text block out of a response, skipping Sonnet 5 thinking blocks. */
function textOf(response: Anthropic.Message): string {
  const block = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  return block?.text ?? "";
}

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const partId = body.partId;
  if (typeof partId !== "string" || !partId) {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  const field: LatexField =
    body.field === "markscheme_latex" ? "markscheme_latex" : "content_latex";

  const renderedHtml = body.renderedHtml;
  if (typeof renderedHtml !== "string" || !renderedHtml.trim()) {
    return NextResponse.json(
      { error: "renderedHtml is required — nothing was captured to compare." },
      { status: 400 },
    );
  }

  const styleHrefs = Array.isArray(body.styleHrefs)
    ? body.styleHrefs.filter((h): h is string => typeof h === "string")
    : [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not set" },
      { status: 500 },
    );
  }

  // ── Load the part and its stored LaTeX ────────────────────────────────────
  const { data: part, error: partErr } = await supabase
    .from("question_parts")
    .select("id, question_id, part_label, content_latex, markscheme_latex")
    .eq("id", partId)
    .single();

  if (partErr || !part) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  const storedLatex = (part[field] as string | null) ?? "";
  // The caller may be verifying a correction it has not saved yet, so trust the
  // LaTeX it says produced this markup and fall back to what is stored.
  const originalLatex =
    typeof body.currentLatex === "string" && body.currentLatex.trim()
      ? body.currentLatex
      : storedLatex;
  if (!originalLatex.trim()) {
    return NextResponse.json(
      {
        error:
          field === "markscheme_latex"
            ? "This part has no markscheme LaTeX to check. Extract it first."
            : "This part has no question LaTeX to check. Extract it first.",
      },
      { status: 400 },
    );
  }

  // ── Load the source scans this LaTeX was extracted from ───────────────────
  const imageType = field === "markscheme_latex" ? "markscheme" : "question";
  const { data: imageRows, error: imgErr } = await supabase
    .from("question_images")
    .select("id, storage_path, sort_order")
    .eq("question_id", part.question_id)
    .eq("image_type", imageType)
    .order("sort_order", { ascending: true });

  if (imgErr) {
    return NextResponse.json({ error: imgErr.message }, { status: 500 });
  }
  if (!imageRows || imageRows.length === 0) {
    return NextResponse.json(
      {
        error: `No ${imageType} images stored for this question, so there is nothing to compare against.`,
      },
      { status: 400 },
    );
  }

  const sourceImages: SourceImage[] = [];
  for (const row of imageRows) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("question-images")
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: `Could not read source image ${row.storage_path}` },
        { status: 500 },
      );
    }
    const res = await fetch(signed.signedUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Could not download source image (${res.status})` },
        { status: 500 },
      );
    }
    const buf = await res.arrayBuffer();
    sourceImages.push({
      data: Buffer.from(buf).toString("base64"),
      mediaType: mediaTypeForPath(row.storage_path),
    });
  }

  const anthropic = new Anthropic({ apiKey });

  let renderedPng: string;
  let browser;
  try {
    const isVercel = Boolean(process.env.VERCEL);
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
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        executablePath: process.env.CHROME_EXECUTABLE_PATH,
      });
    }

    const page = await browser.newPage();
    await page.setViewport({
      width: RENDER_WIDTH_PX + 40,
      height: 1200,
      deviceScaleFactor: 2,
    });
    // networkidle0 so the stylesheets and their webfonts are in before we
    // measure anything; screenshotting mid-font-load produces phantom
    // "layout" discrepancies.
    await page.setContent(buildRenderDocument(renderedHtml, styleHrefs), {
      waitUntil: "networkidle0",
      timeout: 30000,
    });
    await page.evaluate(async () => {
      const d = document as Document & { fonts?: { ready: Promise<unknown> } };
      if (d.fonts?.ready) await d.fonts.ready;
    });
    const element = await page.$(`#${RENDER_ROOT_ID}`);
    if (!element) throw new Error("Render harness produced no root element");
    const shot = await element.screenshot({ type: "png" });
    renderedPng = Buffer.from(shot).toString("base64");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Screenshot failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }

  // ── Compare the render against the source ────────────────────────────────
  const compareContent: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `SOURCE — ${sourceImages.length} scan image(s) of the official IB ${
        imageType === "markscheme" ? "mark scheme" : "question"
      }:`,
    },
    ...sourceImages.map(imageBlock),
    {
      type: "text",
      text: "RENDERED — screenshot of how the transcribed LaTeX currently displays:",
    },
    imageBlock({ data: renderedPng, mediaType: "image/png" }),
    {
      type: "text",
      text: "Compare the RENDERED image against the SOURCE and report every discrepancy as JSON.",
    },
  ];

  let comparison;
  try {
    const compareResponse = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: LATEX_VISUAL_CHECK_SYSTEM,
      messages: [{ role: "user", content: compareContent }],
    });
    comparison = parseComparisonResponse(textOf(compareResponse));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Comparison failed" },
      { status: 502 },
    );
  }

  if (!comparison) {
    // An unreadable reply is NOT a clean bill of health — say so rather than
    // reporting "no discrepancies found".
    return NextResponse.json(
      {
        error:
          "The visual checker did not return a readable report. Nothing was changed.",
      },
      { status: 502 },
    );
  }

  // ── Propose a correction for anything a rewrite could actually fix ───────
  // "formatting" findings are renderer styling, not transcription errors —
  // rewriting the LaTeX cannot fix those, so they never trigger a correction.
  const fixable: Discrepancy[] = comparison.discrepancies.filter(
    (d) => d.kind !== "formatting",
  );

  let proposedLatex: string | null = null;
  if (fixable.length > 0) {
    try {
      const correctionResponse = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        system: LATEX_VISUAL_CORRECTION_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "SOURCE scan image(s):" },
              ...sourceImages.map(imageBlock),
              {
                type: "text",
                text: `Current LaTeX:\n---\n${originalLatex}\n---\n\nDiscrepancies found by comparing a rendering of this LaTeX against the source:\n${formatDiscrepanciesForPrompt(
                  fixable,
                )}\n\nReturn the corrected LaTeX.`,
              },
            ],
          },
        ],
      });
      const corrected = cleanCorrectedLatex(textOf(correctionResponse));
      if (corrected && corrected !== originalLatex) proposedLatex = corrected;
    } catch {
      // A failed correction attempt is not fatal — the teacher still gets the
      // discrepancy report, which is the part that matters most.
      proposedLatex = null;
    }
  }

  return NextResponse.json({
    ok: true,
    field,
    partLabel: part.part_label ?? null,
    sourceImageCount: sourceImages.length,
    matches: comparison.matches,
    summary: comparison.summary,
    discrepancies: comparison.discrepancies,
    // Applying this is a separate, explicit action by the teacher.
    proposedLatex,
  });
}
