import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const testItemId = request.nextUrl.searchParams.get("testItemId");
  if (!testItemId) {
    return NextResponse.json({ error: "Missing testItemId" }, { status: 400 });
  }

  const { data: testItem, error: testItemError } = await supabase
    .from("test_items")
    .select("id, ib_question_code")
    .eq("id", testItemId)
    .single();

  if (testItemError || !testItem) {
    return NextResponse.json({ error: "Test item not found" }, { status: 404 });
  }

  const code = testItem.ib_question_code;
  if (!code) {
    return NextResponse.json({ error: "Test item has no ib_question_code" }, { status: 404 });
  }

  const { data: question, error: questionError } = await supabase
    .from("ib_questions")
    .select("id, code")
    .eq("code", code)
    .maybeSingle();

  if (questionError) {
    return NextResponse.json({ error: questionError.message }, { status: 500 });
  }

  return NextResponse.json({
    testItemId,
    code,
    questionId: question?.id ?? null,
  });
}
