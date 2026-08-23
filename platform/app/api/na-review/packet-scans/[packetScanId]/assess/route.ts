import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * GET /api/na-review/packet-scans/[packetScanId]/assess
 *
 * Lists one student's crops, each with its anchor's qid and whatever
 * na_feedback already exists, so a client can drive stage 5 one crop at a
 * time via POST /api/na-review/response-crops/[cropId]/assess.
 *
 * This route used to itself loop over every crop and call the model for
 * each one inside a single request. That hit Vercel's function timeout on
 * a real student -- confirmed directly: 24 of 37 gradable crops completed
 * and saved correctly before FUNCTION_INVOCATION_TIMEOUT killed the
 * request. Moving the loop to the CLIENT (same pattern stage 4's "Crop
 * all" already uses successfully) removes the failure mode entirely
 * rather than raising the timeout further: each individual assess call is
 * now small and bounded, and a slow or failed crop can't take the rest of
 * the student's assessment down with it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packetScanId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetScanId } = await params;

  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, status")
    .eq("id", packetScanId)
    .maybeSingle();
  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });
  if (!scan) return NextResponse.json({ error: "Packet scan not found" }, { status: 404 });

  const { data: cropRows, error: cropsErr } = await supabase
    .from("na_response_crops")
    .select(
      "id, is_blank, anchor_id, na_anchors(qid, sort_order), na_feedback(ai_attempted, ai_verdict, ai_marks_awarded, ai_marks_available, ai_validation_error)"
    )
    .eq("packet_scan_id", packetScanId);

  if (cropsErr) return NextResponse.json({ error: cropsErr.message }, { status: 500 });

  type Row = {
    id: string;
    is_blank: boolean | null;
    anchor_id: string;
    na_anchors: { qid: string; sort_order: number | null } | { qid: string; sort_order: number | null }[] | null;
    na_feedback:
      | { ai_attempted: boolean | null; ai_verdict: string | null; ai_marks_awarded: number | null; ai_marks_available: number | null; ai_validation_error: string | null }
      | { ai_attempted: boolean | null; ai_verdict: string | null; ai_marks_awarded: number | null; ai_marks_available: number | null; ai_validation_error: string | null }[]
      | null;
  };

  const crops = ((cropRows ?? []) as Row[]).map((r) => {
    const anchor = Array.isArray(r.na_anchors) ? r.na_anchors[0] : r.na_anchors;
    const feedback = Array.isArray(r.na_feedback) ? r.na_feedback[0] : r.na_feedback;
    return {
      cropId: r.id,
      qid: anchor?.qid ?? "(unknown)",
      sortOrder: anchor?.sort_order ?? 0,
      isBlank: r.is_blank ?? false,
      // "assessed" here means na_feedback exists AND is a real, complete
      // verdict -- not merely attempted-but-invalid. A row with
      // ai_validation_error set still needs a retry, so it's reported as
      // not yet assessed rather than silently counted as done.
      alreadyAssessed: !!feedback && feedback.ai_attempted !== null && !feedback.ai_validation_error,
      verdict: feedback?.ai_verdict ?? null,
      marksAwarded: feedback?.ai_marks_awarded ?? null,
      marksAvailable: feedback?.ai_marks_available ?? null,
    };
  });

  crops.sort((a, b) => a.sortOrder - b.sortOrder || a.qid.localeCompare(b.qid, undefined, { numeric: true }));

  return NextResponse.json({
    packetScanId,
    status: scan.status,
    crops,
    totalCount: crops.length,
    assessedCount: crops.filter((c) => c.alreadyAssessed).length,
  });
}
