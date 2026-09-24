import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { getApiUser } from "@/lib/auth";
import { getTestsForStudent } from "@/lib/exam-service";
import {
  REMARK_STUDENT_COLUMNS,
  normaliseExplanation,
  remarkEligibility,
  toReflectionRemark,
  type RemarkEligibility,
} from "@/lib/remark-requests";

/**
 * POST   /api/remark-requests   Body: { testItemId, explanation }
 * DELETE /api/remark-requests   Body: { testItemId }
 *
 * A student asking for one part of a test to be re-marked, rewording that
 * request while it waits, or withdrawing it. The teacher answers it through
 * PATCH /api/remark-requests/[id].
 *
 * Students cannot write remark_requests themselves -- the table grants them
 * SELECT on their own rows and nothing else (see its migration). This route
 * is the only way in, and it is where the rules live that a row policy
 * cannot express: the test is one this student can see (track family, not
 * hidden, past its release time -- getTestsForStudent), they have
 * self-graded it, the part has a ClevMark, and their saved mark differs from
 * it. Every read that decides this runs in the student's own session; only
 * the write itself uses the service role, and student_id always comes from
 * the session, never from the body.
 *
 * Everything returned here reaches a student's screen: plain messages, the
 * student-safe columns only, and never a raw database error.
 */

/** Built inside the handler, not at module scope, so `next build`'s page-data
 *  collection does not throw where the service key is absent. */
function serviceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOMETHING_WENT_WRONG = "Something went wrong. Please try again, and tell your teacher if it keeps happening.";

const REFUSALS: Record<Exclude<RemarkEligibility, "ok" | "pending">, string> = {
  resolved: "Your teacher has already answered this request.",
  "not-self-assessed": "Self-grade this test first.",
  "no-clevmark": "This part has no ClevMarks yet.",
  agrees: "Your mark already matches ClevMarks on this part.",
};

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** The signed-in student and the part they named, or the response to send. */
async function studentAndPart(request: NextRequest) {
  const auth = await getApiUser();
  if (!auth.ok) return { response: auth.response } as const;
  if (auth.profile.role !== "student") {
    return { response: fail("Only students can ask for a re-mark.", 403) } as const;
  }
  const body = (await request.json().catch(() => null)) as
    | { testItemId?: unknown; explanation?: unknown }
    | null;
  const testItemId = typeof body?.testItemId === "string" ? body.testItemId : "";
  if (!UUID.test(testItemId)) return { response: fail("That part could not be found.", 400) } as const;
  return { auth, body, testItemId } as const;
}

export async function POST(request: NextRequest) {
  const ctx = await studentAndPart(request);
  if ("response" in ctx) return ctx.response;
  const { auth, body, testItemId } = ctx;
  const { supabase, user } = auth;

  const text = normaliseExplanation(body?.explanation);
  if (!text.ok) return fail(text.error, 400);

  // The part, and whether its test is one this student can see at all.
  const { data: item, error: itemError } = await supabase
    .from("test_items")
    .select("id, test_id")
    .eq("id", testItemId)
    .maybeSingle();
  if (itemError) {
    console.error("[remark-requests] part read failed", itemError.message);
    return fail(SOMETHING_WENT_WRONG, 500);
  }
  const tests = item ? await getTestsForStudent(user.id) : [];
  if (!item || !tests.some((t) => t.id === item.test_id)) {
    return fail("That part could not be found.", 404);
  }

  // Whether they have self-graded is a question about the whole test, asked
  // the way the reflection page asks it: any saved mark that is not blank.
  const { data: parts, error: partsError } = await supabase
    .from("test_items")
    .select("id")
    .eq("test_id", item.test_id);
  const partIds = (parts ?? []).map((p) => p.id as string);

  const [selfRes, markRes, existingRes] = await Promise.all([
    supabase
      .from("student_self_scores")
      .select("test_item_id, self_marks")
      .eq("student_id", user.id)
      .in("test_item_id", partIds.length ? partIds : [testItemId]),
    supabase
      .from("student_marks")
      .select("marks_awarded")
      .eq("test_item_id", testItemId)
      .eq("student_id", user.id)
      .maybeSingle(),
    supabase
      .from("remark_requests")
      .select(REMARK_STUDENT_COLUMNS)
      .eq("test_item_id", testItemId)
      .eq("student_id", user.id)
      .maybeSingle(),
  ]);
  const readError = partsError ?? selfRes.error ?? markRes.error ?? existingRes.error;
  if (readError) {
    console.error("[remark-requests] eligibility read failed", readError.message);
    return fail(SOMETHING_WENT_WRONG, 500);
  }

  const selfRows = (selfRes.data ?? []) as { test_item_id: string; self_marks: number | null }[];
  const savedSelfMarks = selfRows.find((r) => r.test_item_id === testItemId)?.self_marks ?? null;
  const marksAwarded = (markRes.data?.marks_awarded as number | undefined) ?? null;
  const existing = existingRes.data as Record<string, unknown> | null;

  const eligibility = remarkEligibility({
    hasSelfAssessed: selfRows.some((r) => r.self_marks !== null),
    marksAwarded,
    savedSelfMarks,
    existingStatus: (existing?.status as "pending" | "changed" | "stands" | undefined) ?? null,
  });

  const service = serviceClient();

  // Rewording a request that is still waiting. Guarded on pending so an
  // answer that lands between the read above and this write is not reopened.
  if (eligibility === "pending" && existing) {
    const { data, error } = await service
      .from("remark_requests")
      .update({ explanation: text.text })
      .eq("id", existing.id as string)
      .eq("student_id", user.id)
      .eq("status", "pending")
      .select(REMARK_STUDENT_COLUMNS)
      .maybeSingle();
    if (error) {
      console.error("[remark-requests] update failed", error.message);
      return fail(SOMETHING_WENT_WRONG, 500);
    }
    if (!data) return fail(REFUSALS.resolved, 409);
    return NextResponse.json({ remark: toReflectionRemark(data as Record<string, unknown>) });
  }

  if (eligibility !== "ok") return fail(REFUSALS[eligibility as keyof typeof REFUSALS], 409);

  const { data, error } = await service
    .from("remark_requests")
    .insert({
      test_item_id: testItemId,
      student_id: user.id,
      explanation: text.text,
      marks_at_request: marksAwarded,
      self_marks_at_request: savedSelfMarks,
    })
    .select(REMARK_STUDENT_COLUMNS)
    .single();

  if (error) {
    // A second click that raced the first: the request exists, so hand back
    // the one that won rather than an error.
    if (error.code === "23505") {
      const { data: winner } = await service
        .from("remark_requests")
        .select(REMARK_STUDENT_COLUMNS)
        .eq("test_item_id", testItemId)
        .eq("student_id", user.id)
        .maybeSingle();
      if (winner) return NextResponse.json({ remark: toReflectionRemark(winner as Record<string, unknown>) });
    }
    console.error("[remark-requests] insert failed", error.message);
    return fail(SOMETHING_WENT_WRONG, 500);
  }

  return NextResponse.json({ remark: toReflectionRemark(data as Record<string, unknown>) });
}

/**
 * Withdrawing a request that is still waiting -- until the student has
 * uploaded their corrections for the test. A waiting request is what lets a
 * disputed part stop counting against the upload, so withdrawing one after
 * uploading would let a student unlock the upload with requests the teacher
 * then never sees. After that point the request stays and gets its answer.
 */
export async function DELETE(request: NextRequest) {
  const ctx = await studentAndPart(request);
  if ("response" in ctx) return ctx.response;
  const { auth, testItemId } = ctx;
  const { supabase, user } = auth;

  const [existingRes, itemRes] = await Promise.all([
    supabase
      .from("remark_requests")
      .select("id, status")
      .eq("test_item_id", testItemId)
      .eq("student_id", user.id)
      .maybeSingle(),
    supabase.from("test_items").select("test_id").eq("id", testItemId).maybeSingle(),
  ]);
  if (existingRes.error || itemRes.error) {
    console.error("[remark-requests] withdraw read failed", (existingRes.error ?? itemRes.error)?.message);
    return fail(SOMETHING_WENT_WRONG, 500);
  }
  const existing = existingRes.data;
  if (!existing || !itemRes.data) return fail("There is no request to withdraw.", 404);
  if (existing.status !== "pending") return fail(REFUSALS.resolved, 409);

  const { data: upload, error: uploadError } = await supabase
    .from("pdf_uploads")
    .select("id")
    .eq("student_id", user.id)
    .eq("test_id", itemRes.data.test_id as string)
    .maybeSingle();
  if (uploadError) {
    console.error("[remark-requests] upload read failed", uploadError.message);
    return fail(SOMETHING_WENT_WRONG, 500);
  }
  if (upload) {
    return fail("You have uploaded your corrections, so this request stays with your teacher.", 409);
  }

  const { data: deleted, error } = await serviceClient()
    .from("remark_requests")
    .delete()
    .eq("id", existing.id as string)
    .eq("student_id", user.id)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error("[remark-requests] delete failed", error.message);
    return fail(SOMETHING_WENT_WRONG, 500);
  }
  if (!deleted || deleted.length === 0) return fail(REFUSALS.resolved, 409);

  return NextResponse.json({ withdrawn: true });
}
