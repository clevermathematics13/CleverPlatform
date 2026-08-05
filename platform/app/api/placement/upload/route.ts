import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import convertHeic from "heic-convert";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
// File assembly plus a vision pass to read the handwritten name off the
// front page. Generous headroom rather than an expected typical duration.
export const maxDuration = 180;

const NAME_EXTRACTION_SYSTEM = `You are reading the front page of a scanned IBDP Mathematics placement test to find the student's name, which is usually handwritten by the student in a "Name:" field near the top of the first page (it may also appear as a printed label, a name written in a header box, or written informally at the top of the page).

Read the handwriting carefully. Handwritten names are frequently ambiguous — pay attention to letterforms, and prefer a plausible real personal name over a literal character-by-character transliteration when the handwriting is clearly a name. Do not invent a name that isn't on the page.

Return:
- student_name: the student's name exactly as best you can read it, in normal capitalisation (e.g. "Alex Chen", not "ALEX CHEN" unless it's genuinely an unusual name). Use an empty string if you cannot find any name on the page at all.
- confidence: "high" if the name is clearly legible and unambiguous; "medium" if you can read it but some letters are uncertain or the handwriting is messy; "low" if the handwriting is very hard to read, the name is partially cut off, you are guessing at several characters, or you found something that might be a name but aren't sure it is one. Use "low" liberally — a wrong student name is worse than a flagged one, and the teacher will review anything flagged.
- notes: ONLY when confidence is "medium" or "low", a brief note on what was uncertain (e.g. "surname partially cut off at page edge", "could be 'Marin' or 'Martin'"). Empty string when confidence is "high".

Return ONLY a JSON object of this exact shape, no markdown fences, no explanation:
{
  "student_name": "Alex Chen",
  "confidence": "high",
  "notes": ""
}`;

interface ExtractedName {
  student_name: string;
  confidence: "high" | "medium" | "low";
  notes: string;
}

async function extractStudentName(pdfBase64: string): Promise<ExtractedName | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: NAME_EXTRACTION_SYSTEM,
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
              text: "Read the student's name from the front page of this placement test, per the system instructions.",
            },
          ],
        },
      ],
    });

    const text =
      response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ExtractedName>;
    const name = (parsed.student_name ?? "").trim();
    if (!name) return null;

    const confidence =
      parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
        ? parsed.confidence
        : "low";

    return { student_name: name, confidence, notes: (parsed.notes ?? "").trim() };
  } catch {
    // Name extraction is best-effort — never block an otherwise-good upload
    // because the vision pass failed. The teacher can fill the name in.
    return null;
  }
}

// POST /api/placement/upload
// Body: { studentName?: string, courseId?: string, rawStoragePaths: string[] }
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
// studentName is OPTIONAL: when omitted, the student's name is read off the
// handwritten front page by Claude vision and flagged with a confidence level
// for teacher review. When the teacher types a name explicitly, that wins and
// no extraction is attempted.
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = (await request.json().catch(() => null)) as {
    studentName?: string;
    courseId?: string | null;
    rawStoragePaths?: string[];
  } | null;

  if (!body?.rawStoragePaths || body.rawStoragePaths.length === 0) {
    return NextResponse.json({ error: "At least one uploaded file is required" }, { status: 400 });
  }
  if (body.rawStoragePaths.length > 10) {
    return NextResponse.json({ error: "A placement test can have at most 10 pages" }, { status: 400 });
  }

  const manualName = body.studentName?.trim() || null;
  const courseId = body.courseId?.trim() || null;
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

  // Read the handwritten name off the front page, unless the teacher already
  // gave one explicitly (an explicit name always wins over extraction).
  let studentName: string | null = manualName;
  let nameSource: "manual" | "extracted" = "manual";
  let nameConfidence: "high" | "medium" | "low" | null = null;
  let nameNotes: string | null = null;

  if (!manualName) {
    const extracted = await extractStudentName(finalPdfBuffer.toString("base64"));
    if (extracted) {
      studentName = extracted.student_name;
      nameSource = "extracted";
      nameConfidence = extracted.confidence;
      nameNotes = extracted.notes || null;
    } else {
      // Couldn't read a name — leave it blank and flag for the teacher rather
      // than guessing or failing the whole upload.
      studentName = null;
      nameSource = "extracted";
      nameConfidence = "low";
      nameNotes = "No name could be read from the front page. Please enter it manually.";
    }
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
      course_id: courseId,
      storage_path: storagePath,
      file_name: fileName,
      status: "uploaded",
    })
    .select(
      "id, student_name, student_name_source, student_name_confidence, student_name_notes, course_id, file_name, status, created_at"
    )
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ placementTest: row });
}
