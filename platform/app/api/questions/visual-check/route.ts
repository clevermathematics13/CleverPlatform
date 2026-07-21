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
  type VisualCheckPass,
} from "@/lib/latex-visual-check";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/questions/visual-check
// Body: { partId, field?: "content_latex" | "markscheme_latex", maxPasses?: number }
//
// Renders a part's stored LaTeX through the real LatexRenderer component,
// screenshots it, and asks Claude to compare that screenshot against the
// original scan. When discrepancies are found it can run further passes:
// propose corrected LaTeX, re-render, and re-compare, so a fix that only
// half-worked is caught rather than assumed good.
//
// Nothing is written to the database. The corrected LaTeX comes back as a
// proposal for the teacher to review and apply, which keeps a vision model
// from silently rewriting exam content.

// Same pinned Chromium build the PDF routes use, so serverless behaviour and
// font rendering stay consistent across the two pipelines.
const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar";

const MAX_ALLOWED_PASSES = 3;
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

  const requestedPasses =
    typeof body.maxPasses === "number" && Number.isFinite(body.maxPasses)
      ? Math.floor(body.maxPasses)
      : 2;
  const maxPasses = Math.min(Math.max(requestedPasses, 1), MAX_ALLOWED_PASSES);

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

  const originalLatex = (part[field] as string | null) ?? "";
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
  const passes: VisualCheckPass[] = [];
  let currentLatex = originalLatex;

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

    /** Render `latex` through the real component and return a base64 PNG. */
    async function screenshotLatex(latex: string): Promise<string> {
      const html = await buildRenderDocument(latex);
      const page = await browser!.newPage();
      try {
        await page.setViewport({
          width: RENDER_WIDTH_PX + 40,
          height: 1200,
          deviceScaleFactor: 2,
        });
        // networkidle0 so the KaTeX stylesheet and its webfonts are in before
        // we measure anything; without it the first screenshot can capture
        // fallback-font layout and produce phantom "layout" discrepancies.
        await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
        await page.evaluate(async () => {
          const d = document as Document & { fonts?: { ready: Promise<unknown> } };
          if (d.fonts?.ready) await d.fonts.ready;
        });
        const element = await page.$(`#${RENDER_ROOT_ID}`);
        if (!element) throw new Error("Render harness produced no root element");
        const shot = await element.screenshot({ type: "png" });
        return Buffer.from(shot).toString("base64");
      } finally {
        await page.close().catch(() => {});
      }
    }

    for (let passNumber = 1; passNumber <= maxPasses; passNumber++) {
      const renderedPng = await screenshotLatex(currentLatex);

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

      const compareResponse = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        system: LATEX_VISUAL_CHECK_SYSTEM,
        messages: [{ role: "user", content: compareContent }],
      });

      const comparison = parseComparisonResponse(textOf(compareResponse));
      if (!comparison) {
        // A reply we cannot parse is NOT a clean bill of health — surface it
        // rather than reporting "no discrepancies found".
        return NextResponse.json(
          {
            error:
              "The visual checker did not return a readable report. Nothing was changed.",
            passes,
          },
          { status: 502 },
        );
      }

      passes.push({
        pass: passNumber,
        matches: comparison.matches,
        summary: comparison.summary,
        discrepancies: comparison.discrepancies,
        latex: currentLatex,
        renderedPng,
      });

      if (comparison.matches) break;
      if (passNumber === maxPasses) break;

      // ── Correction pass ────────────────────────────────────────────────
      const fixable: Discrepancy[] = comparison.discrepancies.filter(
        (d) => d.kind !== "formatting",
      );
      // "formatting" findings are usually renderer styling rather than
      // transcription errors — rewriting the LaTeX cannot fix those, so a
      // correction pass would churn the text for nothing.
      if (fixable.length === 0) break;

      const correctionContent: Anthropic.ContentBlockParam[] = [
        { type: "text", text: "SOURCE scan image(s):" },
        ...sourceImages.map(imageBlock),
        {
          type: "text",
          text: `Current LaTeX:\n---\n${currentLatex}\n---\n\nDiscrepancies found by comparing a rendering of this LaTeX against the source:\n${formatDiscrepanciesForPrompt(
            fixable,
          )}\n\nReturn the corrected LaTeX.`,
        },
      ];

      const correctionResponse = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        system: LATEX_VISUAL_CORRECTION_SYSTEM,
        messages: [{ role: "user", content: correctionContent }],
      });

      const corrected = cleanCorrectedLatex(textOf(correctionResponse));
      // If the model returns nothing usable, or hands back what it was given,
      // another pass would just repeat itself — stop here.
      if (!corrected || corrected === currentLatex) break;
      currentLatex = corrected;
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Visual check failed";
    return NextResponse.json({ error: message, passes }, { status: 500 });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }

  const lastPass = passes[passes.length - 1];
  const changed = currentLatex !== originalLatex;

  return NextResponse.json({
    ok: true,
    field,
    partLabel: part.part_label ?? null,
    sourceImageCount: sourceImages.length,
    passes,
    originalLatex,
    // Present only when a correction was actually produced. Applying it is a
    // separate, explicit action by the teacher.
    proposedLatex: changed ? currentLatex : null,
    changed,
    finalMatches: lastPass?.matches ?? false,
    remainingDiscrepancies: lastPass?.discrepancies ?? [],
  });
}
