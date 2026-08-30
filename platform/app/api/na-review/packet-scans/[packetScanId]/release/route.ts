import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { isUngradedAnchor, type AnchorContext } from "@/lib/na-assessment";

/**
 * POST /api/na-review/packet-scans/[packetScanId]/release
 *
 * Releases one student's whole packet-scan to them: sets na_feedback
 * .released_at on every gradable crop's feedback row and na_packet_scans
 * .status to 'released'. Whole-scan granularity, not per-question -- a
 * teacher finishes approving the entire packet, then releases it as a
 * unit, matching how na_packet_scans.status's existing (until now unused)
 * 'reviewed'/'released' enum values were designed.
 *
 * Refuses if any gradable crop still lacks approved_at -- a released row
 * must reflect the teacher's actual final call, never an unreviewed AI
 * draft. Ungradable anchors (isUngradedAnchor, e.g. pure "thinking space"
 * questions with no marks/answer key) are excluded from that requirement,
 * matching how the results summary already excludes them from
 * totalGradable.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packetScanId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetScanId } = await params;

  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, packet_version_id")
    .eq("id", packetScanId)
    .single();
  if (scanErr || !scan) {
    return NextResponse.json({ error: scanErr?.message ?? "Packet scan not found" }, { status: 404 });
  }

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id, qid, marks_available, question_answer, answer_sketch, open_rubric")
    .eq("packet_version_id", scan.packet_version_id);
  if (anchorErr) return NextResponse.json({ error: anchorErr.message }, { status: 500 });

  const gradableAnchorIds = new Set(
    (anchorRows ?? [])
      .filter(
        (a) =>
          !isUngradedAnchor({
            qid: a.qid,
            baseQid: a.qid,
            marksAvailable: a.marks_available,
            commandTerm: null,
            answerSketch: a.answer_sketch,
            openRubric: a.open_rubric,
            misconceptionContext: null,
            questionAnswer: a.question_answer,
          } satisfies AnchorContext)
      )
      .map((a) => a.id)
  );

  type CropRow = {
    id: string;
    anchor_id: string;
    na_feedback: { id: string; approved_at: string | null } | { id: string; approved_at: string | null }[] | null;
  };

  const { data: cropRows, error: cropErr } = await supabase
    .from("na_response_crops")
    .select("id, anchor_id, na_feedback(id, approved_at)")
    .eq("packet_scan_id", packetScanId);
  if (cropErr) return NextResponse.json({ error: cropErr.message }, { status: 500 });

  const gradableCrops = (cropRows ?? []).filter((c) => gradableAnchorIds.has(c.anchor_id)) as CropRow[];
  const feedbackIds: string[] = [];
  for (const c of gradableCrops) {
    const fb = Array.isArray(c.na_feedback) ? c.na_feedback[0] : c.na_feedback;
    if (!fb?.approved_at) {
      return NextResponse.json(
        { error: "Cannot release: not every gradable question has been approved yet." },
        { status: 400 }
      );
    }
    feedbackIds.push(fb.id);
  }

  if (feedbackIds.length === 0) {
    return NextResponse.json({ error: "No gradable, approved feedback found for this scan." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { error: releaseErr } = await supabase
    .from("na_feedback")
    .update({ released_at: nowIso })
    .in("id", feedbackIds);
  if (releaseErr) return NextResponse.json({ error: releaseErr.message }, { status: 500 });

  const { error: statusErr } = await supabase
    .from("na_packet_scans")
    .update({ status: "released" })
    .eq("id", packetScanId);
  if (statusErr) return NextResponse.json({ error: statusErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, releasedAt: nowIso, releasedCount: feedbackIds.length });
}
