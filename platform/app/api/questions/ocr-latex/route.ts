import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  IB_NORMALISE_SYSTEM,
  postProcessMathpixLatex,
} from "@/lib/latex-utils";

type OcrField =
  | "content_latex"
  | "markscheme_latex"
  | "stem_latex"
  | "stem_markscheme_latex"
  | "parts_draft_latex"
  | "parts_draft_markscheme_latex";

const MATHPIX_APP_ID = process.env.MATHPIX_APP_ID;
const MATHPIX_APP_KEY = process.env.MATHPIX_APP_KEY;

export const runtime = "nodejs";
export const maxDuration = 300;

// These creep into question content when the source Google Doc embeds the mark allocation.
// Applied to question-type OCR only (not markscheme fields).
const MARK_ANNOTATION_LINE_RE =
  /^(\s*(\\hfill\s*)?(\(?(A|M|R|N)\d*\)?(\s*(A|M|R|N)\d*)*|Total\s+\[\d+\s*marks?\]|\[\d+\s*marks?\])(\s*(\\hfill)?)?)\s*$/gim;

function stripMarkAnnotationLines(latex: string): string {
  return latex
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      MARK_ANNOTATION_LINE_RE.lastIndex = 0;
      return !MARK_ANNOTATION_LINE_RE.test(line);
    })
    .join("\n");
}

// Strip a leading question-number prefix such as "8. METHOD 1" -> "METHOD 1",
// "3 (a)" -> "(a)", etc.  IB source documents sometimes have a bold question
// question number directly above the markscheme/question content, but this
// platform already encodes the number in the question code (e.g. the trailing
// "_8" or "_3a" suffix in the code field).
const QUESTION_NUMBER_PREFIX_RE = /^\s*\d+[\.\):]?\s*/;
function stripQuestionNumberPrefix(latex: string): string {
  const trimmed = latex.trimStart();
  const newlineIdx = trimmed.indexOf("\n");
  const firstLine = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
  const restOfText = newlineIdx === -1 ? "" : trimmed.slice(newlineIdx);
  // Only strip if the first line is purely a number (possibly with punctuation)
  // and no other math content — avoids stripping "1 + 2 = 3" etc.
  if (/^\s*\d+[\.\):]?\s*$/.test(firstLine)) {
    return restOfText.trimStart();
  }
  return latex;
}

// Detect whether the extracted LaTeX contains graph/plot data
function looksGraphLike(latex: string): boolean {
  return (
    latex.includes("[[GRAPH_JSON:") ||
    latex.includes("[[GRAPH_IMAGE]]") ||
    latex.includes("\\begin{tikzpicture}")
  );
}

// POST /api/questions/ocr-latex
// Body: { questionId: string, field: OcrField }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { questionId: string; field: OcrField };
  const { questionId, field } = body;

  if (!questionId || !field)
    return NextResponse.json(
      { error: "questionId and field are required" },
      { status: 400 }
    );

  const VALID_FIELDS: OcrField[] = [
    "content_latex",
    "markscheme_latex",
    "stem_latex",
    "stem_markscheme_latex",
    "parts_draft_latex",
    "parts_draft_markscheme_latex",
  ];
  if (!VALID_FIELDS.includes(field))
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });

  const isStem = field === "stem_latex" || field === "stem_markscheme_latex";
  const isDraft = field === "parts_draft_latex" || field === "parts_draft_markscheme_latex";
  const isQuestionDraft = isDraft && field === "parts_draft_latex";

  // Both stem and draft fields save to ib_questions rather than question_parts
  const saveToQuestions = isStem || isDraft;

  const imageType =
    field === "markscheme_latex" || field === "stem_markscheme_latex" || field === "parts_draft_markscheme_latex"
      ? "markscheme"
      : "question";

  // Fetch image records from question_images table
  const { data: imageRecords } = await supabase
    .from("question_images")
    .select("storage_path, sort_order")
    .eq("question_id", questionId)
    .eq("image_type", imageType)
    .order("sort_order", { ascending: true });

  let base64Images: string[] = [];

  if (imageRecords && imageRecords.length > 0) {
    // Use question_images table (preferred)
    base64Images = await Promise.all(
      imageRecords.map(async (rec) => {
        const { data: signedData } = await supabase.storage
          .from("question-images")
          .createSignedUrl(rec.storage_path, 300);
        const url = signedData?.signedUrl ?? rec.storage_path;
        const imgRes = await fetch(url);
        const buf = await imgRes.arrayBuffer();
        // (Storage paths are also now uniquely suffixed per extraction run —
        // see extract-images/route.ts — so this is defense in depth.)
        return Buffer.from(buf).toString("base64");
      })
    );
  } else {
    // Fallback: use page_image_paths stored on ib_questions
    const { data: qData } = await supabase
      .from("ib_questions")
      .select("page_image_paths")
      .eq("id", questionId)
      .single();

    const paths = qData?.page_image_paths ?? [];
    if (!paths.length) {
      return NextResponse.json(
        { error: "No images found for this question. Please extract question images first." },
        { status: 400 }
      );
    }
    base64Images = await Promise.all(
      paths.map(async (path: string) => {
        const { data: signedData } = await supabase.storage
          .from("question-images")
          .createSignedUrl(path, 300);
        const url = signedData?.signedUrl ?? path;
        const imgRes = await fetch(url);
        const buf = await imgRes.arrayBuffer();
        return Buffer.from(buf).toString("base64");
      })
    );
  }

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
      prompt = `These are images of an IB Mathematics exam ${stemType}. The question has multiple labelled parts marked (a), (b), (c) etc.\n\nYour task: extract ONLY the introductory stem — the setup/context paragraphs that appear BEFORE the first labelled part (a). The stem typically defines functions, variables, or conditions shared by all parts. It ends immediately before the label \"(a)\".\n\nDO NOT include:\n- The label \"(a)\" itself or any subsequent part labels\n- The question text of part (a) or any later part\n- Any mark allocations like [1], [3] etc.\n\nIf there is no text before \"(a)\", return an empty string.\n\nUse $ ... $ for inline math and \\\\[ ... \\\\] for display math. Use \\\\boldsymbol{} for vectors, \\\\begin{pmatrix} for matrices.\n- If the image contains a coordinate diagram or graph appearing in the stem area (before part (a)), output the marker [[GRAPH_IMAGE]] on its own line at the position where the graph appears within the stem.\n- No color formatting: NEVER output \\\\textcolor{}{}, \\\\color{}, \\\\colorbox{}{}, \\\\definecolor{}, or ANY color macro whatsoever. Return plain LaTeX only.\nReturn ONLY the LaTeX body, no explanation, no markdown fences.`;
    } else if (isDraft) {
      const draftType = field === "parts_draft_latex" ? "question" : "mark scheme";
      prompt = `These are images of an IB Mathematics exam ${draftType}. The question has an introductory stem followed by multiple labelled parts (a), (b), (c) etc.\n\nYour task: extract the FULL question content in \\\\begin{IBPart}...\\\\end{IBPart} blocks.\n\nCRITICAL RULE — interspersed context paragraphs:\nAny setup/definition paragraph that appears BETWEEN two part labels (e.g. between (a) and (b)) belongs at the TOP of the FOLLOWING part's \\\\begin{IBPart} block, BEFORE that part's question sentence.\n\nConcrete example of correct output structure:\n---\n[stem text before (a), if any — outside all IBPart blocks]\n\n\\\\begin{IBPart}[a]\nWrite down the value of $\\\\alpha + \\\\beta + \\\\gamma$. \\\\hfill [1]\n\\\\end{IBPart}\n\n\\\\begin{IBPart}[b]\nA function $h(z)$ is defined by $h(z) = 2z^5 - 11z^4 + rz^3 + sz^2 + tz - 20$, where $r, s, t \\\\in \\\\mathbb{R}$.\n\n$\\\\alpha$, $\\\\beta$ and $\\\\gamma$ are also roots of the equation $h(z) = 0$.\n\nIt is given that $h(z) = 0$ is satisfied by the complex number $z = p + 3\\\\mathrm{i}$.\n\nShow that $p = 1$. \\\\hfill [3]\n\\\\end{IBPart}\n\n\\\\begin{IBPart}[c]\nIt is now given that $h\\\\!\\\\left(\\\\dfrac{1}{2}\\\\right) = 0$, and $\\\\alpha, \\\\beta \\\\in \\\\mathbb{Z}^+$, $\\\\alpha < \\\\beta$ and $\\\\gamma \\\\in \\\\mathbb{Q}$.\n\n\\\\begin{enumerate}[label=(\\\\roman*)]\n  \\\\item Find the value of the product $\\\\alpha\\\\beta$.\n  \\\\item Write down the value of $\\\\alpha$ and the value of $\\\\beta$. \\\\hfill [3]\n\\\\end{enumerate}\n\\\\end{IBPart}\n---\n\nNotice: the h(z) paragraphs appear between labels (a) and (b) in the image, so they go INSIDE the (b) IBPart block FIRST. The \"It is now given…\" paragraph appears between (b) and (c) in the image, so it goes INSIDE the (c) IBPart block FIRST.\n\nAdditional rules:\n- ALWAYS tag each \\\\begin{IBPart} with the part letter in square brackets: \\\\begin{IBPart}[a] for part (a), \\\\begin{IBPart}[d] for part (d), etc. This is CRITICAL for mark schemes that may only show a subset of parts — without the label the parts will be assigned to the wrong slots.\n- Text BEFORE the first labelled part (a) goes OUTSIDE all \\\\begin{IBPart} blocks — it is the shared stem\n- If there is no text before part (a), output nothing before the first \\\\begin{IBPart}\n- Do NOT include the part labels (a), (b), (c) inside the block content — the label goes in the \\\\begin{IBPart}[letter] tag only\n- Include sub-parts (i), (ii) within the parent part's \\\\begin{IBPart} block\n- Include mark allocations as \\\\hfill [N] at the end of each part's final line\n- Use $ ... $ for inline math and \\\\[ ... \\\\] for display math\n- If the image contains a coordinate diagram or graph, output the marker [[GRAPH_IMAGE]] on its own line at the exact position where the graph appears in the document. For example, if the graph appears after the stem introduction and before part (a), place [[GRAPH_IMAGE]] after the stem text and before the first \\\\begin{IBPart}. If the graph appears between two parts, place it inside the following part's \\\\begin{IBPart} block, before that part's question text. Do NOT place [[GRAPH_IMAGE]] after the last \\\\end{IBPart}.\n- No color formatting: NEVER output \\\\textcolor{}{}, \\\\color{}, \\\\colorbox{}{}, \\\\definecolor{}, or ANY color macro whatsoever. Return plain LaTeX only.\n- Return ONLY the LaTeX body, no explanation, no markdown fences`;
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
      // 8192 tokens: IB markschemes with 5+ parts, method branches, column
      // vectors, and mark codes can exceed 2500 tokens. 2048 caused truncation
      // mid-output (visible as \boldsymb cut off in part (d) of a 21-mark Q).
      max_tokens: 8192,
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
    // Find the text block by type rather than assuming index 0 — adaptive-thinking
    // models can place a "thinking" block before the "text" block.
    extractedLatex =
      response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text.trim() ?? "";
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
        // 8192 tokens: same reasoning — normalisation of a long markscheme
        // must have headroom to reproduce the full content, not truncate it.
        max_tokens: 8192,
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
        normResponse.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text.trim() ?? "";
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
      const correctionPrompt = `You have already extracted this IB Mathematics ${docType} into \\begin{IBPart}[letter]...\\end{IBPart} blocks. Now perform a boundary check against the original images.\n\nBackground: In IB papers, a context/setup paragraph sometimes appears printed BETWEEN two part labels in the original document — for example, a line like "Consider the function $g(x) = mx + c$, where $x \\in \\mathbb{R}$ and $m, c \\in \\mathbb{Q}$." printed between the "(c)" and "(d)" labels. Such paragraphs must go at the TOP of the FOLLOWING part's IBPart block.\n\nA frequent extraction error is placing such paragraphs at the BOTTOM of the PRECEDING part instead.\n\nFor each IBPart block, compare its content with the image:\n- If the block's FINAL paragraph is a setup/definition that introduces the NEXT part's task (it provides no answer to the current part and is not needed to understand the current part's conclusion), move it to the beginning of the next part's IBPart block.\n- If the block's final content is a genuine conclusion or result of the current part's task, leave it in place.\n\nApply corrections directly. Return the complete corrected LaTeX with \\begin{IBPart}[letter] tags preserved. If nothing needs moving, return the text unchanged. Return ONLY the LaTeX body — no explanation, no markdown fences.\n\nCurrent extraction:\n${extractedLatex}`;

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
      const corrected = correctionResp.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text",
      )?.text.trim() ?? "";
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
