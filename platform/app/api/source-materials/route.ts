/**
 * GET  /api/source-materials — the catalogue an assessment can be built from
 * POST /api/source-materials — upload a file into it
 *
 * The catalogue is a union of two origins (see lib/source-materials.ts): rows
 * this route's POST wrote, and the material the platform produced itself, read
 * from where it already lives rather than copied.
 *
 * Text is pulled out of an upload HERE, once, and stored. Doing it at selection
 * time instead would mean re-parsing an 18-page PDF on every generate, and
 * would put a parse failure in front of the teacher at the moment they were
 * trying to do something else.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  namespacedId,
  draftToText,
  harvestText,
  type SourceMaterialSummary,
} from "@/lib/source-materials";
import type { AssignmentDraft } from "@/lib/assignments";

export const runtime = "nodejs";
// Parsing a large PDF dominates; the upload itself is small.
export const maxDuration = 60;

/** The private bucket the PDF archiver already uses. */
const BUCKET = "exam-scans";
const PREFIX = "source-materials";
const MAX_BYTES = 25 * 1024 * 1024;

function first(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function GET(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const url = new URL(req.url);
  // A grade filter rather than a course one: material for Grade 9 is used by
  // every Grade 9 class, and the packets hang off Grade 9 Extended while the
  // one saved assessment hangs off 9G.
  const grade = url.searchParams.get("grade");
  const gradeMatches = (value: string | null | undefined) =>
    !grade || (value ?? "").toLowerCase().includes(grade.toLowerCase());

  const [uploads, packets, templates, assessments, courses] = await Promise.all([
    supabase
      .from("source_materials")
      .select("id, title, course_id, grade_level, storage_path, page_count, byte_size, created_at, extracted_text")
      .order("created_at", { ascending: false }),
    supabase
      .from("nuanced_analyses")
      .select("id, section_code, title, course_id, grade_level, parts, created_at")
      .not("section_code", "is", null)
      .order("section_code"),
    // assignment_templates has NO course_id and NO parts -- its content is all
    // in draft_content. Assuming otherwise (they were confused with
    // nuanced_analyses, which has both) made this whole route 500 and the
    // catalogue read as empty, uploads included.
    supabase
      .from("assignment_templates")
      .select("id, template_name, grade_level, draft_content, updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("tests")
      .select("id, name, course_id, custom_content, assessment_kind, created_at")
      .not("custom_content", "is", null)
      .order("created_at", { ascending: false }),
    supabase.from("courses").select("id, name"),
  ]);

  // One origin failing must not empty the catalogue. Before this, any single
  // bad query took the whole list with it -- the teacher saw "nothing
  // catalogued", which reads as "you have not uploaded anything" rather than
  // as a fault, and the files they HAD uploaded were the first thing hidden.
  const warnings: string[] = [];
  const usable = <T,>(
    result: { data: T[] | null; error: { message: string } | null },
    label: string,
  ): T[] => {
    if (result.error) {
      warnings.push(`${label} could not be read: ${result.error.message}`);
      return [];
    }
    return result.data ?? [];
  };

  const courseName = new Map(
    usable<{ id: string; name: string }>(courses, "Courses").map((c) => [c.id, c.name]),
  );

  const items: SourceMaterialSummary[] = [];

  for (const row of usable<{
    id: string; title: string; course_id: string | null; grade_level: string | null;
    storage_path: string; page_count: number | null; byte_size: number | null;
    created_at: string; extracted_text: string | null;
  }>(uploads, "Uploaded files")) {
    if (!gradeMatches(row.grade_level)) continue;
    const text = row.extracted_text ?? "";
    items.push({
      id: namespacedId("upload", row.id),
      kind: "upload",
      title: row.title,
      detail: [
        row.page_count ? `${row.page_count} page${row.page_count === 1 ? "" : "s"}` : null,
        text ? null : "no readable text",
      ].filter(Boolean).join(" - ") || "uploaded file",
      courseName: row.course_id ? courseName.get(row.course_id) ?? null : null,
      gradeLevel: row.grade_level,
      createdAt: row.created_at,
      usable: text.length > 0,
      approxChars: text.length,
      downloadPath: `/api/source-materials/${row.id}/file`,
    });
  }

  for (const row of usable<{
    id: string; section_code: string; title: string; course_id: string | null;
    grade_level: string | null; parts: unknown; created_at: string;
  }>(packets, "Nuanced Analysis packets")) {
    if (!gradeMatches(row.grade_level)) continue;
    const text = harvestText(row.parts).join("\n");
    items.push({
      id: namespacedId("na-packet", row.id),
      kind: "na-packet",
      title: `${row.section_code} ${row.title}`,
      detail: text ? `${Math.round(text.length / 1000)}k characters of packet text` : "no authored parts",
      courseName: row.course_id ? courseName.get(row.course_id) ?? null : null,
      gradeLevel: row.grade_level,
      createdAt: row.created_at,
      usable: text.length > 0,
      approxChars: text.length,
      downloadPath: null,
    });
  }

  for (const row of usable<{
    id: string; template_name: string; grade_level: string | null;
    draft_content: unknown; updated_at: string;
  }>(templates, "Authored templates")) {
    if (!gradeMatches(row.grade_level)) continue;
    const text = row.draft_content ? draftToText(row.draft_content as AssignmentDraft) : "";
    items.push({
      id: namespacedId("template", row.id),
      kind: "template",
      title: row.template_name,
      detail: text ? `${Math.round(text.length / 1000)}k characters` : "no content saved",
      // No course_id on this table -- a template belongs to a grade.
      courseName: null,
      gradeLevel: row.grade_level,
      createdAt: row.updated_at,
      usable: text.length > 0,
      approxChars: text.length,
      downloadPath: null,
    });
  }

  for (const row of usable<{
    id: string; name: string; course_id: string | null; custom_content: unknown;
    assessment_kind: string; created_at: string;
  }>(assessments, "Saved assessments")) {
    const course = row.course_id ? courseName.get(row.course_id) ?? null : null;
    // A saved assessment carries no grade_level of its own, so its course name
    // is what places it -- "9G" and "Grade 9 Extended" both read as Grade 9.
    if (grade && !gradeMatches(course) && !(course ?? "").startsWith("9")) continue;
    const text = draftToText(row.custom_content as AssignmentDraft);
    items.push({
      id: namespacedId("assessment", row.id),
      kind: "assessment",
      title: row.name,
      detail: `${row.assessment_kind} - ${Math.round(text.length / 1000)}k characters`,
      courseName: course,
      gradeLevel: null,
      createdAt: row.created_at,
      usable: text.length > 0,
      approxChars: text.length,
      downloadPath: `/api/formative-assessments/${row.id}/pdf?kind=paper`,
    });
  }

  return NextResponse.json({ materials: items, ...(warnings.length > 0 ? { warnings } : {}) });
}

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${Math.round(file.size / 1024 / 1024)}MB; the limit is 25MB.` },
      { status: 413 },
    );
  }

  const title = (form.get("title") as string | null)?.trim() || file.name.replace(/\.pdf$/i, "");
  const gradeLevel = (form.get("gradeLevel") as string | null)?.trim() || null;
  const courseId = (form.get("courseId") as string | null)?.trim() || null;

  const bytes = Buffer.from(await file.arrayBuffer());

  // -- Pull the text out ---------------------------------------------------
  // Never fatal. A scan with no text layer is still worth keeping -- it
  // downloads, and the catalogue marks it unusable rather than pretending it
  // contributed to a prompt it could not reach.
  let extractedText: string | null = null;
  let pageCount: number | null = null;
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    // pdf-parse v2 is a class, not the v1 default function -- `new PDFParse(...)`
    // then `getText()`. Imported dynamically so a parse failure cannot take the
    // route's module graph with it.
    let parser: { getText: () => Promise<{ text?: string; total?: number }>; destroy?: () => Promise<void> } | null =
      null;
    try {
      const { PDFParse } = await import("pdf-parse");
      parser = new PDFParse({ data: new Uint8Array(bytes) });
      const parsed = await parser.getText();
      const text = (parsed.text ?? "").replace(/\n{3,}/g, "\n\n").trim();
      extractedText = text.length > 0 ? text : null;
      pageCount = parsed.total ?? null;
    } catch {
      extractedText = null;
    } finally {
      await parser?.destroy?.().catch(() => {});
    }
  } else if (file.type.startsWith("text/")) {
    extractedText = bytes.toString("utf8").trim() || null;
  }

  const id = crypto.randomUUID();
  const storagePath = `${PREFIX}/${id}/${file.name.replace(/[^\w.\-]+/g, "_")}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type || "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
  }

  const { data: saved, error: insertError } = await supabase
    .from("source_materials")
    .insert({
      id,
      title,
      course_id: courseId,
      grade_level: gradeLevel,
      storage_path: storagePath,
      content_type: file.type || "application/pdf",
      page_count: pageCount,
      byte_size: file.size,
      extracted_text: extractedText,
      uploaded_by: profile.id,
    })
    .select("id, title, page_count")
    .single();

  if (insertError || !saved) {
    return NextResponse.json(
      { error: insertError?.message ?? "Could not record the upload." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    material: {
      id: namespacedId("upload", saved.id),
      title: saved.title,
      pageCount: saved.page_count,
      usable: Boolean(extractedText),
      preview: extractedText ? first(extractedText, 300) : null,
    },
  });
}
