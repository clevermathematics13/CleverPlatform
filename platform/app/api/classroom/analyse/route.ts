import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import {
  listSubmissions,
  fetchAttachment,
  type FetchedAttachment,
} from "@/lib/google-classroom-work";

export const runtime = "nodejs";
export const maxDuration = 280;

/** Anthropic rejects oversized payloads; skip anything beyond this per file. */
const MAX_BYTES_PER_FILE = 9 * 1024 * 1024;

const SYSTEM = `You are reading a student's submitted work for an IB Diploma Programme Mathematics assignment. The work is usually handwritten and photographed or scanned, so expect imperfect images.

Your job, in order:

1. TRANSCRIBE what the student actually wrote — every working step, every line, including errors, crossings-out and false starts. Render mathematics in LaTeX. Where handwriting is genuinely illegible, write [illegible] rather than guessing silently. Do not tidy up or correct the student's work while transcribing; transcribe what is on the page, not what you think they meant.

2. ASSESS the mathematics. Identify what the student understood, where reasoning went wrong, and whether errors are conceptual (a misunderstanding) or procedural (a slip). Be specific and cite the student's own lines.

3. SUGGEST marks if, and only if, a mark scheme or maximum was supplied. Apply IB convention: method marks for valid method even when the final answer is wrong, accuracy marks only for correct results following correct or follow-through method. If no maximum was supplied, set suggested_marks to null.

4. Report confidence honestly. Use "low" liberally — it exists to flag work for teacher review. Legibility problems, cut-off pages, ambiguous notation and unclear intent all warrant "low" or "medium".

Return ONLY a JSON object of this exact shape. No markdown fences, no preamble:
{
  "transcription": "...",
  "assessment": "...",
  "misconceptions": ["..."],
  "suggested_marks": 3,
  "confidence": "high",
  "confidence_notes": ""
}`;

interface AnalyseBody {
  courseId: string;
  courseWorkId: string;
  submissionId: string;
  maxPoints?: number | null;
  markscheme?: string | null;
  questionContext?: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  let body: AnalyseBody;
  try {
    body = (await request.json()) as AnalyseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { courseId, courseWorkId, submissionId } = body;
  if (!courseId || !courseWorkId || !submissionId) {
    return NextResponse.json(
      { error: "courseId, courseWorkId and submissionId are required." },
      { status: 400 }
    );
  }

  // Locate the submission so we only ever read attachments Classroom says
  // belong to it.
  let attachmentIds: string[];
  try {
    const submissions = await listSubmissions(courseId, courseWorkId);
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found in this coursework." },
        { status: 404 }
      );
    }
    if (submission.attachments.length === 0) {
      return NextResponse.json(
        { error: "This submission has no Drive attachments to read." },
        { status: 422 }
      );
    }
    attachmentIds = submission.attachments.map((a) => a.driveFileId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Classroom lookup failed." },
      { status: 502 }
    );
  }

  // Download the files.
  const files: FetchedAttachment[] = [];
  const skipped: string[] = [];
  for (const fileId of attachmentIds) {
    try {
      const file = await fetchAttachment(fileId);
      if (file.kind === "unsupported") {
        skipped.push(`${file.name} (${file.mimeType} cannot be read visually)`);
        continue;
      }
      if (file.sizeBytes > MAX_BYTES_PER_FILE) {
        skipped.push(
          `${file.name} (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB, too large)`
        );
        continue;
      }
      files.push(file);
    } catch (err) {
      skipped.push(
        `${fileId} (${err instanceof Error ? err.message : "download failed"})`
      );
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No readable attachments.", skipped },
      { status: 422 }
    );
  }

  // Build the vision prompt.
  const content: Anthropic.ContentBlockParam[] = [];

  for (const file of files) {
    if (file.kind === "pdf") {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: file.base64,
        },
      });
    } else {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: file.mimeType as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp",
          data: file.base64,
        },
      });
    }
  }

  const parts: string[] = [
    `The student submitted ${files.length} file(s): ${files
      .map((f) => f.name)
      .join(", ")}.`,
  ];
  if (body.questionContext) {
    parts.push(`Question / task:\n${body.questionContext}`);
  }
  if (body.markscheme) {
    parts.push(`Mark scheme:\n${body.markscheme}`);
  }
  if (body.maxPoints != null) {
    parts.push(`Maximum marks available: ${body.maxPoints}.`);
  } else {
    parts.push(
      "No maximum marks were supplied — set suggested_marks to null and do not invent a total."
    );
  }
  parts.push("Transcribe and assess the work now. Return only the JSON object.");

  content.push({ type: "text", text: parts.join("\n\n") });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    const raw =
      response.content
        .find((b): b is Anthropic.TextBlock => b.type === "text")
        ?.text.trim() ?? "";

    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Model did not return valid JSON.", raw: cleaned.slice(0, 2000) },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      analysis: parsed,
      filesRead: files.map((f) => ({ name: f.name, mimeType: f.mimeType })),
      skipped,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed." },
      { status: 502 }
    );
  }
}
