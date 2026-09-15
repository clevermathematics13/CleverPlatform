import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  checkRubricAgainstItems,
  parseStandardsRubric,
  type RubricItem,
} from "@/lib/standards-rubric";

/**
 * GET /api/tests/[id]/standards-rubric
 *   -> { rubric, findings, items }
 * PUT /api/tests/[id]/standards-rubric
 *   Body: { rubric: StandardsRubric | null }
 *   -> { rubric, findings }
 *
 * The strand rubric that makes a test a Grade 9 Standard Level assessment --
 * see lib/standards-rubric.ts. Null clears it, and the test goes back to
 * being graded by marks and boundary set like every other test.
 *
 * Its own route rather than a key on PATCH /api/tests/[id], because it is
 * validated against the test's parts before it is written: a rubric naming
 * a part the test does not have would silently leave a strand short, and a
 * PATCH that maps keys onto columns has nowhere to say so. Blocking findings
 * refuse the save (422, with the findings); warnings are returned with it.
 */

async function loadItems(
  supabase: Awaited<ReturnType<typeof getApiTeacher>> extends infer A
    ? A extends { ok: true; supabase: infer S }
      ? S
      : never
    : never,
  testId: string
): Promise<RubricItem[]> {
  const { data, error } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RubricItem[];
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await params;

  const { data: test, error } = await supabase
    .from("tests")
    .select("id, standards_rubric")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  let items: RubricItem[];
  try {
    items = await loadItems(supabase, id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const parsed = parseStandardsRubric(test.standards_rubric);
  if (!parsed.ok) {
    // Stored but unreadable: say so rather than pretending there is none, so
    // the teacher can see and fix it.
    return NextResponse.json({
      rubric: test.standards_rubric,
      findings: [{ severity: "block", message: `The stored rubric is not valid: ${parsed.error}` }],
      items,
    });
  }
  return NextResponse.json({
    rubric: parsed.rubric,
    findings: parsed.rubric ? checkRubricAgainstItems(parsed.rubric, items) : [],
    items,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as { rubric?: unknown } | null;
  if (!body || !("rubric" in body)) {
    return NextResponse.json({ error: "Body must be { rubric: <rubric> | null }" }, { status: 400 });
  }

  const parsed = parseStandardsRubric(body.rubric);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: `That is not a valid rubric: ${parsed.error}`, findings: [{ severity: "block", message: parsed.error }] },
      { status: 400 }
    );
  }

  let items: RubricItem[];
  try {
    items = await loadItems(supabase, id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const findings = parsed.rubric ? checkRubricAgainstItems(parsed.rubric, items) : [];
  if (findings.some((f) => f.severity === "block")) {
    return NextResponse.json(
      {
        error: "The rubric names parts this test does not have. Fix those before saving.",
        findings,
      },
      { status: 422 }
    );
  }

  const { error } = await supabase
    .from("tests")
    .update({ standards_rubric: parsed.rubric })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rubric: parsed.rubric, findings });
}
