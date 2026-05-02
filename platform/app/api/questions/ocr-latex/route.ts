import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postProcessMathpixLatex, IB_NORMALISE_SYSTEM } from "@/lib/latex-utils";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

type OcrField =
  | "content_latex"
  | "markscheme_latex"
  | "stem_latex"
  | "stem_markscheme_latex"
  | "parts_draft_latex"
  | "parts_draft_markscheme_latex";

// POST /api/questions/ocr-latex
// Body: { questionId: string, field: OcrField }
//
// Fetches the stored question_images for the question, runs MathPix (or Claude
// vision fallback), applies IBPart post-processing, then:
//   - For stem_* / parts_draft_*: saves to ib_questions.
//   - For content_latex / markscheme_latex: saves to all question_parts (legacy).
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
    field: OcrField;
  };
  const { questionId, field } = body;

  if (!questionId || !field)
    return NextResponse.json(
      { error: "questionId and field are required" },
      { status: 400 }
    );

  const validFields: OcrField[] = [
    "content_latex",
    "markscheme_latex",
    "stem_latex",
    "stem_markscheme_latex",
    "parts_draft_latex",
    "parts_draft_markscheme_latex",
  ];
  if (!validFields.includes(field))
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });

  const isStem = field === "stem_latex" || field === "stem_markscheme_latex";
  const isDraft = field === "parts_draft_latex" || field === "parts_draft_markscheme_latex";
  // Both stem and draft fields save to ib_questions rather than question_parts
  const savesToQuestion = isStem || isDraft;

  // Determine image type from field
  const imageType =
    field === "content_latex" || field === "stem_latex" || field === "parts_draft_latex"
      ? "question"
      : "markscheme";

  // Fetch image records from question_images table
  const { data: images, error: imgErr } = await supabase
    .from("question_images")
    .select("id, storage_path, sort_order")
    .eq("question_id", questionId)
    .eq("image_type", imageType)
    .order("sort_order");

  if (imgErr)
    return NextResponse.json({ error: imgErr.message }, { status: 500 });

  // Download each image as base64
  const base64Images: string[] = [];

  if (images && images.length > 0) {
    // Use question_images table (preferred)
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
  } else {
    // Fallback: use page_image_paths stored on ib_questions
    const { data: qRow, error: qErr } = await supabase
      .from("ib_questions")
      .select("page_image_paths, source_pdf_path")
      .eq("id", questionId)
      .single();

    if (qErr)
      return NextResponse.json({ error: qErr.message }, { status: 500 });

    const paths: string[] = qRow?.page_image_paths ?? [];
    if (paths.length === 0)
      return NextResponse.json(
        { error: "No images found for this question. Please extract question images first." },
        { status: 404 }
      );

    for (const path of paths) {
      const { data: signedData, error: signErr } = await supabase.storage
        .from("question-images")
        .createSignedUrl(path, 120);
      if (signErr || !signedData?.signedUrl)
        return NextResponse.json(
          { error: `Failed to sign URL for ${path}` },
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

    let prompt: string;
    if (isStem) {
      const stemType = field === "stem_latex" ? "question" : "mark scheme";
      prompt = `These are images of an IB Mathematics exam ${stemType}. The question has multiple labelled parts marked (a), (b), (c) etc.

Your task: extract ONLY the introductory stem — the setup/context paragraphs that appear BEFORE the first labelled part (a). The stem typically defines functions, variables, or conditions shared by all parts. It ends immediately before the label "(a)".

DO NOT include:
- The label "(a)" itself or any subsequent part labels
- The question text of part (a) or any later part
- Any mark allocations like [1], [3] etc.

If there is no text before "(a)", return an empty string.

Use $ ... $ for inline math and \\[ ... \\] for display math. Use \\boldsymbol{} for vectors, \\begin{pmatrix} for matrices. Return ONLY the LaTeX body, no explanation, no markdown fences.`;
    } else if (isDraft) {
      const draftType = field === "parts_draft_latex" ? "question" : "mark scheme";
      prompt = `These are images of an IB Mathematics exam ${draftType}. The question has an introductory stem followed by multiple labelled parts (a), (b), (c) etc.

Your task: extract the FULL question content in \\begin{IBPart}...\\end{IBPart} blocks.

CRITICAL RULE — interspersed context paragraphs:
Any setup/definition paragraph that appears BETWEEN two part labels (e.g. between (a) and (b)) belongs at the TOP of the FOLLOWING part's \\begin{IBPart} block, BEFORE that part's question sentence.

Concrete example of correct output structure:
---
[stem text before (a), if any — outside all IBPart blocks]

\\begin{IBPart}
Write down the value of $\\alpha + \\beta + \\gamma$. \\hfill [1]
\\end{IBPart}

\\begin{IBPart}
A function $h(z)$ is defined by $h(z) = 2z^5 - 11z^4 + rz^3 + sz^2 + tz - 20$, where $r, s, t \\in \\mathbb{R}$.

$\\alpha$, $\\beta$ and $\\gamma$ are also roots of the equation $h(z) = 0$.

It is given that $h(z) = 0$ is satisfied by the complex number $z = p + 3\\mathrm{i}$.

Show that $p = 1$. \\hfill [3]
\\end{IBPart}

\\begin{IBPart}
It is now given that $h\\!\\left(\\dfrac{1}{2}\\right) = 0$, and $\\alpha, \\beta \\in \\mathbb{Z}^+$, $\\alpha < \\beta$ and $\\gamma \\in \\mathbb{Q}$.

\\begin{enumerate}[label=(\\roman*)]
  \\item Find the value of the product $\\alpha\\beta$.
  \\item Write down the value of $\\alpha$ and the value of $\\beta$. \\hfill [3]
\\end{enumerate}
\\end{IBPart}
---

Notice: the h(z) paragraphs appear between labels (a) and (b) in the image, so they go INSIDE the (b) IBPart block FIRST. The "It is now given…" paragraph appears between (b) and (c) in the image, so it goes INSIDE the (c) IBPart block FIRST.

Additional rules:
- Text BEFORE the first labelled part (a) goes OUTSIDE all \\begin{IBPart} blocks — it is the shared stem
- If there is no text before part (a), output nothing before the first \\begin{IBPart}
- Do NOT include the part labels (a), (b), (c) themselves
- Include sub-parts (i), (ii) within the parent part's \\begin{IBPart} block
- Include mark allocations as \\hfill [N] at the end of each part's final line
- Use $ ... $ for inline math and \\[ ... \\] for display math
- Return ONLY the LaTeX body, no explanation, no markdown fences`;
    } else if (imageType === "markscheme") {
      prompt = `These are images of an IB Mathematics mark scheme. Extract the complete LaTeX for the solution/mark scheme shown. Return ONLY the LaTeX body, no explanation, no markdown fences.\n\n${IB_NORMALISE_SYSTEM}`;
    } else {
      prompt = `These are images of an IB Mathematics exam question. Extract the complete LaTeX for the question shown. Return ONLY the LaTeX body, no explanation, no markdown fences.\n\n${IB_NORMALISE_SYSTEM}`;
    }

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
                text: isStem
                  ? `Raw MathPix output to normalise:\n\n${extractedLatex}\n\nThis should be ONLY the introductory stem text before the labelled parts (a), (b), (c) etc. Apply IB conventions and fix any OCR errors. Return ONLY the corrected stem LaTeX body.`
                  : isDraft
                  ? `Raw MathPix output to normalise:\n\n${extractedLatex}\n\nFormat this as \\begin{IBPart}...\\end{IBPart} blocks. CRITICAL: any setup/definition paragraphs appearing between two part labels in the image belong at the TOP of the FOLLOWING part's \\begin{IBPart} block, BEFORE that part's question sentence. Text before part (a) goes outside all IBPart blocks (the shared stem). Do NOT include part labels (a)/(b)/(c) themselves. Include sub-parts and mark allocations as \\hfill [N]. Apply IB conventions and fix any OCR errors. Return ONLY the corrected LaTeX body.`
                  : `Raw MathPix output to normalise:\n\n${extractedLatex}\n\nApply IB conventions and fix any OCR errors. Return ONLY the corrected LaTeX body.`,
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

  // Save extracted LaTeX to the appropriate table
  if (savesToQuestion) {
    // Stem and draft fields save to ib_questions
    const { error: updateErr } = await supabase
      .from("ib_questions")
      .update({ [field]: extractedLatex })
      .eq("id", questionId);

    if (updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
  } else {
    // Legacy: content_latex / markscheme_latex save to all question_parts
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
  }

  return NextResponse.json({
    latex: extractedLatex,
    engine: USE_MATHPIX ? "mathpix" : "claude",
    imagesProcessed: base64Images.length,
  });
}
