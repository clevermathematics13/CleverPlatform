import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  ACTIVITY_IMPORT_MODEL,
  ExtractedActivitySchema,
  buildActivityImportSystemPrompt,
  buildActivityImportUserPrompt,
  toActivityDraft,
  validateActivityDraft,
  type ExtractedActivity,
} from "@/lib/activity-import";

/**
 * POST /api/activity-assessments/extract
 *   multipart/form-data: worksheet (PDF), key (PDF), activityDate? (YYYY-MM-DD)
 *   -> { draft: ActivityDraft, findings: RubricFinding[] }
 *
 * Reads a Math Medic worksheet and its answer key into an editable draft --
 * the parts with their answers, and the lesson's learning targets. Writes
 * nothing: the teacher reviews the draft on the importer page and saves it
 * through POST /api/activity-assessments.
 *
 * Both PDFs go to the model as documents rather than as extracted text, and
 * here that is not a preference but the only thing that works: a Math Medic
 * key is the worksheet with the answers written on it BY HAND. The text layer
 * of the key supplied for Exploration 1.1 renders its handwriting as
 * "c=8t orE=t" and "entreestituted 8(b- 3)=C", which is unusable -- the
 * answers exist only as marks on the page.
 */

export const runtime = "nodejs";
// One model call reading two short PDFs with thinking on, one of them
// handwritten. Same headroom as the Standard Level importer.
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
    return NextResponse.json({ error: "Expected a multipart form with worksheet and key PDFs" }, { status: 400 });
  }
  const worksheet = form.get("worksheet");
  const key = form.get("key");
  if (!(worksheet instanceof File) || !(key instanceof File)) {
    return NextResponse.json({ error: "Both files are required: worksheet and key" }, { status: 400 });
  }
  for (const [label, file] of [
    ["worksheet", worksheet],
    ["key", key],
  ] as const) {
    if (!isPdf(file)) return NextResponse.json({ error: `The ${label} must be a PDF` }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: `The ${label} is empty` }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `The ${label} is over ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });
    }
  }

  const rawDate = form.get("activityDate");
  const activityDate = typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
  }

  const [worksheetBase64, keyBase64] = await Promise.all([
    worksheet.arrayBuffer().then((b) => Buffer.from(b).toString("base64")),
    key.arrayBuffer().then((b) => Buffer.from(b).toString("base64")),
  ]);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let response: Anthropic.Messages.Message & { parsed_output?: ExtractedActivity | null };
  try {
    response = await anthropic.messages.parse({
      model: ACTIVITY_IMPORT_MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: zodOutputFormat(ExtractedActivitySchema),
      },
      system: buildActivityImportSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: worksheetBase64 },
              title: worksheet.name,
            },
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: keyBase64 },
              title: key.name,
            },
            {
              type: "text",
              text: buildActivityImportUserPrompt({ worksheetFileName: worksheet.name, keyFileName: key.name }),
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
    pipeline: "activity_import",
    model: ACTIVITY_IMPORT_MODEL,
    usage: response.usage,
  });

  if (response.stop_reason === "max_tokens") {
    return NextResponse.json({ error: "The read was cut off before the end of the activity. Try again." }, { status: 502 });
  }
  if (response.stop_reason === "refusal") {
    return NextResponse.json({ error: "The model declined to read these documents." }, { status: 502 });
  }

  // parsed_output is the happy path; the text block is the fallback, since
  // these models return thinking blocks first and a parse failure leaves the
  // JSON sitting in the text block (see lib/practice-question-generator.ts).
  let extracted: ExtractedActivity;
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
    const parsed = ExtractedActivitySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: `The model's reply did not fit the schema: ${parsed.error.message}` }, { status: 502 });
    }
    extracted = parsed.data;
  }

  const draft = toActivityDraft(extracted, { activityDate });
  return NextResponse.json({ draft, findings: validateActivityDraft(draft) });
}
