import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import convertHeic from "heic-convert";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
// File assembly plus a vision pass to read the handwritten name and grade
// level off the front page. Generous headroom rather than a typical duration.
export const maxDuration = 180;

const FRONT_PAGE_SYSTEM = `You are reading the front page of a scanned IBDP Mathematics placement test to pull out two details about the student: their NAME and their GRADE LEVEL. Both are usually near the top of the first page, often handwritten by the student into a "Name:" / "Grade:" field, though they may also appear as printed labels or written informally in a header.

Read the handwriting carefully. Handwritten entries are frequently ambiguous — pay attention to letterforms, and prefer a plausible real personal name over a literal character-by-character transliteration when the handwriting is clearly a name. Do not invent details that aren't on the page.

Return these fields:

- student_name: the student's name as best you can read it, in normal capitalisation (e.g. "Alex Chen"). Empty string if no name appears anywhere on the page.
- name_confidence: "high" if clearly legible and unambiguous; "medium" if readable but some letters are uncertain or handwriting is messy; "low" if very hard to read, partially cut off, you're guessing at several characters, or you found something that might be a name but aren't sure. Use "low" liberally.
- name_notes: ONLY when name_confidence is "medium" or "low" — a brief note on what was uncertain (e.g. "could be 'Marin' or 'Martin'"). Empty string otherwise.

- printed_grade_level: the grade level EXACTLY as written on the page, as a plain integer. Accept any of the common ways it may be written — "Grade 9", "9th grade", "Year 9", "G9", "Gr. 9", or a bare "9" in a grade field — and return just the number, e.g. 9. Return null (JSON null, not a string) if no grade level appears on the page at all. Report what is actually written; do NOT adjust or reinterpret the number.
- grade_confidence: "high" if the grade is clearly legible and unambiguous; "medium" if readable but somewhat uncertain (e.g. messy digit); "low" if very hard to read, ambiguous between two numbers, or you're not confident the thing you found is really a grade level. Use "low" liberally.
- grade_notes: ONLY when grade_confidence is "medium" or "low" — a brief note on what was uncertain (e.g. "digit could be 9 or 4", "found '10' but it may be a room number"). Empty string otherwise.

Return ONLY a JSON object of this exact shape, no markdown fences, no explanation:
{
  "student_name": "Alex Chen",
  "name_confidence": "high",
  "name_notes": "",
  "printed_grade_level": 9,
  "grade_confidence": "high",
  "grade_notes": ""
}`;

type Confidence = "high" | "medium" | "low";

interface FrontPageDetails {
  studentName: string | null;
  nameConfidence: Confidence;
  nameNotes: string;
  printedGradeLevel: number | null;
  gradeConfidence: Confidence;
  gradeNotes: string;
}

function normaliseConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

async function readFrontPage(pdfBase64: string): Promise<FrontPageDetails | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: FRONT_PAGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            {
              type: "text",
              text: "Read the student's name and grade level from the front page of this placement test, per the system instructions.",
            },
          ],
        },
      ],
    });

    const text =
      response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const name = typeof parsed.student_name === "string" ? parsed.student_name.trim() : "";
    const rawGrade = parsed.printed_grade_level;
    const printedGrade =
      typeof rawGrade === "number" && Number.isFinite(rawGrade)
        ? Math.trunc(rawGrade)
        : typeof rawGrade === "string" && /^\d+$/.test(rawGrade.trim())
        ? parseInt(rawGrade.trim(), 10)
        : null;

    return {
      studentName: name || null,
      nameConfidence: normaliseConfidence(parsed.name_confidence),
      nameNotes: typeof parsed.name_notes === "string" ? parsed.name_notes.trim() : "",
      printedGradeLevel: printedGrade,
      gradeConfidence: normaliseConfidence(parsed.grade_confidence),
      gradeNotes: typeof parsed.grade_notes === "string" ? parsed.grade_notes.trim() : "",
    };
  } catch {
    // Front-page reading is best-effort — never block an otherwise-good
    // upload because the vision pass failed. The teacher can fill it in.
    return null;
  }
}

// POST /api/placement/upload
// Body: { studentName?: string, rawStoragePaths: string[] }
//
// The client uploads each raw file (PDF, JPEG, PNG, or HEIC/HEIF) directly to
// Supabase Storage from the browser BEFORE calling this route — Vercel
// serverless functions have a hard 4.5MB request body limit that cannot be
// raised, and up to 10 phone photos easily exceeds that, so the files never
// pass through this function as a request body. This route only receives the
// (tiny) list of storage paths, then does the server-side work: download each
// raw file, decode HEIC -> JPEG where needed, and assemble everything into a
// single PDF (or pass a lone PDF through unchanged). What lands in the
// permanent placement-tests/ path is always one PDF, so segment/grade never
// need to know how the test originally arrived.
//
// The student's name AND grade level are read off the handwritten front page
// by Claude vision and flagged with confidence levels for teacher review.
// An explicitly-typed studentName always wins over extraction.
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = (await request.json().catch(() => null)) as {
    studentName?: string;
    rawStoragePaths?: string[];
  } | null;

  if (!body?.rawStoragePaths || body.rawStoragePaths.length === 0) {
    return NextResponse.json({ error: "At least one uploaded file is required" }, { status: 400 });
  }
  if (body.rawStoragePaths.length > 10) {
    return NextResponse.json({ error: "A placement test can have at most 10 pages" }, { status: 400 });
  }

  const manualName = body.studentName?.trim() || null;
  const rawPaths = body.rawStoragePaths;

  // Every raw path must belong to this teacher's own temp-upload folder —
  // guards against a crafted path list pulling in someone else's files.
  const expectedPrefix = `placement-tests-raw/${user.id}/`;
  const badPath = rawPaths.find((p) => !p.startsWith(expectedPrefix));
  if (badPath) {
    return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
  }

  // Download all raw files from storage.
  let files: Array<{ fileName: string; buffer: Buffer }>;
  try {
    files = await Promise.all(
      rawPaths.map(async (path) => {
        const { data, error } = await supabase.storage.from("uploads").download(path);
        if (error || !data) {
          throw new Error(`Failed to download uploaded file "${path}": ${error?.message ?? "not found"}`);
        }
        const buffer = Buffer.from(await data.arrayBuffer());
        return { fileName: path.split("/").pop() ?? path, buffer };
      })
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to retrieve uploaded files" },
      { status: 500 }
    );
  }

  const isPdf = (f: { buffer: Buffer }) => f.buffer.subarray(0, 4).toString("ascii") === "%PDF";
  const isHeic = (f: { fileName: string }) => /\.(heic|heif)$/i.test(f.fileName);
  const isPng = (f: { fileName: string }) => /\.png$/i.test(f.fileName);
  const isSupportedImage = (f: { fileName: string }) =>
    isHeic(f) || isPng(f) || /\.(jpe?g)$/i.test(f.fileName);

  let finalPdfBuffer: Buffer;

  if (files.length === 1 && isPdf(files[0])) {
    finalPdfBuffer = files[0].buffer;
  } else {
    const badFile = files.find((f) => !isSupportedImage(f));
    if (badFile) {
      return NextResponse.json(
        {
          error:
            files.length > 1
              ? `"${badFile.fileName}" isn't a supported image (JPEG, PNG, or HEIC). When uploading multiple pages, every page must be an image — mixing in a PDF isn't supported.`
              : `"${badFile.fileName}" isn't a PDF or a supported image (JPEG, PNG, or HEIC).`,
        },
        { status: 400 }
      );
    }

    try {
      const pdfDoc = await PDFDocument.create();

      for (const f of files) {
        let embeddedImage;
        if (isHeic(f)) {
          const converted = await convertHeic({
            buffer: f.buffer,
            format: "JPEG",
            quality: 0.92,
          });
          embeddedImage = await pdfDoc.embedJpg(Buffer.from(converted));
        } else if (isPng(f)) {
          embeddedImage = await pdfDoc.embedPng(f.buffer);
        } else {
          embeddedImage = await pdfDoc.embedJpg(f.buffer);
        }

        // Fit the image to a standard A4-ish page, preserving aspect ratio,
        // so pages are consistent regardless of phone photo dimensions.
        const pageWidth = 595; // A4 at 72dpi
        const pageHeight = 842;
        const margin = 24;
        const maxW = pageWidth - margin * 2;
        const maxH = pageHeight - margin * 2;
        const scale = Math.min(maxW / embeddedImage.width, maxH / embeddedImage.height, 1);
        const drawW = embeddedImage.width * scale;
        const drawH = embeddedImage.height * scale;

        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(embeddedImage, {
          x: (pageWidth - drawW) / 2,
          y: (pageHeight - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }

      const pdfBytes = await pdfDoc.save();
      finalPdfBuffer = Buffer.from(pdfBytes);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Failed to assemble pages into a PDF: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        },
        { status: 500 }
      );
    }
  }

  // Read the name and grade level off the handwritten front page.
  const front = await readFrontPage(finalPdfBuffer.toString("base64"));

  // Name: an explicitly-typed name always wins over extraction.
  let studentName: string | null = manualName;
  let nameSource: "manual" | "extracted" = "manual";
  let nameConfidence: Confidence | null = null;
  let nameNotes: string | null = null;

  if (!manualName) {
    nameSource = "extracted";
    if (front?.studentName) {
      studentName = front.studentName;
      nameConfidence = front.nameConfidence;
      nameNotes = front.nameNotes || null;
    } else {
      studentName = null;
      nameConfidence = "low";
      nameNotes = "No name could be read from the front page. Please enter it manually.";
    }
  }

  // Grade level: the paper is labelled with the grade the student is coming
  // FROM, so the effective placement grade is one higher. The +1 is applied
  // here deterministically rather than asking the model to do the arithmetic,
  // and printed_grade_level keeps a record of what was actually written.
  const printedGradeLevel = front?.printedGradeLevel ?? null;
  const gradeLevel = printedGradeLevel !== null ? printedGradeLevel + 1 : null;
  let gradeConfidence: Confidence | null = null;
  let gradeNotes: string | null = null;

  if (printedGradeLevel !== null) {
    gradeConfidence = front?.gradeConfidence ?? "low";
    gradeNotes = front?.gradeNotes || null;
  } else {
    gradeConfidence = "low";
    gradeNotes = "No grade level could be read from the front page. Please enter it manually.";
  }

  const storagePath = `placement-tests/${user.id}/${randomUUID()}.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from("uploads")
    .upload(storagePath, finalPdfBuffer, { contentType: "application/pdf", upsert: false });

  if (uploadErr) {
    return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  // Best-effort cleanup of the raw temp files — not fatal if it fails.
  try {
    await supabase.storage.from("uploads").remove(rawPaths);
  } catch {
    // Non-fatal: orphaned raw files can be cleaned up later; don't block the response.
  }

  const fileName = files.length === 1 ? files[0].fileName : `${files.length}-page scan`;

  const { data: row, error: insertErr } = await supabase
    .from("placement_tests")
    .insert({
      teacher_id: user.id,
      student_name: studentName,
      student_name_source: nameSource,
      student_name_confidence: nameConfidence,
      student_name_notes: nameNotes,
      printed_grade_level: printedGradeLevel,
      grade_level: gradeLevel,
      grade_level_source: "extracted",
      grade_level_confidence: gradeConfidence,
      grade_level_notes: gradeNotes,
      storage_path: storagePath,
      file_name: fileName,
      status: "uploaded",
    })
    .select(
      "id, student_name, student_name_source, student_name_confidence, student_name_notes, printed_grade_level, grade_level, grade_level_source, grade_level_confidence, grade_level_notes, file_name, status, created_at"
    )
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ placementTest: row });
}
