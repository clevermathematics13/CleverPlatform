import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  ExtractedAssessmentSchema,
  STANDARDS_IMPORT_MODEL,
  buildStandardsImportSystemPrompt,
  buildStandardsImportUserPrompt,
  toStandardsDraft,
  validateStandardsDraft,
  type ExtractedAssessment,
} from "@/lib/standards-import";

/**
 * POST /api/standards-assessments/extract
 *   multipart/form-data: paper (PDF), rubric (PDF)
 *   -> { draft: StandardsAssessmentDraft, findings: RubricFinding[] }
 *
 * Reads a Grade 9 Standard Level paper and its teacher marking rubric into
 * an editable draft -- the parts with their mark schemes, and the strand
 * rubric. Writes nothing: the teacher reviews the draft on the importer page
 * and saves it through POST /api/standards-assessments.
 *
 * Both PDFs go to the model as documents rather than as extracted text. The
 * rubric is a set of tables (strand / standards / parts / marks; level
 * descriptors in a four-column grid) whose meaning is in the layout, and a
 * text extraction of it interleaves the columns -- the pdf-parse output of
 * the KA1 rubric reads "Q1a,Q1b, Q1c Q7a,Q7b, Q7c Q8 11" with the strand
 * name three lines earlier.
 */

export const runtime = "nodejs";
// One model call reading two short PDFs with thinking on. The practice
// question generator's single Opus call sits under 60s; two documents and a
// longer answer want more headroom.
export const maxDuration = 180;

const MAX_BYTES = 20 * 1024 * 1024;

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form with paper and rubric PDFs" }, { status: 400 });
  }
  const paper = form.get("paper");
  const rubric = form.get("rubric");
  if (!(paper instanceof File) || !(rubric instanceof File)) {
    return NextResponse.json({ error: "Both files are required: paper and rubric" }, { status: 400 });
  }
  for (const [label, file] of [
    ["paper", paper],
    ["rubric", rubric],
  ] as const) {
    if (!isPdf(file)) return NextResponse.json({ error: `The ${label} must be a PDF` }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: `The ${label} is empty` }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `The ${label} is over ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
  }

  const [paperBase64, rubricBase64] = await Promise.all([
    paper.arrayBuffer().then((b) => Buffer.from(b).toString("base64")),
    rubric.arrayBuffer().then((b) => Buffer.from(b).toString("base64")),
  ]);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let response: Anthropic.Messages.Message & { parsed_output?: ExtractedAssessment | null };
  try {
    response = await anthropic.messages.parse({
      model: STANDARDS_IMPORT_MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: zodOutputFormat(ExtractedAssessmentSchema),
      },
      system: buildStandardsImportSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: paperBase64 },
              title: paper.name,
            },
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: rubricBase64 },
              title: rubric.name,
            },
            {
              type: "text",
              text: buildStandardsImportUserPrompt({ paperFileName: paper.name, rubricFileName: rubric.name }),
            },
          ],
        },
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Reading the PDFs failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }

  await recordUsage(supabase, {
    pipeline: "standards_import",
    model: STANDARDS_IMPORT_MODEL,
    usage: response.usage,
  });

  if (response.stop_reason === "max_tokens") {
    return NextResponse.json({ error: "The read was cut off before the end of the rubric. Try again." }, { status: 502 });
  }
  if (response.stop_reason === "refusal") {
    return NextResponse.json({ error: "The model declined to read these documents." }, { status: 502 });
  }

  // parsed_output is the happy path; the text block is the fallback, since
  // these models return thinking blocks first and a parse failure leaves the
  // JSON sitting in the text block (see lib/practice-question-generator.ts).
  let extracted: ExtractedAssessment;
  if (response.parsed_output) {
    extracted = response.parsed_output;
  } else {
    const text = response.content.find(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text"
    )?.text;
    if (!text) return NextResponse.json({ error: "The model returned nothing readable." }, { status: 502 });
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "The model's reply was not the expected JSON." }, { status: 502 });
    }
    const parsed = ExtractedAssessmentSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: `The model's reply did not fit the schema: ${parsed.error.message}` }, { status: 502 });
    }
    extracted = parsed.data;
  }

  const draft = toStandardsDraft(extracted);
  return NextResponse.json({ draft, findings: validateStandardsDraft(draft) });
}
