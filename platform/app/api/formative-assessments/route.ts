/**
 * POST /api/formative-assessments — save a Formative Assessment as a gradeable test
 *
 * A Formative Assessment is authored as an AssignmentDraft (title/sections/
 * questions, each with a mark scheme — see lib/assignments.ts and
 * lib/formative-assessment-prompt.ts) but graded through the existing
 * `tests` + lib/ai-grading.ts pipeline, unmodified. This route is what
 * closes that loop: it upserts a `tests` row (storing the full draft in
 * `custom_content` so it can be reloaded and re-edited) and derives
 * `test_items` rows from it via lib/formative-assessment-bridge.ts's
 * syncTestItems() — the same non-destructive-resync pattern used by
 * lib/na-rubric-bridge.ts for Nuanced Analysis packets.
 *
 * Once saved, the returned test id works with the existing test UI
 * unchanged: /dashboard/tests/[id]/ai-grade for batch AI grading of scanned
 * student papers, and /dashboard/gradebook for recorded marks.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { syncTestItems, computeTotalMarks } from "@/lib/formative-assessment-bridge";
import type { AssignmentDraft } from "@/lib/assignments";

export const runtime = "nodejs";

type SaveBody = {
  testId?: unknown;
  courseId?: unknown;
  draft?: unknown;
  requireSelfAssessment?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "courseId is required and must be a UUID" }, { status: 400 });
  }

  if (!body.draft || typeof body.draft !== "object") {
    return NextResponse.json({ error: "draft is required" }, { status: 400 });
  }
  const draft = body.draft as AssignmentDraft;
  if (!draft.title || !Array.isArray(draft.sections) || draft.sections.length === 0) {
    return NextResponse.json(
      { error: "draft must have a title and a non-empty sections array" },
      { status: 400 },
    );
  }

  const testId =
    typeof body.testId === "string" && UUID_RE.test(body.testId) ? body.testId : null;
  const totalMarks = computeTotalMarks(draft.sections);
  // Defaults to required (true) to match tests.require_self_assessment's own
  // column default -- every other creation path leaves this untouched.
  const requireSelfAssessment = body.requireSelfAssessment !== false;

  const saveResult = testId
    ? await supabase
        .from("tests")
        .update({
          name: draft.title,
          course_id: courseId,
          total_marks: totalMarks,
          custom_content: draft,
          require_self_assessment: requireSelfAssessment,
        })
        .eq("id", testId)
        .select("id, name, total_marks")
        .single()
    : await supabase
        .from("tests")
        .insert({
          name: draft.title,
          course_id: courseId,
          teacher_id: profile.id,
          total_marks: totalMarks,
          custom_content: draft,
          require_self_assessment: requireSelfAssessment,
        })
        .select("id, name, total_marks")
        .single();

  const { data: saved, error: saveError } = saveResult;
  if (saveError || !saved) {
    return NextResponse.json({ error: saveError?.message ?? "Failed to save test" }, { status: 500 });
  }

  // -- Sync test_items -----------------------------------------------------
  // Reported separately rather than rolled back: the test is saved and the
  // teacher should not lose it because the item sync failed.
  const syncResult = await syncTestItems(supabase, saved.id, draft.sections);
  if (!syncResult.ok) {
    return NextResponse.json(
      { test: saved, testItems: "failed", testItemsError: syncResult.error },
      { status: 207 },
    );
  }

  return NextResponse.json({ test: saved, testItems: "synced", synced: syncResult.synced }, { status: 200 });
}
