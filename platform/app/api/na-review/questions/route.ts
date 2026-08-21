import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// GET /api/na-review/questions?packetVersionId=...
// Returns every anchor for a packet version, with per-question review
// progress (how many crops exist, how many have a teacher-approved
// final_verdict) so the index page can show a progress bar per question.
export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const packetVersionId = request.nextUrl.searchParams.get("packetVersionId");
  if (!packetVersionId) {
    return NextResponse.json({ error: "packetVersionId is required" }, { status: 400 });
  }

  const { data: anchors, error: anchorsErr } = await supabase
    .from("na_anchors")
    .select("id, qid, base_qid, part_label, marks_available, command_term, sort_order")
    .eq("packet_version_id", packetVersionId)
    .order("sort_order");

  if (anchorsErr) return NextResponse.json({ error: anchorsErr.message }, { status: 500 });
  if (!anchors || anchors.length === 0) {
    return NextResponse.json({ questions: [] });
  }

  const anchorIds = anchors.map((a) => a.id);

  // crop + feedback counts per anchor, in one pass rather than N queries
  const { data: crops, error: cropsErr } = await supabase
    .from("na_response_crops")
    .select("id, anchor_id, is_blank, na_feedback(id, final_verdict, approved_at, ai_confidence)")
    .in("anchor_id", anchorIds);

  if (cropsErr) return NextResponse.json({ error: cropsErr.message }, { status: 500 });

  const byAnchor = new Map<string, { total: number; reviewed: number; blank: number }>();
  for (const a of anchors) byAnchor.set(a.id, { total: 0, reviewed: 0, blank: 0 });

  for (const crop of crops ?? []) {
    const bucket = byAnchor.get(crop.anchor_id);
    if (!bucket) continue;
    bucket.total += 1;
    if (crop.is_blank) bucket.blank += 1;
    const feedback = Array.isArray(crop.na_feedback) ? crop.na_feedback[0] : crop.na_feedback;
    if (feedback?.approved_at) bucket.reviewed += 1;
  }

  const questions = anchors.map((a) => ({
    ...a,
    progress: byAnchor.get(a.id) ?? { total: 0, reviewed: 0, blank: 0 },
  }));

  return NextResponse.json({ questions });
}
