import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postProcessMathpixLatex, IB_NORMALISE_SYSTEM } from "@/lib/latex-utils";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

// POST /api/questions/ocr-latex
// Body: { questionId: string, field: "content_latex" | "markscheme_latex" }
//
// Fetches the stored question_images for the question, runs MathPix (or Claude
// vision fallback), applies IBPart post-processing, saves the result to all
// question_parts for that question, and returns the extracted LaTeX.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "teacher")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as {
    questionId: string;
    field: "content_latex" | "markscheme_latex";
  };
  const { questionId, field } = body;

  if (!questionId || !field)
    return NextResponse.json(
      { error: "questionId and field are required" },
      { status: 400 }
    );

  if (!["content_latex", "markscheme_latex"].includes(field))
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });

  // Determine image type from field
  const imageType = field === "content_latex" ? "question" : "markscheme";

  // Fetch image records
  const { data: images, error: imgErr } = await supabase
    .from("question_images")
    .select("id, storage_path, sort_order")
    .eq("question_id", questionId)
    .eq("image_type", imageType)
    .order("sort_order");

  if (imgErr)
    return NextResponse.json({ error: imgErr.message }, { status: 500 });

  if (!images || images.length === 0)
    return NextResponse.json(
      { error: `No ${imageType} images found for this question` },
      { status: 404 }
    );

  // Download each image as base64
  const base64Images: string[] = [];
  for (const img of images) {
    const { data: signedData, error: signErr } = await supabase.storage
      .from("question-images")
      .createSignedUrl(img.storage_path, 120);
    if (signErr || !signedData?.signedUrl)
      return NextResponse.json(
        { error: `Failed to sign URL for ${img.storage_path}` },
        { status: 500 }
      );

    const res = await fetch(signedData.signedUrl);
    if (!res.ok)
      return NextResponse.json(
        { error: `Failed to download image: ${res.status}` },
        { status: 502 }
      );
    const buf = await res.arrayBuffer();
    base64Images.push(Buffer.from(buf).toString("base64"));
  }

  // Try MathPix first; fall back to Claude vision
  const MATHPIX_APP_ID = process.env.MATHPIX_APP_ID;
  const MATHPIX_APP_KEY = process.env.MATHPIX_APP_KEY;
  const USE_MATHPIX = !!(MATHPIX_APP_ID && MATHPIX_APP_KEY);

  let extractedLatex: string;

  if (USE_MATHPIX) {
    const parts: string[] = [];
    for (const b64 of base64Images) {
      const mpRes = await fetch("https://api.mathpix.com/v3/text", {
        method: "POST",
        headers: {
          app_id: MATHPIX_APP_ID!,
          app_key: MATHPIX_APP_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          src: `data:image/png;base64,${b64}`,
          formats: ["latex_styled"],
          math_inline_delimiters: ["$", "$"],
          math_display_delimiters: ["$$", "$$"],
        }),
      });
      if (!mpRes.ok)
        return NextResponse.json(
          { error: `MathPix error: ${mpRes.status}` },
          { status: 502 }
        );
      const mpJson = await mpRes.json();
      if (mpJson.error)
        return NextResponse.json(
          { error: `MathPix: ${mpJson.error}` },
          { status: 502 }
        );
      parts.push(
        postProcessMathpixLatex(mpJson.latex_styled ?? mpJson.text ?? "")
      );
    }
    extractedLatex = parts.join("\n\n");
  } else {
    // Claude vision fallback
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt =
      imageType === "markscheme"
        ? `These are images of an IB Mathematics mark scheme. Extract the complete LaTeX for the solution/mark scheme shown. Return ONLY the LaTeX body, no explanation, no markdown fences.\n\n${IB_NORMALISE_SYSTEM}`
        : `These are images of an IB Mathematics exam question. Extract the complete LaTeX for the question shown. Return ONLY the LaTeX body, no explanation, no markdown fences.\n\n${IB_NORMALISE_SYSTEM}`;

    const imageContent = base64Images.map((b64) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/png" as const,
        data: b64,
      },
    }));

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            ...imageContent,
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    });
    extractedLatex =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "";
  }

  // ── Claude normalisation pass (Mathpix output only) ───────────────────────
  // Re-run Claude with the original images + raw Mathpix LaTeX to fix any OCR
  // errors and normalise to IB formatting conventions.
  if (USE_MATHPIX && extractedLatex) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const normImageContent = base64Images.map((b64) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/png" as const,
          data: b64,
        },
      }));
      const normResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: IB_NORMALISE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...normImageContent,
              {
                type: "text" as const,
                text: `Raw MathPix output to normalise:\n\n${extractedLatex}\n\nApply IB conventions and fix any OCR errors. Return ONLY the corrected LaTeX body.`,
              },
            ],
          },
        ],
      });
      const normalised =
        normResponse.content[0].type === "text"
          ? normResponse.content[0].text.trim()
          : "";
      if (normalised) extractedLatex = normalised;
    } catch (normErr) {
      // Non-fatal: log and continue with Mathpix output
      console.warn("Claude normalisation pass failed:", normErr);
    }
  }

  // Save to all question_parts for this question
  const { data: partRows, error: partErr } = await supabase
    .from("question_parts")
    .select("id")
    .eq("question_id", questionId);

  if (partErr)
    return NextResponse.json({ error: partErr.message }, { status: 500 });

  if (partRows && partRows.length > 0) {
    const { error: updateErr } = await supabase
      .from("question_parts")
      .update({ [field]: extractedLatex })
      .eq("question_id", questionId);

    if (updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    latex: extractedLatex,
    engine: USE_MATHPIX ? "mathpix" : "claude",
    imagesProcessed: base64Images.length,
  });
}
