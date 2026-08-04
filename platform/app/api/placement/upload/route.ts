import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/placement/upload
// Body: { studentName: string, courseId?: string, fileName: string, data: string (base64 PDF) }
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = (await request.json().catch(() => null)) as {
    studentName?: string;
    courseId?: string | null;
    fileName?: string;
    data?: string;
  } | null;

  if (!body?.studentName?.trim()) {
    return NextResponse.json({ error: "studentName is required" }, { status: 400 });
  }
  if (!body?.data) {
    return NextResponse.json({ error: "data (base64 PDF) is required" }, { status: 400 });
  }

  const fileName = body.fileName?.trim() || "placement-test.pdf";
  const studentName = body.studentName.trim();
  const courseId = body.courseId?.trim() || null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(body.data, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid base64 data" }, { status: 400 });
  }
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  // Sanity check: PDF magic bytes
  if (buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
    return NextResponse.json({ error: "File does not look like a PDF" }, { status: 400 });
  }

  const storagePath = `placement-tests/${user.id}/${randomUUID()}.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from("uploads")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadErr) {
    return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const { data: row, error: insertErr } = await supabase
    .from("placement_tests")
    .insert({
      teacher_id: user.id,
      student_name: studentName,
      course_id: courseId,
      storage_path: storagePath,
      file_name: fileName,
      status: "uploaded",
    })
    .select("id, student_name, course_id, file_name, status, created_at")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ placementTest: row });
}
