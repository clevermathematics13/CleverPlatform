import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { isUngradedAnchor, type AnchorContext } from "@/lib/na-assessment";
import { fetchAllRows } from "@/lib/na-scanning";

/**
 * POST /api/na-review/packet-version/[packetVersionId]/release
 * Body (optional): { courseId?: string }
 *
 * Bulk variant of the per-scan release route: releases every identified
 * scan in this packet version (optionally scoped to one course, matching
 * the "Release all fully-approved" button living under a course heading)
 * whose gradable crops are all approved. Silently skips any scan that
 * isn't fully approved rather than erroring -- mirrors bulk-accept's own
 * additive, never-error-on-partial-state pattern -- so a teacher can
 * safely re-run this as more students get approved over time.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packetVersionId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetVersionId } = await params;

  const body = (await request.json().catch(() => ({}))) as { courseId?: string };
  const courseId = body.courseId ?? null;

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id, qid, marks_available, question_answer, answer_sketch, open_rubric")
    .eq("packet_version_id", packetVersionId);
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

  type ScanRow = {
    id: string;
    invited_students: { course_id: string } | { course_id: string }[] | null;
  };

  const { data: scanRows, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, invited_students(course_id)")
    .eq("packet_version_id", packetVersionId)
    .not("invited_student_id", "is", null);
  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });

  const scans = ((scanRows ?? []) as unknown as ScanRow[]).filter((s) => {
    if (!courseId) return true;
    const student = Array.isArray(s.invited_students) ? s.invited_students[0] : s.invited_students;
    return student?.course_id === courseId;
  });
  const scanIds = scans.map((s) => s.id);
  if (scanIds.length === 0) return NextResponse.json({ ok: true, released: 0, skipped: 0 });

  type CropRow = {
    id: string;
    anchor_id: string;
    packet_scan_id: string;
    na_feedback: { id: string; approved_at: string | null } | { id: string; approved_at: string | null }[] | null;
  };

  // A packet version's total crop count can (and in production, does) run
  // well past PostgREST's default 1000-row cap -- fetchAllRows pages
  // through .range() so this never silently drops a scan's crops, which
  // would otherwise make an incompletely-approved scan look fully
  // approved (missing crops just aren't checked) and get released.
  let cropRows: CropRow[];
  try {
    cropRows = await fetchAllRows<CropRow>((from, to) =>
      supabase
        .from("na_response_crops")
        .select("id, anchor_id, packet_scan_id, na_feedback(id, approved_at)")
        .in("packet_scan_id", scanIds)
        .range(from, to)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load crops" }, { status: 500 });
  }

  const cropsByScan = new Map<string, CropRow[]>();
  for (const c of cropRows) {
    const bucket = cropsByScan.get(c.packet_scan_id) ?? [];
    bucket.push(c);
    cropsByScan.set(c.packet_scan_id, bucket);
  }

  const feedbackIdsToRelease: string[] = [];
  const scanIdsToRelease: string[] = [];
  let skipped = 0;
  for (const scanId of scanIds) {
    const crops = (cropsByScan.get(scanId) ?? []).filter((c) => gradableAnchorIds.has(c.anchor_id));
    if (crops.length === 0) {
      skipped += 1;
      continue;
    }
    const feedbackIds: string[] = [];
    let fullyApproved = true;
    for (const c of crops) {
      const fb = Array.isArray(c.na_feedback) ? c.na_feedback[0] : c.na_feedback;
      if (!fb?.approved_at) {
        fullyApproved = false;
        break;
      }
      feedbackIds.push(fb.id);
    }
    if (!fullyApproved) {
      skipped += 1;
      continue;
    }
    feedbackIdsToRelease.push(...feedbackIds);
    scanIdsToRelease.push(scanId);
  }

  if (feedbackIdsToRelease.length === 0) {
    return NextResponse.json({ ok: true, released: 0, skipped });
  }

  const nowIso = new Date().toISOString();
  const { error: releaseErr } = await supabase
    .from("na_feedback")
    .update({ released_at: nowIso })
    .in("id", feedbackIdsToRelease);
  if (releaseErr) return NextResponse.json({ error: releaseErr.message }, { status: 500 });

  const { error: statusErr } = await supabase
    .from("na_packet_scans")
    .update({ status: "released" })
    .in("id", scanIdsToRelease);
  if (statusErr) return NextResponse.json({ error: statusErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, released: scanIdsToRelease.length, skipped });
}
