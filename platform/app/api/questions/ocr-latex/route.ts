import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
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

const GRAPH_IMAGE_MARKER = "[[GRAPH_IMAGE]]";

function looksGraphLike(text: string): boolean {
  const t = text.toLowerCase();
  // Avoid false positives from generic prose such as "the graph of y=f(x)".
  // Require stronger plotting/axes/asymptote/intercept signals, or a graph/curve
  // mention combined with one of those structural signals.
  const structuralSignals = /(x\s*-?\s*axis|y\s*-?\s*axis|\baxes\b|asymptote|asymptotes|intercepts?|coordinates?|\bplot\b|\bsketch\b|table of values|grid|domain|range)/;
  const graphWords = /\b(graph|curve)\b/;
  return structuralSignals.test(t) || (graphWords.test(t) && /(asymptote|intercepts?|coordinates?|x\s*-?\s*axis|y\s*-?\s*axis|\baxes\b|\bplot\b|\bsketch\b|domain|range)/.test(t));
}

// POST /api/questions/ocr-latex
// Body: { questionId: string, field: OcrField }
// Strip lines that are purely mark-scheme annotations (A1, M1, \hfill A1A1A1, Total [N marks]).
// These creep into question content when the source Google Doc embeds the mark allocation.
// Applied to question-type OCR only (not markscheme fields).
function stripMarkAnnotationLines(latex: string): string {
  // Each line is matched independently. Strip lines that are SOLELY:
  //   • \hfill mark codes: \hfill A1, \hfill A1A1A1A1, \hfill (A1)(M1)
  //   • Bare mark codes:   A1A1A1A1, (A1), M1, R1, AG, N2
  //   • Total annotation:  Total [4 marks], [4 marks]
  const MARK_LINE = /^(?:\\hfill\s*)?(?:\s*[\(\[]?(?:A|M|R|N)\d*[\)\]]?\s*)+$|^Total\s+\[\d+\s+marks?\]\s*$|^\[\d+\s+marks?\]\s*$/i;
  return latex
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t === "" || !MARK_LINE.test(t);
    })
    .join("\n")
    .trim();
}

// Strip a leading question-number prefix such as "8. METHOD 1" -> "METHOD 1",
// or a bare "8." on its own line before the real content. IB papers print the
// question number directly above the markscheme/question content, but this
// platform already encodes the number in the question code (e.g. the trailing
// _8 in 13M.1.AHL.TZ1.H_8), so it is redundant and visually noisy in the panel.
// Only strips a number+dot at the very start of the FIRST LINE — never touches
// numbers elsewhere in the body (e.g. "20th term", "[6 marks]", "100 = ...").
function stripQuestionNumberPrefix(latex: string): string {
  const trimmed = latex.replace(/^\s+/, "");
  const newlineIdx = trimmed.indexOf("\n");
  const firstLine = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
  const restOfText = newlineIdx === -1 ? "" : trimmed.slice(newlineIdx);

  // Case 1: "8. METHOD 1" — strip just the "N." prefix, keep the rest of that line.
  const inlineMatch = firstLine.match(/^(\d{1,3})\.\s+(\S.*)$/);
  if (inlineMatch) {
    return inlineMatch[2] + restOfText;
  }
  // Case 2: a bare number (with or without trailing dot) alone on the first line.
  if (/^\d{1,3}\.?\s*$/.test(firstLine.trim()) && newlineIdx !== -1) {
    return restOfText.replace(/^\s+/, "");
  }
  return latex;
}

//
// Fetches the stored question_images for the question, runs MathPix (or Claude
// vision fallback), applies IBPart post-processing, then:
//   - For stem_* / parts_draft_*: saves to ib_questions.
//   - For content_latex / markscheme_latex: saves to all question_parts (legacy).
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

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
  const isQuestionDraft = field === "parts_draft_latex";
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
      // Cache-bust: append a unique param and force no-store so any cached
      // response for this exact signed URL / storage path is never reused.
      // (Storage paths are also now uniquely suffixed per extraction run —
      // see extract-images/route.ts — so this is defense in depth.)
      const cacheBustedUrl = `${signedData.signedUrl}${signedData.signedUrl.includes("?") ? "&" : "?"}cb=${Date.now()}`;
      const res = await fetch(cacheBustedUrl, { cache: "no-store" });
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
      const cacheBustedUrl = `${signedData.signedUrl}${signedData.signedUrl.includes("?") ? "&" : "?"}cb=${Date.now()}`;
      const res = await fetch(cacheBustedUrl, { cache: "no-store" });
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
  let graphDetected = false;

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
      const cleaned = postProcessMathpixLatex(mpJson.latex_styled ?? mpJson.text ?? "");
      if (isQuestionDraft && looksGraphLike(cleaned)) graphDetected = true;
      parts.push(cleaned);
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

Use $ ... $ for inline math and \\[ ... \\] for display math. Use \\boldsymbol{} for vectors, \\begin{pmatrix} for matrices.
- If the image contains a coordinate diagram or graph appearing in the stem area (before part (a)), output the marker [[GRAPH_IMAGE]] on its own line at the position where the graph appears within the stem.
- No color formatting: NEVER output \\textcolor{}{}, \\color{}, \\colorbox{}{}, \\definecolor{}, or ANY color macro whatsoever. Return plain LaTeX only.
Return ONLY the LaTeX body, no explanation, no markdown fences.`;
    } else if (isDraft) {
      const draftType = field === "parts_draft_latex" ? "question" : "mark scheme";
      prompt = `These are images of an IB Mathematics exam ${draftType}. The question has an introductory stem followed by multiple labelled parts (a), (b), (c) etc.

Your task: extract the FULL question content in \\begin{IBPart}...\\end{IBPart} blocks.

CRITICAL RULE — interspersed context paragraphs:
Any setup/definition paragraph that appears BETWEEN two part labels (e.g. between (a) and (b)) belongs at the TOP of the FOLLOWING part's \\begin{IBPart} block, BEFORE that part's question sentence.

Concrete example of correct output structure:
---
[stem text before (a), if any — outside all IBPart blocks]

\\begin{IBPart}[a]
Write down the value of $\\alpha + \\beta + \\gamma$. \\hfill [1]
\\end{IBPart}

\\begin{IBPart}[b]
A function $h(z)$ is defined by $h(z) = 2z^5 - 11z^4 + rz^3 + sz^2 + tz - 20$, where $r, s, t \\in \\mathbb{R}$.

$\\alpha$, $\\beta$ and $\\gamma$ are also roots of the equation $h(z) = 0$.

It is given that $h(z) = 0$ is satisfied by the complex number $z = p + 3\\mathrm{i}$.

Show that $p = 1$. \\hfill [3]
\\end{IBPart}

\\begin{IBPart}[c]
It is now given that $h\\!\\left(\\dfrac{1}{2}\\right) = 0$, and $\\alpha, \\beta \\in \\mathbb{Z}^+$, $\\alpha < \\beta$ and $\\gamma \\in \\mathbb{Q}$.

\\begin{enumerate}[label=(\\roman*)]
  \\item Find the value of the product $\\alpha\\beta$.
  \\item Write down the value of $\\alpha$ and the value of $\\beta$. \\hfill [3]
\\end{enumerate}
\\end{IBPart}
---

Notice: the h(z) paragraphs appear between labels (a) and (b) in the image, so they go INSIDE the (b) IBPart block FIRST. The "It is now given…" paragraph appears between (b) and (c) in the image, so it goes INSIDE the (c) IBPart block FIRST.

Additional rules:
- ALWAYS tag each \\begin{IBPart} with the part letter in square brackets: \\begin{IBPart}[a] for part (a), \\begin{IBPart}[d] for part (d), etc. This is CRITICAL for mark schemes that may only show a subset of parts — without the label the parts will be assigned to the wrong slots.
- Text BEFORE the first labelled part (a) goes OUTSIDE all \\begin{IBPart} blocks — it is the shared stem
- If there is no text before part (a), output nothing before the first \\begin{IBPart}
- Do NOT include the part labels (a), (b), (c) inside the block content — the label goes in the \\begin{IBPart}[letter] tag only
- Include sub-parts (i), (ii) within the parent part's \\begin{IBPart} block
- Include mark allocations as \\hfill [N] at the end of each part's final line
- Use $ ... $ for inline math and \\[ ... \\] for display math
- If the image contains a coordinate diagram or graph, output the marker [[GRAPH_IMAGE]] on its own line at the exact position where the graph appears in the document. For example, if the graph appears after the stem introduction and before part (a), place [[GRAPH_IMAGE]] after the stem text and before the first \\begin{IBPart}. If the graph appears between two parts, place it inside the following part's \\begin{IBPart} block, before that part's question text. Do NOT place [[GRAPH_IMAGE]] after the last \\end{IBPart}.
- No color formatting: NEVER output \\textcolor{}{}, \\color{}, \\colorbox{}{}, \\definecolor{}, or ANY color macro whatsoever. Return plain LaTeX only.
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
    if (isQuestionDraft && looksGraphLike(extractedLatex)) graphDetected = true;
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
        model: "claude-sonnet-5",
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
                  ? `Raw MathPix output to normalise:\n\n${extractedLatex}\n\nFormat this as \\begin{IBPart}[letter]...\\end{IBPart} blocks, ALWAYS tagging each block with the correct part letter from the image (e.g. \\begin{IBPart}[a], \\begin{IBPart}[d]). This is critical for mark schemes that may start mid-question. CRITICAL: any setup/definition paragraphs appearing between two part labels in the image belong at the TOP of the FOLLOWING part's \\begin{IBPart} block, BEFORE that part's question sentence. Text before part (a) goes outside all IBPart blocks (the shared stem). Do NOT include part labels (a)/(b)/(c) inside block content. Include sub-parts and mark allocations as \\hfill [N]. Apply IB conventions and fix any OCR errors. Return ONLY the corrected LaTeX body.`
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

  // ── IBPart boundary correction pass (draft fields only) ──────────────────
  // Cross-reference the extracted IBPart blocks with the original images to
  // detect and fix interspersed context paragraphs that landed in the wrong
  // block. A common error: text that appears BETWEEN part (c) and (d) in the
  // original image (a setup paragraph for (d)) ends up at the bottom of the
  // (c) block instead of the top of the (d) block.
  if (isDraft && extractedLatex && base64Images.length > 0) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const correctionImages = base64Images.map((b64) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: "image/png" as const, data: b64 },
      }));
      const docType = isQuestionDraft ? "question" : "mark scheme";
      const correctionPrompt = `You have already extracted this IB Mathematics ${docType} into \\begin{IBPart}[letter]...\\end{IBPart} blocks. Now perform a boundary check against the original images.

Background: In IB papers, a context/setup paragraph sometimes appears printed BETWEEN two part labels in the original document — for example, a line like "Consider the function $g(x) = mx + c$, where $x \\in \\mathbb{R}$ and $m, c \\in \\mathbb{Q}$." printed between the "(c)" and "(d)" labels. Such paragraphs must go at the TOP of the FOLLOWING part's IBPart block.

A frequent extraction error is placing such paragraphs at the BOTTOM of the PRECEDING part instead.

For each IBPart block, compare its content with the image:
- If the block's FINAL paragraph is a setup/definition that introduces the NEXT part's task (it provides no answer to the current part and is not needed to understand the current part's conclusion), move it to the beginning of the next part's IBPart block.
- If the block's final content is a genuine conclusion or result of the current part's task, leave it in place.

Apply corrections directly. Return the complete corrected LaTeX with \\begin{IBPart}[letter] tags preserved. If nothing needs moving, return the text unchanged. Return ONLY the LaTeX body — no explanation, no markdown fences.

Current extraction:
${extractedLatex}`;

      const correctionResp = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            ...correctionImages,
            { type: "text" as const, text: correctionPrompt },
          ],
        }],
      });
      const corrected = correctionResp.content[0].type === "text"
        ? correctionResp.content[0].text.trim()
        : "";
      if (corrected) extractedLatex = corrected;
    } catch (boundaryErr) {
      // Non-fatal: log and continue with the un-corrected extraction
      console.warn("IBPart boundary correction pass failed:", boundaryErr);
    }
  }

  // Strip mark-scheme annotation lines from question OCR output.
  // (Markscheme fields intentionally keep A1/M1 annotations.)
  if (imageType === "question") {
    extractedLatex = stripMarkAnnotationLines(extractedLatex);
  }

  // Strip a leading question-number prefix (e.g. "8. METHOD 1" -> "METHOD 1").
  // Applies to both question and markscheme output — the number is already
  // encoded in the question code and is redundant noise in the LaTeX panel.
  extractedLatex = stripQuestionNumberPrefix(extractedLatex);

  const graphMarkerInjected = false; // graph marker is now placed by Claude at the correct position

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
    graphDetected,
    graphMarkerInjected,
  });
}
