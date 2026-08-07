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

const SYSTEM = `You are reading a student's submitted work for an IB Diploma Programme Mathematics assignment. The work may be handwritten and photographed, a scan, or a digital document, so expect imperfect images.

Be TERSE throughout. A teacher is scanning many of these at once; every sentence must earn its place. Never narrate page layout, template structure, or what a document looks like — only what the student themselves produced.

Return these fields:

1. work_status — one to three words classifying the submission at a glance. Choose the most accurate descriptor; examples: "Unedited", "Blank", "Partially complete", "Complete", "Off-task", "Wrong file", "Illegible". Use "Unedited" when the file is an unmodified copy of the teacher's template. This is the single most important field: it is shown next to the submission status in a table.

2. transcription — a compact record of what the student wrote. Mathematics in LaTeX. Working steps only; no commentary, no description of the document's design. Where handwriting is illegible write [illegible] rather than guessing. If the student produced nothing, this is a single short sentence saying so — do not describe the empty template.

3. assessment — at most three sentences. What the student understood, where it went wrong, and whether errors are conceptual or procedural. Cite their own lines. If there is no work to assess, say so in one sentence and stop.

4. misconceptions — an array of short phrases, not sentences. Empty array if none can be observed.

5. suggested_marks — only if a mark scheme or maximum was supplied. IB convention: method marks for valid method even when the answer is wrong, accuracy marks only for correct results following correct or follow-through method. Otherwise null.

6. confidence — "high", "medium" or "low", plus confidence_notes only when medium or low. Use "low" liberally; it exists to flag work for teacher review.

Return ONLY a JSON object of this exact shape. No markdown fences, no preamble:
{
  "work_status": "Partially complete",
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
