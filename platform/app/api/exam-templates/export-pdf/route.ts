import { getApiTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { buildExamHtml, type ExamHtmlQuestion } from "@/lib/exam-html";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ExportPdfRequest {
  questionIds: string[];
  imageType: "question" | "markscheme";
  examName: string;
  curriculum: string;
  level: string;
  paper: number;
  courseId: string;
  mode: "general" | "batched";
}

function safeFilename(name: string): string {
  return (
    name
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "exam"
  );
}

/** Fetches question metadata, parts, and signed image URLs — same shape the
 *  client already gets from /api/questions/test-images, fetched directly
 *  here so the client doesn't have to round-trip everything it already has
 *  back to this route. */
async function fetchQuestions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  questionIds: string[],
  imageType: "question" | "markscheme"
): Promise<ExamHtmlQuestion[]> {
  const { data: questionRows, error: qError } = await supabase
    .from("ib_questions")
    .select("id, code, section")
    .in("id", questionIds);
  if (qError) throw new Error(qError.message);

  const { data: allParts } = await supabase
    .from("question_parts")
    .select("id, question_id, marks")
    .in("question_id", questionIds);

  const marksByQuestion = new Map<string, number>();
  for (const p of allParts ?? []) {
    marksByQuestion.set(p.question_id, (marksByQuestion.get(p.question_id) ?? 0) + (Number(p.marks) || 0));
  }

  const { data: allImages, error: imgError } = await supabase
    .from("question_images")
    .select("id, question_id, storage_path, sort_order, alt_text")
    .in("question_id", questionIds)
    .eq("image_type", imageType)
    .order("sort_order", { ascending: true });
  if (imgError) throw new Error(imgError.message);

  const imagesByQuestion = new Map<string, typeof allImages>();
  for (const img of allImages ?? []) {
    const existing = imagesByQuestion.get(img.question_id) ?? [];
    existing.push(img);
    imagesByQuestion.set(img.question_id, existing);
  }

  const questionMap = new Map((questionRows ?? []).map((q) => [q.id, q]));

  return Promise.all(
    questionIds.map(async (qId) => {
      const meta = questionMap.get(qId);
      const images = imagesByQuestion.get(qId) ?? [];
      const withUrls = await Promise.all(
        images.map(async (img) => {
          const { data } = await supabase.storage
            .from("question-images")
            .createSignedUrl(img.storage_path, 600);
          return { url: data?.signedUrl ?? null, alt: img.alt_text ?? "" };
        })
      );
      return {
        id: qId,
        code: meta?.code ?? qId,
        section: (meta?.section as "A" | "B" | null) ?? null,
        totalMarks: marksByQuestion.get(qId) ?? 0,
        imageUrls: withUrls.map((w) => w.url),
        imageAlts: withUrls.map((w) => w.alt),
      };
    })
  );
}

export async function POST(req: Request) {
  let browser;
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase } = auth;

    const body = (await req.json()) as ExportPdfRequest;
    const { questionIds, imageType, examName, curriculum, level, paper, courseId, mode } = body;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return NextResponse.json({ error: "questionIds must be a non-empty array" }, { status: 400 });
    }

    const questions = await fetchQuestions(supabase, questionIds, imageType);

    // Cover page (best-effort — a 502 here shouldn't block the export)
    let thumbnailUrl: string | null = null;
    let nameField: { x: number; y: number; w: number; h: number } | null = null;
    try {
      const coverRes = await fetch(
        `${new URL(req.url).origin}/api/exam-templates/cover?curriculum=${curriculum}&level=${level}&paper=${paper}`,
        { headers: { cookie: req.headers.get("cookie") ?? "" } }
      );
      if (coverRes.ok) {
        const cover = await coverRes.json();
        thumbnailUrl = cover.thumbnailUrl ?? null;
        nameField = cover.nameField ?? null;
      }
    } catch {
      // Cover is optional; proceed without it.
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    if (mode === "general") {
      const html = buildExamHtml({
        examName,
        curriculum,
        level,
        paper,
        imageType,
        questions,
        thumbnailUrl,
        studentName: null,
        nameField,
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
      const pdf = await page.pdf({
        format: "A4",
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        printBackground: true,
        preferCSSPageSize: true,
      });
      await page.close();
      await browser.close();
      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeFilename(examName)}.pdf"`,
          "Content-Length": String(pdf.length),
        },
      });
    }

    // Batched: one PDF per student, merged. pdf-lib isn't a project
    // dependency, so merge with pypdf-equivalent logic is out of scope here;
    // instead each page.pdf() call already produces a multi-page PDF per
    // student, and we concatenate the raw pages using pdf-lib's simpler
    // cousin — the `PDFDocument` merge done client-side is unnecessary
    // because Puppeteer can print the *entire* batched HTML (every
    // student's pages) in a single page.pdf() call, so we build one big
    // HTML document instead of merging PDFs.
    const { data: studentRows, error: studentsError } = await supabase
      .from("students")
      .select("id, profiles:profile_id(display_name, nickname)")
      .eq("course_id", courseId)
      .eq("hidden", false)
      .order("id");
    if (studentsError) throw new Error(studentsError.message);

    const students = (studentRows ?? []) as Array<{
      id: string;
      profiles: { display_name: string | null; nickname: string | null } | null;
    }>;

    if (students.length === 0) {
      await browser.close();
      return NextResponse.json({ error: "No students found for this class" }, { status: 400 });
    }

    const htmlDocs = students.map((s) => {
      const name = s.profiles?.nickname ?? s.profiles?.display_name ?? "Student";
      return buildExamHtml({
        examName,
        curriculum,
        level,
        paper,
        imageType,
        questions,
        thumbnailUrl,
        studentName: name,
        nameField,
      });
    });

    // Concatenate each student's <body> content into one document so a
    // single page.pdf() call produces the full batched booklet in one pass
    // (breakBefore:page on each question-page keeps students separated the
    // same way general-exam questions are separated).
    const bodyMatches = htmlDocs.map((h) => {
      const m = h.match(/<body>([\s\S]*)<\/body>/);
      return m ? m[1] : "";
    });
    const headMatch = htmlDocs[0].match(/<style>[\s\S]*?<\/style>/);
    const combinedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${examName}</title>${headMatch ? headMatch[0] : ""}</head><body>${bodyMatches
      .map((b, i) => (i === 0 ? b : `<div style="break-before:page">${b}</div>`))
      .join("\n")}</body></html>`;

    const page = await browser.newPage();
    await page.setContent(combinedHtml, { waitUntil: "networkidle0", timeout: 60000 });
    const pdf = await page.pdf({
      format: "A4",
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      printBackground: true,
      preferCSSPageSize: true,
    });
    await page.close();
    await browser.close();

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(examName)}_batched.pdf"`,
        "Content-Length": String(pdf.length),
      },
    });
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    const message = err instanceof Error ? err.message : "PDF export error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
