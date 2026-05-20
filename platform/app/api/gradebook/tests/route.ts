import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

interface QueueItemInput {
  id: string;
  code: string;
  marks: number;
  subtopicCodes: string[];
}

export async function POST(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, courseId, testDate, questions } = body as Record<string, unknown>;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof courseId !== "string" ||
    !courseId.trim() ||
    !Array.isArray(questions) ||
    questions.length === 0
  ) {
    return NextResponse.json(
      { error: "name, courseId, and questions (non-empty array) are required" },
      { status: 400 }
    );
  }

  const qs = questions as QueueItemInput[];
  const questionIds = qs.map((q) => q.id);

  // Fetch question parts so we can create per-part test_items with accurate marks
  const { data: parts, error: partsError } = await supabase
    .from("question_parts")
    .select("id, question_id, part_label, marks, subtopic_codes")
    .in("question_id", questionIds);

  if (partsError) {
    return NextResponse.json({ error: partsError.message }, { status: 500 });
  }

  // Group parts by question_id
  const partsByQuestion: Record<string, { id: string; part_label: string | null; marks: number; subtopic_codes: string[] }[]> = {};
  for (const p of parts ?? []) {
    if (!partsByQuestion[p.question_id]) partsByQuestion[p.question_id] = [];
    partsByQuestion[p.question_id].push(p);
  }

  const totalMarks = qs.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  // Create the test row
  const { data: test, error: testError } = await supabase
    .from("tests")
    .insert({
      teacher_id: user.id,
      course_id: courseId,
      name: name.trim(),
      test_date: typeof testDate === "string" && testDate ? testDate : null,
      total_marks: totalMarks,
    })
    .select("id")
    .single();

  if (testError) {
    return NextResponse.json({ error: testError.message }, { status: 500 });
  }

  // Build test_items rows — one per part (or one per question if no parts found)
  const testItems: {
    test_id: string;
    question_number: number;
    ib_question_code: string;
    part_label: string;
    max_marks: number;
    subtopic_codes: string[];
    sort_order: number;
  }[] = [];

  let sortOrder = 0;
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const qParts = partsByQuestion[q.id] ?? [];
    const questionNumber = i + 1;

    if (qParts.length === 0) {
      // No parts in DB — create a single item for the whole question
      testItems.push({
        test_id: test.id,
        question_number: questionNumber,
        ib_question_code: q.code,
        part_label: "",
        max_marks: q.marks,
        subtopic_codes: q.subtopicCodes ?? [],
        sort_order: sortOrder++,
      });
    } else {
      // Sort parts alphabetically by label
      const sorted = [...qParts].sort((a, b) =>
        (a.part_label ?? "").localeCompare(b.part_label ?? "")
      );
      for (const part of sorted) {
        testItems.push({
          test_id: test.id,
          question_number: questionNumber,
          ib_question_code: q.code,
          part_label: part.part_label ?? "",
          max_marks: part.marks,
          subtopic_codes: part.subtopic_codes ?? [],
          sort_order: sortOrder++,
        });
      }
    }
  }

  const { error: itemsError } = await supabase.from("test_items").insert(testItems);
  if (itemsError) {
    // Roll back the test row to avoid orphaned tests
    await supabase.from("tests").delete().eq("id", test.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json({ id: test.id, courseId });
}
