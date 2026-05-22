import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * GET /api/tests
 * Returns all tests with course name and item count for the teacher's dashboard.
 *
 * POST /api/tests
 * Creates a new test with its test items.
 * Body: { name, course_id, test_date, total_marks?, items[] }
 * items[]: { question_number, part_label, max_marks, subtopic_codes[], sort_order? }
 */

export async function GET(_request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("tests")
    .select(`
      id,
      name,
      test_date,
      total_marks,
      course_id,
      courses(name),
      test_items(count)
    `)
    .order("test_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tests = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    test_date: t.test_date,
    total_marks: t.total_marks,
    course_id: t.course_id,
    course_name:
      (t.courses as unknown as { name: string } | null)?.name ?? "Unknown",
    item_count:
      (t.test_items as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));

  return NextResponse.json(tests);
}

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json();
  const { name, course_id, test_date, total_marks, items } = body as {
    name: string;
    course_id: string;
    test_date?: string | null;
    total_marks?: number | null;
    items: Array<{
      question_number: number;
      part_label: string;
      max_marks: number;
      subtopic_codes?: string[];
      sort_order?: number;
    }>;
  };

  if (!name || !course_id || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "name, course_id, and at least one item are required" },
      { status: 400 }
    );
  }

  // Create the test
  const { data: test, error: testError } = await supabase
    .from("tests")
    .insert({
      name,
      course_id,
      teacher_id: user.id,
      test_date: test_date ?? null,
      total_marks: total_marks ?? items.reduce((s, i) => s + i.max_marks, 0),
    })
    .select("id")
    .single();

  if (testError || !test) {
    return NextResponse.json(
      { error: testError?.message ?? "Failed to create test" },
      { status: 500 }
    );
  }

  // Insert test items
  const itemRows = items.map((item, idx) => ({
    test_id: test.id,
    question_number: item.question_number,
    part_label: item.part_label ?? "",
    max_marks: item.max_marks,
    subtopic_codes: item.subtopic_codes ?? [],
    sort_order: item.sort_order ?? idx,
  }));

  const { error: itemsError } = await supabase
    .from("test_items")
    .insert(itemRows);

  if (itemsError) {
    // Clean up the test if items failed
    await supabase.from("tests").delete().eq("id", test.id);
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: test.id }, { status: 201 });
}
