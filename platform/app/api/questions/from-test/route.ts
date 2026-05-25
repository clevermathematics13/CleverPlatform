import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

type QueueRow = {
  id: string;
  code: string;
  section: "A" | "B" | null;
  curriculum: string[];
  hasQuestion: boolean;
  hasMarkscheme: boolean;
  marks: number;
  subtopicCodes: string[];
  partSubtopics: { partLabel: string; codes: string[] }[];
};

export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const testId = request.nextUrl.searchParams.get("testId");
  if (!testId) {
    return NextResponse.json({ error: "Missing testId" }, { status: 400 });
  }

  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, name, course_id, test_date")
    .eq("id", testId)
    .single();

  if (testError || !test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  const { data: testItems, error: itemsError } = await supabase
    .from("test_items")
    .select("id, ib_question_code, part_label, max_marks, subtopic_codes, question_number, sort_order")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const grouped = new Map<string, typeof testItems>();
  for (const item of testItems ?? []) {
    const code = item.ib_question_code;
    if (!code) continue;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code)!.push(item);
  }

  const codes = [...grouped.keys()];
  if (codes.length === 0) {
    return NextResponse.json({
      test: {
        id: test.id,
        name: test.name,
        courseId: test.course_id,
        date: test.test_date,
      },
      queue: [] as QueueRow[],
      missingCodes: [] as string[],
    });
  }

  const { data: questions, error: qError } = await supabase
    .from("ib_questions")
    .select("id, code, section, curriculum")
    .in("code", codes);

  if (qError) {
    return NextResponse.json({ error: qError.message }, { status: 500 });
  }

  const questionByCode = new Map((questions ?? []).map((q) => [q.code, q]));
  const questionIds = (questions ?? []).map((q) => q.id);

  const hasQuestionImg = new Set<string>();
  const hasMsImg = new Set<string>();
  if (questionIds.length > 0) {
    const { data: imageRows } = await supabase
      .from("question_images")
      .select("question_id, image_type")
      .in("question_id", questionIds);

    for (const row of imageRows ?? []) {
      if (row.image_type === "question") hasQuestionImg.add(row.question_id);
      if (row.image_type === "markscheme") hasMsImg.add(row.question_id);
    }
  }

  const queue: QueueRow[] = [];
  const missingCodes: string[] = [];

  for (const code of codes) {
    const sourceRows = grouped.get(code) ?? [];
    const q = questionByCode.get(code);
    if (!q) {
      missingCodes.push(code);
      continue;
    }

    const subtopicSet = new Set<string>();
    const partSubtopics = sourceRows
      .map((row) => {
        const codesOnPart = (row.subtopic_codes ?? []).filter(Boolean) as string[];
        for (const c of codesOnPart) subtopicSet.add(c);
        return {
          partLabel: row.part_label ?? "",
          codes: codesOnPart,
          order: row.sort_order ?? row.question_number,
        };
      })
      .filter((row) => row.codes.length > 0)
      .sort((a, b) => a.order - b.order)
      .map(({ partLabel, codes }) => ({ partLabel, codes }));

    const marks = sourceRows.reduce((sum, row) => sum + (row.max_marks ?? 0), 0);

    queue.push({
      id: q.id,
      code,
      section: (q.section as "A" | "B" | null) ?? null,
      curriculum: q.curriculum ?? ["AA"],
      hasQuestion: hasQuestionImg.has(q.id),
      hasMarkscheme: hasMsImg.has(q.id),
      marks,
      subtopicCodes: [...subtopicSet],
      partSubtopics,
    });
  }

  return NextResponse.json({
    test: {
      id: test.id,
      name: test.name,
      courseId: test.course_id,
      date: test.test_date,
    },
    queue,
    missingCodes,
  });
}
