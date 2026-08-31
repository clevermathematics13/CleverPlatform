import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { NA_SCAN_BUCKET } from "@/lib/na-scanning";

const SIGNED_URL_TTL_SECONDS = 3600;

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
 *
 * Includes ai_transcription/ai_margin_comment/ai_next_step/ai_teacher_note
 * alongside the verdict and marks -- a real gap found when a teacher asked
 * why a student lost a mark on a question that had every one of these
 * fields populated with a specific, useful explanation in na_feedback,
 * but nothing in the UI surfaced anything beyond the bare number. The
 * model's reasoning was never missing; it just wasn't being shown.
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
      "id, storage_path, is_blank, possibly_truncated, anchor_id, na_anchors(qid, sort_order, question_text, prompt_crop_storage_path), na_feedback(ai_attempted, ai_verdict, ai_marks_awarded, ai_marks_available, ai_validation_error, ai_transcription, ai_margin_comment, ai_next_step, ai_teacher_note, ai_confidence, ai_misconception_tags, final_verdict, final_marks_awarded, approved_at)"
    )
    .eq("packet_scan_id", packetScanId);

  if (cropsErr) return NextResponse.json({ error: cropsErr.message }, { status: 500 });

  type Feedback = {
    ai_attempted: boolean | null;
    ai_verdict: string | null;
    ai_marks_awarded: number | null;
    ai_marks_available: number | null;
    ai_validation_error: string | null;
    ai_transcription: string | null;
    ai_margin_comment: string | null;
    ai_next_step: string | null;
    ai_teacher_note: string | null;
    ai_confidence: number | null;
    ai_misconception_tags: string[] | null;
    final_verdict: string | null;
    final_marks_awarded: number | null;
    approved_at: string | null;
  };

  type Anchor = {
    qid: string;
    sort_order: number | null;
    question_text: string | null;
    prompt_crop_storage_path: string | null;
  };

  type Row = {
    id: string;
    storage_path: string | null;
    is_blank: boolean | null;
    possibly_truncated: boolean | null;
    anchor_id: string;
    na_anchors: Anchor | Anchor[] | null;
    na_feedback: Feedback | Feedback[] | null;
  };

  const rows = (cropRows ?? []) as Row[];
  const anchorOf = (r: Row) => (Array.isArray(r.na_anchors) ? r.na_anchors[0] : r.na_anchors);

  // Batch-sign every crop's image in one call rather than one round trip
  // per crop -- a student can have 40 crops, and this route already learned
  // the hard way (see the module docstring) that per-crop work here adds up.
  // Includes each anchor's prompt-crop path alongside the per-student answer
  // crops -- same bucket, so one batch call covers both. Anchors repeat
  // across crops (many students, same anchor) but createSignedUrls only
  // needs each distinct path once; duplicates just map to the same result.
  const cropPaths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  const promptPaths = rows.map((r) => anchorOf(r)?.prompt_crop_storage_path).filter((p): p is string => !!p);
  const allPaths = [...new Set([...cropPaths, ...promptPaths])];
  const signedUrlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(NA_SCAN_BUCKET)
      .createSignedUrls(allPaths, SIGNED_URL_TTL_SECONDS);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedUrlByPath.set(s.path, s.signedUrl);
    }
  }

  const crops = rows.map((r) => {
    const anchor = anchorOf(r);
    const feedback = Array.isArray(r.na_feedback) ? r.na_feedback[0] : r.na_feedback;
    return {
      cropId: r.id,
      qid: anchor?.qid ?? "(unknown)",
      sortOrder: anchor?.sort_order ?? 0,
      questionText: anchor?.question_text ?? null,
      isBlank: r.is_blank ?? false,
      possiblyTruncated: r.possibly_truncated ?? false,
      imageUrl: r.storage_path ? (signedUrlByPath.get(r.storage_path) ?? null) : null,
      // A crop of the printed question prompt itself, as it appears on the
      // page -- distinct from questionText (plain text). Null for most
      // sub-parts of a multi-part question (b), (c)... whose own prompt is
      // only a few points of blank space above their box, not a separate
      // printed block; see na_anchors.prompt_crop_storage_path's comment.
      promptImageUrl: anchor?.prompt_crop_storage_path
        ? (signedUrlByPath.get(anchor.prompt_crop_storage_path) ?? null)
        : null,
      // "assessed" here means na_feedback exists AND is a real, complete
      // verdict -- not merely attempted-but-invalid. A row with
      // ai_validation_error set still needs a retry, so it's reported as
      // not yet assessed rather than silently counted as done.
      alreadyAssessed: !!feedback && feedback.ai_attempted !== null && !feedback.ai_validation_error,
      // The teacher's own final_* value, once one exists, is the real
      // current mark -- showing the stale ai_* draft after a teacher has
      // already overridden it would silently hide their own correction
      // the next time this list reloads (e.g. after a re-crop).
      verdict: feedback?.final_verdict ?? feedback?.ai_verdict ?? null,
      marksAwarded: feedback?.final_marks_awarded ?? feedback?.ai_marks_awarded ?? null,
      marksAvailable: feedback?.ai_marks_available ?? null,
      approved: !!feedback?.approved_at,
      transcription: feedback?.ai_transcription ?? null,
      marginComment: feedback?.ai_margin_comment ?? null,
      nextStep: feedback?.ai_next_step ?? null,
      teacherNote: feedback?.ai_teacher_note ?? null,
      confidence: feedback?.ai_confidence ?? null,
      misconceptionTags: feedback?.ai_misconception_tags ?? [],
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
